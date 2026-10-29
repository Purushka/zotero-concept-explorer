import {createLocalizer,resolveLocale,LANGUAGES,localizeModelMessages} from './localization.mjs';
import {KnowledgeTreeStore} from './knowledge-tree-store.mjs';
import {deleteSessionWithConfirmation,confirmSessionDeletion} from './session-deletion.mjs';
import {waitForPanelFrame} from './panel-loader.mjs';
import {createNativeTabHost} from './native-tab-host.mjs';
import {createFloatingWindow} from './floating-window.mjs';
export {omitOwnStartupTabs} from './native-tab-host.mjs';
import {createZoteroStorage} from './zotero-storage.mjs';
import {createReaderNodeTracker} from './reader-node-tracker.mjs';
import {createAnnotationSessions} from './annotation-sessions.mjs';
import {watchReaderAnnotations} from './reader-annotations.mjs';
import {validateModelConfig,buildRequest,parseExplanation,explanationMessages,conversationMessages,friendlyHTTPError} from './model-adapter.mjs';

import {recoverExplanation,normalizeAnswer} from './explanation-format.mjs';
import {requestModel} from './model-stream.mjs';
import {createFullTextAnswers} from './full-text-answer.mjs';
import {MAX_SELECTION_LENGTH} from './explanation-selection.mjs';

const PREF = 'extensions.zotero.conceptExplorer.';
const LOGIN = 'chrome://concept-explorer';
const REALM = 'Concept Explorer API';
const XHTML = 'http://www.w3.org/1999/xhtml';
const plain = value => JSON.parse(JSON.stringify(value));

export async function start({id,version,rootURI}) {
  const prefGet = key => Zotero.Prefs.get(PREF+key,true);
  const prefSet = (key,value) => Zotero.Prefs.set(PREF+key,value,true);
  const languagePreference=()=>LANGUAGES.includes(prefGet('language')) ? prefGet('language') : 'auto';
  const l10n=createLocalizer(resolveLocale(languagePreference(),Zotero.locale || Services.locale?.appLocaleAsBCP47 || 'en-US'));
  const t=(key,values)=>l10n.t(key,values);
  let alive = true;
  const windows = new Map(), jobs = new Map();
  const eventNodes = createReaderNodeTracker({isDeadWrapper:node => Components.utils.isDeadWrapper(node)});
  const storage = createZoteroStorage({dataDirectory:Zotero.DataDirectory.dir,IOUtils,PathUtils});
  let store, startupError = '';
  try { store = await KnowledgeTreeStore.open(storage,{idFactory:() => Zotero.Utilities.randomString(24)}); }
  catch { startupError = t("archiveError"); }
  const annotationSessions=store ? createAnnotationSessions({Zotero,store,jobs,onChanged:notify,message:t}) : null;
  const readerWatches=new Map();
  function annotationError() {
    if(alive)reportError(Zotero.getMainWindow(),new Error(t('highlightCleanupFailed')));
  }
  async function openAnnotation(reader,key) {
    if(!alive || !annotationSessions)return null;
    const attachment=Zotero.Items.get(reader.itemID);if(!attachment)return null;
    const node=await annotationSessions.open(attachment,key);
    if(node)await showPanel(reader._window ?? Zotero.getMainWindow(),'reading',{surface:'floating'});
    return node;
  }
  function watchReader(reader,doc) {
    if(!alive || !annotationSessions)return;
    const root=reader._iframeWindow?.document ?? doc;
    if(!root || readerWatches.get(reader)?.doc===root)return;
    readerWatches.get(reader)?.dispose();
    readerWatches.set(reader,{doc:root,dispose:watchReaderAnnotations(reader,root,{onOpen:key=>openAnnotation(reader,key),onError:annotationError,onDispose:()=>{if(readerWatches.get(reader)?.doc===root)readerWatches.delete(reader);}})});
  }
  const annotationObserver=annotationSessions ? Zotero.Notifier.registerObserver({notify(event,type) {
    if(!alive || type!=='item' || !['delete','trash','modify'].includes(event))return;
    // Do not await: annotation.saveTx can dispatch this while selection holds
    // the queue. Reconciliation runs after that transaction and session save.
    void annotationSessions.reconcile().catch(annotationError);
  }},['item'],id+'-annotations') : null;
  const logins = () => Services.logins.findLogins(LOGIN,null,REALM);
  async function credentials() { return logins()[0]?.password ?? ''; }
  function config() { return {protocol:prefGet('protocol') || 'chat',baseURL:prefGet('baseURL') || '',model:prefGet('model') || ''}; }
  async function settings() { return {...config(),language:languagePreference(),locale:l10n.locale,hasKey:!!(await credentials()),archivePath:storage.paths.file,version}; }
  async function saveLanguage(language) {
    if(!LANGUAGES.includes(language))throw new Error(t('invalidLanguage'));
    prefSet('language',language);
    l10n.setLocale(resolveLocale(language,Zotero.locale || Services.locale?.appLocaleAsBCP47 || 'en-US'));
    for(const record of windows.values()) {
      for(const menu of record.menus)menu.setAttribute('label',t(menu.dataset.conceptExplorerLabel));
      for(const [surface,frame] of Object.entries(record.frames))frame?.setAttribute('title',t(surface==='tab' ? 'tabFrame' : 'floatingFrame'));
      record.floatingWindow?.setLocale(l10n.locale);
    }
    eventNodes.forEach(node=>{if(node.dataset.conceptExplorerLabel)node.textContent=t(node.dataset.conceptExplorerLabel);if(node.dataset.conceptExplorerTitle)node.title=t(node.dataset.conceptExplorerTitle);});
    notify();return {language,locale:l10n.locale};
  }
  async function saveSettings(input) {
    const validated = validateModelConfig(input);
    if (input.key && /[\r\n]/.test(input.key)) throw new Error(t("keyNewline"));
    if (input.clearKey) for (const login of logins()) Services.logins.removeLogin(login);
    else if (input.key) {
      const LoginInfo = Components.Constructor('@mozilla.org/login-manager/loginInfo;1','nsILoginInfo','init');
      const next = new LoginInfo(LOGIN,null,REALM,'api',input.key,'','');
      const old = logins()[0];
      if (old) Services.logins.modifyLogin(old,next);
      else await Services.logins.addLoginAsync(next);
    }
    for (const [key,value] of Object.entries(validated)) prefSet(key,value);
    return settings();
  }
  async function request(messages,job,probe=false) {
    let built; const selectedConfig=config();
    try { built = buildRequest(selectedConfig,await credentials(),messages,{probe}); }
    catch (error) { throw new Error(error.message); }
    try {
      return await requestModel(Zotero.HTTP,built,selectedConfig.protocol,{
        probe,isCancelled:() => !!job?.cancelled || !alive,
        setCancel:cancel => { if(job) job.cancel=cancel; },
        onText:text => { if(job) {job.raw=text;schedulePreview(job);} }
      });
    } catch (error) { throw new Error(friendlyHTTPError(error)); }
  }
  function preview(job) {
    if (job.kind === 'explanation') job.preview=parseExplanation(job.raw ?? '',{partial:true});
    else job.text=normalizeAnswer(job.raw ?? '',{partial:true});
  }
  function schedulePreview(job) {
    if(job.previewScheduled)return;
    job.previewScheduled=true;
    // The bootstrap scope has no timer globals. Use Zotero's own promise delay.
    void Zotero.Promise.delay(80).then(() => {
      job.previewScheduled=false;
      if(alive && job.status==='loading' && !job.cancelled) {preview(job);notify();}
    });
  }
  function endJob(job,error) {
    preview(job);
    job.status=job.cancelled ? 'cancelled' : 'error';
    job.error=job.cancelled ? t("cancelledPreview") : error.message;
  }
  function cancel(nodeId) {
    const job=jobs.get(nodeId);if(job?.status!=='loading')return;
    job.cancelled=true;try{job.cancel?.();}catch{}
    endJob(job,new Error(t("stopped")));notify();
  }
  function snapshot() {
    const archive=store?.snapshot() ?? null;
    // Repair old malformed JSON only for display, never overwrite the archive.
    if(archive) for(const node of archive.nodes) node.explanation=recoverExplanation(node.explanation);
    return {archive,startupError,language:languagePreference(),locale:l10n.locale,version,jobs:[...jobs].filter(([nodeId]) => archive?.nodes.some(node => node.id === nodeId)).map(([nodeId,job]) => ({nodeId,status:job.status,kind:job.kind,fullText:!!job.fullText,phase:job.phase ?? '',messageId:job.messageId ?? null,error:job.error ?? '',preview:job.preview ?? null,text:job.text ?? ''}))};
  }
  function notify() {
    if (!alive) return;
    const value = snapshot();
    for (const record of windows.values()) {syncFloating(record);for (const surface of ['floating','tab']) {
      try { record.frames[surface]?.contentWindow?.ConceptPanel?.update(plain(value)); }
      catch { /* Closing a reader window must not interrupt saved transactions. */ }
    }}
  }
  function requireStore() { if (!store) throw new Error(startupError); return store; }
  function ancestors(node) {
    const chain=[];
    while (node.parentId) { node=store.getSession(node.parentId); chain.unshift(node); }
    return chain;
  }
  const fullTextAnswers=store ? createFullTextAnswers({Zotero,store,jobs,request,ancestors,notify,endJob,isAlive:()=>alive,t,localize:messages=>localizeModelMessages(messages,l10n.locale)}) : null;
  function regenerateFullText(nodeId,messageId=null) {requireStore();return fullTextAnswers.regenerate(nodeId,messageId);}
  function startSelectionAnswer(nodeId,{fullText=false,generateNew=false}={}) {
    if(fullText) {
      // Choosing full-paper context supersedes a local-context request. Repeated
      // full-paper clicks reuse its active job instead of sending twice.
      const job=jobs.get(nodeId);
      if(job?.status==='loading' && !job.fullText)cancel(nodeId);
      regenerateFullText(nodeId);
    } else if(generateNew)void generate(nodeId);
  }
  async function generate(nodeId) {
    requireStore();
    if (!alive || !store.snapshot().nodes.some(node=>node.id===nodeId) || jobs.get(nodeId)?.status === 'loading') return;
    const job={status:'loading',kind:'explanation',cancelled:false};
    jobs.set(nodeId,job); notify();
    try {
      const node=store.getSession(nodeId);
      const document=store.snapshot().documents.find(doc => doc.id === node.documentId);
      const answer=await request(localizeModelMessages(explanationMessages(node,document,ancestors(node)),l10n.locale),job);
      const shouldCommit=()=>alive && !job.cancelled && jobs.get(nodeId)===job && store.snapshot().nodes.some(node=>node.id===nodeId);
      if(!shouldCommit())return;
      await store.setExplanation(nodeId,parseExplanation(answer),{shouldCommit});
      if(shouldCommit())job.status='saved';
    } catch (error) { endJob(job,error); }
    notify();
  }
  async function ask(nodeId,question) {
    requireStore();
    if (!String(question).trim()) return;
    if (jobs.get(nodeId)?.status === 'loading') throw new Error(t("alreadyAnswering"));
    const questionText=String(question).trim();
    const previous=store.getSession(nodeId);
    const job={status:'loading',kind:'ask',cancelled:false}; jobs.set(nodeId,job); notify();
    // Persist the user's question before sending. Failure never clears their draft.
    try { await store.appendMessage(nodeId,{role:'user',content:questionText});
    await store.saveSessionView(nodeId,{draft:''});
    } catch(error) {endJob(job,error);notify();throw error;}
    // Network work runs in the background so navigation never waits for the model.
    void answerQuestion(nodeId,previous,questionText,job);
  }
  async function answerQuestion(nodeId,previous,questionText,job) {
    try {
      const answer=await request(localizeModelMessages(conversationMessages(previous,questionText),l10n.locale),job);
      const shouldCommit=()=>alive && !job.cancelled && jobs.get(nodeId)===job && store.snapshot().nodes.some(node=>node.id===nodeId);
      if(!shouldCommit())return;
      await store.appendMessage(nodeId,{role:'assistant',content:normalizeAnswer(answer)},{shouldCommit});
      if(shouldCommit())job.status='saved';
    } catch (error) { endJob(job,error); }
    notify();
  }
  async function retry(nodeId) {
    requireStore();
    if (jobs.get(nodeId)?.status === 'loading') return;
    const failed=jobs.get(nodeId);
    if(failed?.fullText)return regenerateFullText(nodeId,failed.messageId);
    const previous=store.getSession(nodeId),last=previous.messages.at(-1);
    if (last?.role === 'user') {
      previous.messages.pop();
      const job={status:'loading',kind:'ask',cancelled:false}; jobs.set(nodeId,job); notify();
      void answerQuestion(nodeId,previous,last.content,job);
    } else void generate(nodeId);
  }
  async function child(parentId,concept,context='',{fullText=false}={}) {
    requireStore();
    const parent=store.getSession(parentId);
    const name=String(concept).trim();
    if (!name) throw new Error(t("chooseConcept"));
    if(name.length>MAX_SELECTION_LENGTH)throw new Error(t('selectionTooLong',{limit:MAX_SELECTION_LENGTH}));
    const existing=store.snapshot().nodes.find(node => node.parentId === parentId && node.concept === name);
    let node;
    if (existing) { await store.openSession(existing.id,'floating'); node=existing; }
    else node=await store.createSession({documentId:parent.documentId,parentId,concept:name,source:{selectedText:name,context:context || parent.explanation.detail,location:parent.source.location}});
    notify();
    startSelectionAnswer(node.id,{fullText,generateNew:!node.explanation.detail});
    return node;
  }
  async function mutate(action,args=[]) {
    requireStore();
    const allowed=['openSession','openDocument','closeFloating','returnToParent','showKnowledgeTree','resumeReading','saveSessionView'];
    if (!allowed.includes(action)) throw new Error('Unsupported operation');
    let result;
    try { result=await store[action](...args); }
    catch (error) {
      // Another frame may flush a captured draft after this node was deleted.
      // The store rejects before writing; stale view saves can be discarded.
      if (action==='saveSessionView' && !store.snapshot().nodes.some(node => node.id===args[0])) return null;
      throw error;
    }
    notify(); return result;
  }
  async function navigateOriginal(nodeId) {
    const node=requireStore().getSession(nodeId);
    const doc=store.snapshot().documents.find(doc => doc.id === node.documentId);
    const item=Zotero.Items.getByLibraryAndKey(doc.identity.libraryId,doc.identity.attachmentKey);
    if (!item || item.deleted) throw new Error(t("attachmentMissing"));
    const location=node.source.location;
    await Zotero.Reader.open(item.id,location.annotationKey ? {annotationID:location.annotationKey} : location.pageIndex===null ? undefined : {pageIndex:location.pageIndex});
  }
  const bridge = {
    state:async () => snapshot(),settings,saveSettings,saveLanguage,child,retry,ask,cancel,regenerateFullText,mutate,navigateOriginal,
    async probe() { await request([{role:'user',content:'只回复 OK。'}],null,true); return t("probeSucceeded"); }
  };
  function trackNode(node) { eventNodes.track(node); }
  function reportError(win,error) {
    const record=windows.get(win),panel=record?.frames[record.surface]?.contentWindow?.ConceptPanel;
    if(panel) panel.showError(error.message);
    else Zotero.alert(win,t("appName"),l10n.message(error.message));
  }
  function openSafely(win,initial) { void showPanel(win,initial).catch(error => reportError(win,error)); }
  function hideFloating(record) {
    if(record.frames.floating) record.frames.floating.style.display='none';
    record.floatingWindow?.setVisible(false);
  }
  function floatingVisible(record) {
    const w=store?.snapshot().workspace;
    return !!(record.overlayVisible && w?.floatingNodeId && w.activeDocumentId===record.sourceDocumentId &&
      (!record.win.Zotero_Tabs || record.win.Zotero_Tabs.selectedID===record.sourceTabId || record.host?.selected()));
  }
  function syncFloating(record) {
    const visible=floatingVisible(record);
    if(record.frames.floating)record.frames.floating.style.display=visible ? 'block' : 'none';
    record.floatingWindow?.setVisible(visible);
    if(record.floatVisible!==visible) {record.floatVisible=visible;try {void record.frames.floating?.contentWindow?.ConceptPanel?.visibilityChanged(visible).catch(() => {});}catch{}}
  }
  async function flushRecord(record) {
    for(const frame of Object.values(record.frames)) await frame?.contentWindow?.ConceptPanel?.flushViews();
  }
  function addWindow(win) {
    if (!alive || !win || win.closed || windows.has(win)) return;
    const record={win,frames:{floating:null,tab:null},loaded:{},menus:[],selection:null,surface:'floating',overlayVisible:false,sourceTabId:null};
    windows.set(win,record);
    const menu=win.document.getElementById('menu_ToolsPopup');
    for (const [suffix,label,initial] of [['tree',t("menuTree"),'knowledge'],['settings',t("menuSettings"),'settings']]) {
      if (!menu) continue;
      const item=win.document.createXULElement('menuitem');
      item.dataset.conceptExplorerLabel=suffix==='tree' ? 'menuTree' : 'menuSettings';
      item.id='concept-explorer-'+suffix; item.setAttribute('label',label);
      item.addEventListener('command',() => openSafely(win,initial));menu.append(item);record.menus.push(item);
    }
    record.key=event => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        if (record.selection && (!win.Zotero_Tabs || record.selection.reader.tabID===win.Zotero_Tabs.selectedID)) void explainSelection(record.selection.reader,record.selection.annotation,record.selection.doc);
        else openSafely(win,'knowledge');
      }
    };
    win.addEventListener('keydown',record.key);
  }
  function ensureHost(record) {
    if(record.host) return record.host;
    record.host=createNativeTabHost({window:record.win,
      onSelect:() => {
        syncFloating(record);
        try { record.frames.tab?.contentWindow?.ConceptPanel?.visibilityChanged(true); } catch {}
      },
      onClose:(_tab,{disposed}={}) => {
        try { void record.frames.tab?.contentWindow?.ConceptPanel?.flushViews().catch(error => reportError(record.win,error)); } catch {}
        record.frames.tab=null;record.loaded.tab=null;
        if(alive && !disposed && !record.win.closed) prefSet('workspaceTabOpen',false);
      },
      onRestore:(_tab,index) => showPanel(record.win,'reading',{surface:'tab',index}),
    });
    return record.host;
  }
  function removeWindow(win) {
    const record=windows.get(win);if(!record)return;
    try { void flushRecord(record).catch(() => {}); } catch {}
    win.removeEventListener('keydown',record.key);
    for(const menu of record.menus)menu.remove();
    record.floatingWindow?.dispose();
    record.host?.dispose();
    for(const frame of Object.values(record.frames))frame?.remove();
    windows.delete(win);
  }
  async function routeMutation(record,surface,action,args=[]) {
    const result=await mutate(action,args);
    if(action==='saveSessionView') return result;
    const w=store.snapshot().workspace;
    if(action==='closeFloating') {
      if(surface==='floating') {record.overlayVisible=false;hideFloating(record);}
      return result;
    }
    if(action==='openSession' && args[1]==='floating' && !store.getSession(args[0]).parentId) {
      await navigateOriginal(args[0]);
      await showPanel(record.win,'reading',{surface:'floating'});
    } else if(action==='openSession' && args[1]==='floating') {
      await showPanel(record.win,'reading',{surface:'tab',select:false});
      await showPanel(record.win,'reading',{surface:'floating'});
    } else {
      await showPanel(record.win,w.view==='knowledge' ? 'knowledge' : 'reading',{surface:action==='resumeReading' && surface==='floating' && !w.pageNodeId ? 'floating' : 'tab'});
    }
    return result;
  }
  async function showPanel(win,initial='reading',{surface,select=true,index}={}) {
    if(!alive) return;
    const w=store?.snapshot().workspace;
    surface ??= initial!=='reading' || w?.pageNodeId || !w?.floatingNodeId ? 'tab' : 'floating';
    if(surface==='tab' && !win?.Zotero_Tabs)win=Zotero.getMainWindow();
    addWindow(win);const record=windows.get(win);if(!record) return;
    if(initial==='knowledge' && store && store.snapshot().workspace.view!=='knowledge')await store.showKnowledgeTree();
    if(initial==='reading' && store && store.snapshot().workspace.view!=='reading')await store.resumeReading();
    record.surface=surface;
    let container;
    if(surface==='tab') {
      // The entire page lives in the tab deck, never above Zotero's tab bar.
      container=ensureHost(record).ensure({select:false,index,title:t('appName')}).container;
      prefSet('workspaceTabOpen',true);
      // Selecting the native page does not dismiss its floating companion.
    } else {
      container=win.document.documentElement;
      record.overlayVisible=true;record.sourceDocumentId=store?.snapshot().workspace.activeDocumentId;
      if(!record.host?.selected()) record.sourceTabId=win.Zotero_Tabs?.selectedID ?? null;
    }
    if(!record.frames[surface]) {
      const frame=win.document.createElementNS(XHTML,'iframe');
      frame.id=surface==='tab' ? 'concept-explorer-tab-panel' : 'concept-explorer-panel';
      frame.setAttribute('title',surface==='tab' ? t("tabFrame") : t("floatingFrame"));
      frame.setAttribute('flex','1');
      frame.style.cssText=surface==='tab'
        ? 'display:block;position:relative;border:0;width:100%;height:100%;flex:1;min-width:0;min-height:0;background:transparent;'
        : 'position:fixed;z-index:2147483600;border:0;border-radius:16px;box-shadow:0 16px 65px #0004;background:transparent;left:auto;top:auto;right:22px;bottom:22px;width:min(440px,calc(100vw - 32px));height:min(610px,calc(100vh - 110px));';
      record.frames[surface]=frame;
      const uri='chrome://concept-explorer/content/panel.html';
      record.loaded[surface]=waitForPanelFrame({frame,window:win,uri,initialize:async content => {
        content.ConceptBridge={...bridge,
          mutate:(action,args) => routeMutation(record,surface,action,args),
          deleteSession:async nodeId => {
            const result=await deleteSessionWithConfirmation({store:requireStore(),nodeId,jobs,confirm:plan => confirmSessionDeletion(Zotero,win,plan,l10n)});
            if (result) notify();
            // Do not navigate, dismiss a retained tab or reopen a deleted float.
            return result;
          },
          child:async (...args) => {const node=await child(...args);await showPanel(win,'reading',{surface:'tab'});await showPanel(win,'reading',{surface:'floating'});return node;},
          openView:view => showPanel(win,view,{surface:'tab'}),
          isVisible:() => surface==='tab' ? record.host?.selected() : floatingVisible(record),
          presentation:(_mode,view) => {
            if(surface!=='tab')return;
            const node=view?.nodeId && store?.getSession(view.nodeId);
            const title=view?.screen==='settings' ? t("settingsTab") : store?.snapshot().workspace.view==='knowledge' ? t("treeTab") : node ? t('conceptTab',{concept:node.concept}) : t("appName");
            void record.host?.rename(title).catch(() => {});
          },
          dismiss:async () => {
            await content.ConceptPanel.flushViews();
            if(surface==='tab')record.host?.close();
            else {record.overlayVisible=false;hideFloating(record);}
          },
        };
        await content.ConceptPanel.init(initial,{surface});
        if(surface==='floating') record.floatingWindow=createFloatingWindow({window:win,frame,interact:content.interact,locale:l10n.locale,
          initialPosition:prefGet('floatingWindowPosition'),
          onSave:position => prefSet('floatingWindowPosition',JSON.stringify(position)),
          onError:error => reportError(win,error),
        });
      }});
      frame.src=uri;container.append(frame);
      try {await record.loaded[surface];}
      catch(error) {
        if(record.frames[surface] !== frame || !alive || win.closed) return;
        if(surface==='floating') {record.floatingWindow?.dispose();record.floatingWindow=null;}
        frame.remove();record.frames[surface]=null;record.loaded[surface]=null;if(surface==='tab')record.host?.close();throw error;
      }
      if(record.frames[surface] !== frame || !alive || win.closed) return;
    } else {
      record.frames[surface].style.display='block';await record.loaded[surface];
      await record.frames[surface].contentWindow.ConceptPanel.open(initial);
    }
    if(surface==='tab' && select) record.host.ensure({select:true});
    syncFloating(record);notify();return record.frames[surface];
  }
  const tabObserver=Zotero.Notifier.registerObserver({notify(event,type,ids) {
    if(type!=='tab' || event!=='select')return;
    for(const record of windows.values()) {
      if(!record.win.Zotero_Tabs)continue;
      syncFloating(record);
      try {void record.frames.tab?.contentWindow?.ConceptPanel?.visibilityChanged(record.host?.selected()).catch(() => {});}catch {}
    }
  }},['tab'],id+'-tabs');
  function selectionContext(doc,annotation) {
    const selected=String(annotation?.text ?? '').trim();
    const docs=[doc];
    for (const iframe of doc?.querySelectorAll('iframe') ?? []) { try { if (iframe.contentDocument) docs.push(iframe.contentDocument); } catch {} }
    for (const current of docs) {
      const selection=current.defaultView?.getSelection();
      if (!selection || !selection.toString().trim()) continue;
      let element=selection.anchorNode?.nodeType === 1 ? selection.anchorNode : selection.anchorNode?.parentElement;
      element=element?.closest('.textLayer,p,article') ?? element;
      const text=element?.textContent?.replace(/\s+/g,' ').trim() ?? '';
      if (text) {
        const pos=text.indexOf(selected);
        return text.slice(Math.max(0,pos-1200),Math.max(0,pos)+selected.length+1800);
      }
    }
    return selected;
  }
  async function explainSelection(reader,annotation,doc,{fullText=false}={}) {
    const win=reader?._window ?? Zotero.getMainWindow();
    try {
      requireStore();
      const selected=String(annotation?.text ?? '').trim();
      if (!selected) throw new Error(t("readerSelectionRequired"));
      if (selected.length > MAX_SELECTION_LENGTH) throw new Error(t('selectionTooLong',{limit:MAX_SELECTION_LENGTH}));
      const attachment=Zotero.Items.get(reader.itemID);
      const item=attachment?.parentItem ?? attachment;
      if (!attachment || !item) throw new Error(t("attachmentUnknown"));
      watchReader(reader,doc);
      const {node,reused}=await annotationSessions.select({attachment,item,annotation,context:selectionContext(doc,annotation),title:item.getField('title') || reader._title || selected});
      await annotationSessions.reconcile();
      if(!store.snapshot().nodes.some(candidate=>candidate.id===node.id))throw new Error(t('highlightDeleted'));
      await showPanel(win,'reading',{surface:'floating'});notify();
      startSelectionAnswer(node.id,{fullText,generateNew:!reused});
      return node;
    } catch (error) {
      await showPanel(win,'reading');
      reportError(win,error);
      return null;
    }
  }
  const selectionHandler=event => {
    if (!alive) return;
    const {reader,doc,params,append}=event;watchReader(reader,doc);
    const selected=String(params?.annotation?.text ?? '').trim(); if (!selected) return;
    const win=reader._window ?? Zotero.getMainWindow(); addWindow(win);
    const annotation=plain(params.annotation);
    windows.get(win).selection={reader,annotation,doc};
    for(const [label,title,fullText] of [['explain','explainConceptTitle',false],['explainFullText','explainFullTextTitle',true]]) {
      const button=doc.createElement('button');
      button.dataset.conceptExplorerLabel=label;button.dataset.conceptExplorerTitle=title;
      button.dataset.conceptExplorerContext=fullText ? 'full-paper' : 'selection';
      button.textContent=t(label);button.className='concept-explorer-reader-button';
      button.setAttribute('type','button');button.title=t(title);
      button.style.cssText='padding:7px 11px;margin:4px;border:1px solid #8faab4;border-radius:7px;font:inherit;color:#126c70;background:#f0f9f7;cursor:pointer;';
      button.addEventListener('pointerdown',event=>event.preventDefault());
      button.addEventListener('click',event=>{event.preventDefault();void explainSelection(reader,annotation,doc,{fullText});});
      trackNode(button);append(button);
    }
  };
  const toolbarHandler=event => {
    if (!alive) return;
    watchReader(event.reader,event.doc);
    const button=event.doc.createElement('button');button.dataset.conceptExplorerLabel='knowledge';button.dataset.conceptExplorerTitle='menuTree'; button.textContent=t("knowledge"); button.title=t("menuTree");
    button.setAttribute('type','button'); button.className='toolbar-button';
    button.style.cssText='font:inherit;font-size:12px;padding:0 8px;color:inherit;';
    button.addEventListener('click',() => openSafely(event.reader._window ?? Zotero.getMainWindow(),'knowledge'));
    trackNode(button); event.append(button);
  };
  const annotationHeaderHandler=event=>{
    if(!alive || !annotationSessions)return;watchReader(event.reader,event.doc);
    const key=event.params?.annotation?.id,attachment=Zotero.Items.get(event.reader.itemID);
    if(!key || !attachment || !annotationSessions.has(attachment,key))return;
    const button=event.doc.createElement('button');button.type='button';button.dataset.conceptExplorerLabel='viewHighlightConversation';button.textContent=t('viewHighlightConversation');
    button.style.cssText='font:inherit;font-size:11px;padding:3px 6px;cursor:pointer;';
    button.addEventListener('click',click=>{click.preventDefault();click.stopPropagation();void openAnnotation(event.reader,key).catch(annotationError);});trackNode(button);event.append(button);
  };
  Zotero.Reader.registerEventListener('renderSidebarAnnotationHeader',annotationHeaderHandler,id);
  Zotero.Reader.registerEventListener('renderTextSelectionPopup',selectionHandler,id);
  Zotero.Reader.registerEventListener('renderToolbar',toolbarHandler,id);
  for (const win of Zotero.getMainWindows()) addWindow(win);
  if(annotationSessions) {try{await annotationSessions.reconcile();}catch{annotationError();}}
  for(const reader of Zotero.Reader._readers ?? [])watchReader(reader);
  const api={version,store,storage,snapshot,showPanel,explainSelection,openAnnotation,addWindow,removeWindow,
    async shutdown() {
      if (!alive) return;
      alive=false;
      shutdownHandle.run=null;
      for (const job of jobs.values()) { job.cancelled=true; try { job.cancel?.(); } catch {} }
      for (const record of windows.values()) { try { await flushRecord(record); } catch {} }
      if(annotationObserver!==null)Zotero.Notifier.unregisterObserver(annotationObserver);
      for(const watched of readerWatches.values())watched.dispose();readerWatches.clear();
      if(annotationSessions)await annotationSessions.flush();
      if (store) await store.flush();
      Zotero.Notifier.unregisterObserver(tabObserver);
      for (const win of [...windows.keys()]) removeWindow(win);
      // Persist the host's normal tab session after removing only our own UI.
      await Zotero.Session?.save();
      eventNodes.removeAll();
      // Zotero removes pluginID listeners on shutdown. Its manual unregister API is not used.
      if (Zotero.ConceptExplorer === api) delete Zotero.ConceptExplorer;
    }
  };
  const shutdownHandle={run:() => api.shutdown()};
  Zotero.addShutdownListener(() => shutdownHandle.run?.());
  Zotero.ConceptExplorer=api;
  if(prefGet('workspaceTabOpen') && store) {
    const win=Zotero.getMainWindow();
    if(win) void showPanel(win,store.snapshot().workspace.view==='knowledge' ? 'knowledge' : 'reading',{surface:'tab',select:false}).catch(error => reportError(win,error));
  }
  return api;
}
