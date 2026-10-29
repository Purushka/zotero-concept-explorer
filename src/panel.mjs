import {createLocalizer,translateDOM} from './localization.mjs';
import {captureExplanationSelection} from './explanation-selection.mjs';
import {createSafeMarkdown,hydrateMath} from './safe-markdown.mjs';
import {endpointFor} from './model-adapter.mjs';
import {recoverExplanation,normalizeAnswer} from './explanation-format.mjs';
const l10n=createLocalizer();
const t=(key,values)=>l10n.t(key,values);
const $=selector => document.querySelector(selector);
const articles=new Map(),dirty=new Map();
let state,screen='reading',surface='auto',markdown,saveTimer,anchor,actionQueue=Promise.resolve();
const bridge=() => window.ConceptBridge;
const selectionMenu=document.createElement('div');
selectionMenu.id='explanation-selection-menu';selectionMenu.className='selection-explain';selectionMenu.hidden=true;
selectionMenu.setAttribute('role','group');selectionMenu.dataset.i18nAriaLabel='explainSelection';
for(const [id,label,title,fullText] of [['explanation-selection','explain','selectionChild',false],['explanation-selection-full-text','explainFullText','explainFullTextTitle',true]]) {
  const button=document.createElement('button');button.id=id;button.type='button';button.className=fullText ? '' : 'primary';
  button.dataset.i18n=label;button.textContent=t(label);button.dataset.i18nTitle=title;button.title=t(title);
  button.addEventListener('click',()=>{
    const target=selectionTarget;if(!target?.article.isConnected || target.article.hidden){hideSelection();return;}
    hideSelection();window.getSelection()?.removeAllRanges();anchor=null;
    void perform(async()=>{screen='reading';await bridge().child(target.nodeId,target.text,target.context,{fullText});});
  });
  selectionMenu.append(button);
}
document.body.append(selectionMenu);
let selectionTarget=null,selectionRevision=0;
function hideSelection() {selectionTarget=null;selectionMenu.hidden=true;selectionRevision++;}
async function showSelection() {
  if(screen!=='reading' || bridge().isVisible?.()===false){hideSelection();return;}
  const target=captureExplanationSelection(window.getSelection());if(!target){hideSelection();return;}
  selectionTarget=target;selectionMenu.hidden=false;
  selectionMenu.setAttribute('aria-label',t('selectionLabel',{text:target.text.slice(0,80)}));
  const rect=target.range.getBoundingClientRect(),revision=++selectionRevision;
  if(window.FloatingUIDOM){
    const {computePosition,offset,flip,shift}=window.FloatingUIDOM;
    const point=await computePosition({getBoundingClientRect:()=>rect,contextElement:target.article},selectionMenu,{strategy:'fixed',placement:'top',middleware:[offset(8),flip(),shift({padding:10})]});
    if(revision!==selectionRevision)return;
    Object.assign(selectionMenu.style,{left:point.x+'px',top:point.y+'px'});
  }else Object.assign(selectionMenu.style,{left:Math.max(10,rect.left)+'px',top:Math.max(10,rect.top-42)+'px'});
}
selectionMenu.addEventListener('pointerdown',event=>event.preventDefault());
document.addEventListener('selectionchange',()=>{void showSelection().catch(()=>hideSelection());});
document.addEventListener('pointerdown',event=>{if(event.target.closest?.('[data-action=selection-child]'))event.preventDefault();if(!selectionMenu.contains(event.target))hideSelection();});
document.addEventListener('scroll',hideSelection,true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')hideSelection();});
function element(tag,text,className) { const result=document.createElement(tag); if (text != null) result.textContent=text; if (className) result.className=className; return result; }
function renderMarkdown(container,text,inline=false) {
  container.innerHTML=inline ? markdown.inline(text) : markdown(text);
  hydrateMath(container,window.katex);
  // Hydrate only placeholders emitted by markdown-it; model HTML remains disabled.
  for (const token of container.querySelectorAll('span.concept-token')) {
    const button=element('button',token.textContent,'concept-link');button.type='button';button.dataset.concept=token.textContent;token.replaceWith(button);
  }
}
function updateComposerPreview(article) {
  const preview=article.querySelector('.composer-preview'),body=preview.querySelector('.preview-content');
  renderMarkdown(body,article.querySelector('textarea').value);
  preview.hidden=!body.querySelector('.katex,.katex-error,.math-error');
}
function resizeComposer(article) {
  const input=article.querySelector('textarea');
  if(!input.isConnected || !input.getClientRects().length)return;
  input.style.height='0px';
  const height=Math.min(176,Math.max(40,input.scrollHeight+2));
  input.style.height=height+'px';input.style.overflowY=input.scrollHeight>height ? 'auto' : 'hidden';
}
function updateSendButton(article) {
  const busy=state?.jobs.some(job=>job.nodeId===article.dataset.nodeId && job.status==='loading');
  const button=article.querySelector('.composer-send');
  button.dataset.state=busy ? 'stop' : 'send';
  button.setAttribute('aria-label',t(busy ? 'stop' : 'send'));button.title=t(busy ? 'stop' : 'sendHint');
  button.disabled=!busy && !article.querySelector('textarea').value.trim();
  button.querySelector('.send-arrow').toggleAttribute('hidden',busy);button.querySelector('.stop-square').toggleAttribute('hidden',!busy);
}
function createSendButton() {
  const button=element('button',null,'composer-send');button.type='submit';
  const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg');
  icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
  const arrow=document.createElementNS(ns,'path');arrow.setAttribute('d','M12 19V5m-6 6 6-6 6 6');arrow.setAttribute('fill','none');arrow.setAttribute('stroke','currentColor');arrow.setAttribute('stroke-width','2.5');arrow.setAttribute('stroke-linecap','round');arrow.setAttribute('stroke-linejoin','round');arrow.classList.add('send-arrow');
  const stop=document.createElementNS(ns,'rect');stop.setAttribute('x','6');stop.setAttribute('y','6');stop.setAttribute('width','12');stop.setAttribute('height','12');stop.setAttribute('rx','1');stop.setAttribute('fill','currentColor');stop.classList.add('stop-square');stop.setAttribute('hidden','');
  icon.append(arrow,stop);button.append(icon);return button;
}
function fullTextButton(nodeId,messageId) {
  const button=navigationButton(t('fullTextAgain'),'full-text',nodeId,'full-text-again');
  button.dataset.i18n='fullTextAgain';button.title=t('fullTextHint');button.dataset.i18nTitle='fullTextHint';
  if(messageId)button.dataset.messageId=messageId;return button;
}
function showError(message) { $('#notice').textContent=l10n.message(message); $('#notice').hidden=false; $('#save-status').textContent=t("saveError"); }
function info(message) { $('#notice').textContent=l10n.message(message); $('#notice').hidden=false; }
function queueView(nodeId,patch) {
  if (!nodeById(nodeId)) return;
  dirty.set(nodeId,{...dirty.get(nodeId),...patch}); $('#save-status').textContent=t("saving");
  clearTimeout(saveTimer); saveTimer=setTimeout(() => void flushViews().catch(error => showError(error.message)),350);
}
async function flushViews() {
  clearTimeout(saveTimer);
  const captured=[...dirty];
  for (const [nodeId,patch] of captured) {
    if (!nodeById(nodeId)) { if (dirty.get(nodeId) === patch) dirty.delete(nodeId); continue; }
    await bridge().mutate('saveSessionView',[nodeId,patch]);
    if (dirty.get(nodeId) === patch) dirty.delete(nodeId);
  }
  if (!dirty.size) $('#save-status').textContent=t("saved");
}
function perform(action) {
  actionQueue=actionQueue.catch(() => {}).then(async () => {
    try { await flushViews(); await action(); }
    catch (error) { showError(error.message); }
  });
  return actionQueue;
}
function nodeById(id) { return state?.archive?.nodes.find(node => node.id === id); }
function docById(id) { return state?.archive?.documents.find(doc => doc.id === id); }
function currentId() { const w=state.archive?.workspace; if(surface==='floating')return w?.floatingNodeId;return w?.view === 'knowledge' ? (nodeById(w.treeSelectionId)?.id ?? null) : surface==='tab' ? (w?.pageNodeId ?? w?.floatingNodeId) : (w?.floatingNodeId ?? w?.pageNodeId); }
const actionLabels={expand:'expand',shrink:'shrink',parent:'parent',original:'original','selection-child':'explainSelection','delete-node':'deleteNode',cancel:'stop'};
function navigationButton(text,action,id,className='') { const b=element('button',text,className); b.type='button'; b.dataset.action=action; if (id) b.dataset.id=id; if(actionLabels[action])b.dataset.i18n=actionLabels[action]; return b; }
function createArticle(node) {
  const article=element('article',null,'session'); article.dataset.nodeId=node.id;
  // Build forms/buttons with DOM APIs: privileged Gecko innerHTML strips forms.
  const header=element('header',null,'session-header');
  const crumbs=element('div',null,'breadcrumbs');crumbs.setAttribute('aria-label',t("conceptHierarchy"));crumbs.dataset.i18nAriaLabel='conceptHierarchy';header.append(crumbs);
  const title=element('div',null,'session-title'),close=navigationButton('×','close-session',null,'close');
  close.setAttribute('aria-label',t("closeSession"));close.dataset.i18nAriaLabel='closeSession';title.append(element('h1'),close);header.append(title);
  const actions=element('div',null,'session-actions');
  for (const [label,action,className] of [[t("expand"),'expand','primary'],[t("shrink"),'shrink',''],[t("parent"),'parent',''],[t("original"),'original',''],[t("explainSelection"),'selection-child',''],[t("deleteNode"),'delete-node','danger']]) actions.append(navigationButton(label,action,null,className));
  header.append(actions);
  const body=element('div',null,'session-body');
  for (const className of ['answer','answer-actions','messages','stream-preview','job-state','source']) {
    const part=element('div',null,className);if (className === 'job-state') part.setAttribute('role','status');body.append(part);
  }
  body.querySelector('.answer-actions').append(fullTextButton(node.id));
  const form=element('form',null,'composer'),input=element('textarea'),send=createSendButton();
  input.dataset.i18nAriaLabel='followupLabel';input.dataset.i18nPlaceholder='followupPlaceholder';input.dataset.i18nTitle='sendHint';input.title=t('sendHint');input.setAttribute('aria-label',t("followupLabel"));input.placeholder=t("followupPlaceholder");input.rows=1;send.type='submit';
  const preview=element('div',null,'composer-preview');preview.hidden=true;
  const previewLabel=element('small',t('formulaPreview'));previewLabel.dataset.i18n='formulaPreview';
  preview.append(previewLabel,element('div',null,'preview-content'));
  form.append(preview,input,send);article.append(header,body,form);
  article.querySelector('textarea').value=node.view.draft;
  article.querySelector('textarea').addEventListener('input',event => {queueView(node.id,{draft:event.target.value});updateComposerPreview(article);resizeComposer(article);updateSendButton(article);});
  article.querySelector('.session-body').addEventListener('scroll',event => {
    if (!article.isConnected || bridge().isVisible?.() === false) return;
    const record=articles.get(node.id);
    // Restoring a hidden/short article may clamp its scroll position. Do not
    // treat that programmatic event as a new user position and lose the archive.
    if (record?.restoredScrollTop != null && Math.abs(event.target.scrollTop-record.restoredScrollTop)<=1) {
      record.restoredScrollTop=null; return;
    }
    const desired=dirty.get(node.id)?.scrollTop ?? nodeById(node.id)?.view.scrollTop ?? 0;
    if (Math.abs(event.target.scrollTop-desired)>1) queueView(node.id,{scrollTop:event.target.scrollTop});
  });
  let submitting=false;
  article.querySelector('form').addEventListener('submit',event => {
    event.preventDefault();
    if(state.jobs.some(job=>job.nodeId===node.id && job.status==='loading')) {void bridge().cancel(node.id);return;}
    const input=article.querySelector('textarea'),question=input.value.trim();if(!question || input.disabled || submitting)return;
    submitting=true;
    void perform(async () => {
      input.disabled=true;
      try {
        await bridge().ask(node.id,question);
        input.value='';
        queueView(node.id,{draft:''});
      } finally { input.disabled=false;resizeComposer(article);updateComposerPreview(article);updateSendButton(article);input.focus(); }
    }).finally(()=>{submitting=false;});
  });
  let composing=false;
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;});
  input.addEventListener('keydown',event=>{
    if(event.key!=='Enter' || event.shiftKey || event.isComposing || composing || event.keyCode===229)return;
    event.preventDefault();
    if(!state.jobs.some(job=>job.nodeId===node.id && job.status==='loading'))form.requestSubmit();
  });
  let width=0;
  const observer=typeof ResizeObserver==='function' ? new ResizeObserver(entries=>{const next=entries[0].contentRect.width;if(next!==width){width=next;resizeComposer(article);}}) : null;
  observer?.observe(form);
  const record={article,observer,signatures:{},restoredScrollTop:null};articles.set(node.id,record);return record;
}
function fillArticle(node,compact=false) {
  const record=articles.get(node.id) ?? createArticle(node);
  const a=record.article;translateDOM(a,l10n); a.classList.toggle('compact',compact); a.hidden=false;
  renderMarkdown(a.querySelector('h1'),node.concept.length>100 || node.concept.includes('\n') ? t('selectionExplanation') : node.concept,true);
  const path=[]; let pointer=node;
  while (pointer) { path.unshift(pointer); pointer=nodeById(pointer.parentId); }
  const crumbs=a.querySelector('.breadcrumbs'); crumbs.replaceChildren();
  crumbs.append(navigationButton(docById(node.documentId)?.title || t("paper"),'original',node.id));
  for (const part of path) { crumbs.append(element('span','›'),navigationButton(part.concept,'open',part.id)); }
  const job=state.jobs.find(job => job.nodeId === node.id);
  const explanation=recoverExplanation(node.explanation);
  function changed(part,value) {
    const signature=JSON.stringify(value);if(record.signatures[part]===signature)return false;
    record.signatures[part]=signature;return true;
  }
  function explanationSections(container,value) {
    container.replaceChildren();
    if(value?.summary) {const summary=element('section',null,'summary');renderMarkdown(summary,value.summary);container.append(summary);}
    if(value?.detail) {const detail=element('section',null,'detail');renderMarkdown(detail,value.detail);container.append(detail);}
  }
  if(changed('answer',explanation))explanationSections(a.querySelector('.answer'),explanation);
  if(changed('messages',[l10n.locale,node.messages])) {
    const messages=a.querySelector('.messages');messages.replaceChildren();
    for (const [index,message] of node.messages.entries()) {
      const box=element('div',null,'message '+message.role);box.append(element('small',message.role==='user' ? t("yourQuestion") : t("furtherExplanation")));
      const body=element('div');renderMarkdown(body,message.role==='assistant' ? normalizeAnswer(message.content) : message.content);box.append(body);
      if(message.role==='assistant' && node.messages[index-1]?.role==='user')box.append(fullTextButton(node.id,message.id));
      messages.append(box);
    }
  }
  if(changed('preview',[l10n.locale,job?.status,job?.preview,job?.text])) {
    const temporary=a.querySelector('.stream-preview');temporary.replaceChildren();
    const available=job?.status!=='saved' && (job?.preview?.summary || job?.preview?.detail || job?.text);
    temporary.hidden=!available;temporary.setAttribute('aria-busy',String(job?.status==='loading'));
    if(available) {
      temporary.append(element('small',job.status==='loading' ? t("generating") : t("temporary"),'stream-label'));
      if(job.kind==='explanation') {const content=element('div');explanationSections(content,job.preview);temporary.append(content);}
      else {const box=element('div',null,'message assistant'),body=element('div');renderMarkdown(body,job.text);box.append(body);temporary.append(box);}
    }
  }
  if(changed('status',[l10n.locale,job?.status,job?.error,job?.kind,node.messages.at(-1)?.role,!!explanation.detail])) {
    const status=a.querySelector('.job-state'); status.replaceChildren();
    if(job?.status==='loading') {
      // Generation and cancellation are represented by the composer button.
    } else if(job?.error) {
      const error=element('div',l10n.message(job.error),'job-error');error.append(navigationButton(job.kind==='ask' ? t("retryQuestion") : t("regenerate"),'retry',node.id));status.append(error);
    } else if(node.messages.at(-1)?.role==='user') {
      const pending=element('div',t("unanswered"),'pending');pending.append(navigationButton(t("continueAnswer"),'retry',node.id));status.append(pending);
    } else if(!explanation.detail) {
      const empty=element('div',t("noExplanation"),'pending');empty.append(navigationButton(t("generate"),'retry',node.id));status.append(empty);
    }
  }
  if(changed('source',[l10n.locale,docById(node.documentId)?.title,node.source])) {
    const source=a.querySelector('.source');source.replaceChildren();
    source.append(element('small',t('source',{title:docById(node.documentId)?.title || t('paper')})+(node.source.location.pageIndex===null ? '' : t('sourcePage',{page:node.source.location.pageIndex+1}))));
    const content=element('div',null,'source-content');renderMarkdown(content,node.source.selectedText);source.append(content);
  }
  const local=dirty.get(node.id);
  if (local && Object.hasOwn(local,'draft')) a.querySelector('textarea').value=local.draft;
  else if (document.activeElement !== a.querySelector('textarea')) a.querySelector('textarea').value=node.view.draft;
  updateComposerPreview(a);
  resizeComposer(a);updateSendButton(a);
  a.querySelector('.answer-actions').hidden=!explanation.summary && !explanation.detail;
  for(const button of a.querySelectorAll('[data-action=full-text]'))button.disabled=job?.status==='loading';
  a.querySelector('[data-action=parent]').disabled=!node.parentId && !compact;
  a.querySelector('.close').hidden=!compact;
  a.querySelector('[data-action=shrink]').hidden=compact || state.archive.workspace.view === 'knowledge';
  return a;
}
function passageLabel(text) {return text.length>100 ? text.replace(/\s+/g,' ').slice(0,70)+'…' : text;}
function renderTree() {
  const tree=$('#tree'); tree.replaceChildren();
  const archive=state.archive; if (!archive) return;
  $('#tree-count').textContent=t('nodeCount',{count:archive.nodes.length});
  const w=archive.workspace;
  const children=new Map();
  for (const node of archive.nodes) { const key=node.parentId ?? node.documentId; if (!children.has(key)) children.set(key,[]); children.get(key).push(node); }
  const stack=[];
  const docs=w.view === 'knowledge' ? archive.documents : archive.documents.filter(doc => doc.id === w.activeDocumentId);
  for (const doc of docs) {
    const title=navigationButton(doc.title || t("untitledPaper"),'select-document',doc.id,'tree-doc'); tree.append(title);
    stack.push(...(children.get(doc.id) ?? []).slice().reverse().map(node => ({node,depth:0})));
    while (stack.length) {
      const {node,depth}=stack.pop(); const b=navigationButton(passageLabel(node.concept),w.view === 'knowledge' ? 'select-tree' : 'open',node.id,'tree-node');
      b.style.setProperty('--depth',depth); b.setAttribute('role','treeitem'); b.setAttribute('aria-level',String(depth+2));
      b.prepend(element('span',depth === 0 ? '◇' : '↳')); b.classList.toggle('active',node.id === currentId() || node.id === w.pageNodeId);
      const row=element('div',null,'tree-row');
      const remove=navigationButton(t("delete"),'delete-node',node.id,'tree-delete danger');
      remove.title=t('deleteTitle',{concept:node.concept});remove.setAttribute('aria-label',remove.title);
      row.append(b,remove);tree.append(row); stack.push(...(children.get(node.id) ?? []).slice().reverse().map(child => ({node:child,depth:depth+1})));
    }
  }
}
function renderTabs() {
  const tabs=$('#retained'); tabs.replaceChildren(); const w=state.archive?.workspace; if (!w) return;
  const nodes=state.archive.nodes.filter(node => w.openNodeIds.includes(node.id) && (w.view === 'knowledge' || node.documentId === w.activeDocumentId));
  for (const node of nodes) { const b=navigationButton(passageLabel(node.concept),'open',node.id); b.classList.toggle('active',node.id === w.pageNodeId || node.id === w.floatingNodeId); b.title=t('restorePage',{concept:node.concept}); tabs.append(b); }
}
async function positionFloating() {
  const slot=$('#floating-slot');
  if (document.body.classList.contains('standalone') || !slot.children.length || !anchor?.isConnected || !window.FloatingUIDOM) { slot.style.left='';slot.style.top='';slot.style.right='';slot.style.position=''; return; }
  const {computePosition,offset,flip,shift}=window.FloatingUIDOM;
  const result=await computePosition(anchor,slot,{strategy:'fixed',placement:'bottom-start',middleware:[offset(12),flip(),shift({padding:18})]});
  Object.assign(slot.style,{position:'fixed',left:result.x+'px',top:result.y+'px',right:'auto'});
}
function render() {
  if (!state) return;
  if (state.startupError) showError(state.startupError);
  const w=state.archive?.workspace;
  const knowledge=surface!=='floating' && w?.view === 'knowledge';
  const full=surface === 'tab' || (surface !== 'floating' && (screen === 'settings' || knowledge || !!w?.pageNodeId));
  document.body.classList.toggle('standalone',!full);
  document.body.classList.toggle('native-tab',surface === 'tab');
  bridge().presentation(full ? 'page' : 'floating',{screen,nodeId:currentId()});
  $('#settings').hidden=screen !== 'settings'; $('#workspace').hidden=screen === 'settings'; $('#retained').hidden=screen === 'settings';
  for (const record of articles.values()) record.article.hidden=true;
  renderTree();renderTabs();
  if(screen!=='reading')hideSelection();
  const pageId=surface === 'floating' ? null : knowledge ? nodeById(w?.treeSelectionId)?.id : w?.pageNodeId ?? (surface === 'tab' ? w?.floatingNodeId : null);
  const pageNode=nodeById(pageId);
  const floatNode=surface==='tab' || knowledge || (surface!=='floating' && w?.floatingNodeId === pageId) ? null : nodeById(w?.floatingNodeId);
  for (const [selector,node,compact] of [['#page-slot',pageNode,false],['#floating-slot',floatNode,true]]) {
    const slot=$(selector),article=node ? fillArticle(node,compact) : null;
    if (slot.firstElementChild !== article) slot.replaceChildren(...(article ? [article] : []));
  }
  $('#empty').hidden=!!pageNode || !!floatNode;
  for (const id of [pageId,floatNode?.id]) {
    const node=nodeById(id); if (!node) continue;
    const record=articles.get(id); const target=dirty.get(id)?.scrollTop ?? node.view.scrollTop;
    resizeComposer(record.article);
    const body=record.article.querySelector('.session-body');
    if (Math.abs(body.scrollTop-target)>1) { body.scrollTop=target; record.restoredScrollTop=body.scrollTop; }
  }
  if(selectionTarget && (!selectionTarget.article.isConnected || selectionTarget.article.hidden))hideSelection();
  void positionFloating();
}
async function update(value) {
  state=value;
  if(value.locale && l10n.setLocale(value.locale)) {translateDOM(document,l10n);document.documentElement.lang=l10n.locale;previewEndpoint();const savedKey=$('#key-state').dataset.hasKey;$('#key-state').textContent=t(savedKey==='true' ? 'keySaved' : 'keyMissing');}
  if(value.language && document.activeElement!==$('#language-select'))$('#language-select').value=value.language;
  if(value.version)$('#version').textContent='v'+value.version;
  if (state.archive) {
    const live=new Set(state.archive.nodes.map(node => node.id));
    for (const [id,record] of articles) if (!live.has(id)) { record.observer?.disconnect();record.article.remove();articles.delete(id);dirty.delete(id); }
    for (const id of dirty.keys()) if (!live.has(id)) dirty.delete(id);
  }
  render();
}
async function loadSettings() {
  const value=await bridge().settings(),form=$('#settings-form');
  for (const key of ['protocol','baseURL','model']) form.elements[key].value=value[key] ?? '';
  $('#language-select').value=value.language ?? 'auto';
  form.elements.key.value=''; form.elements.clearKey.checked=false;
  $('#key-state').dataset.hasKey=String(!!value.hasKey);
  $('#key-state').textContent=value.hasKey ? t("keySaved") : t("keyMissing");
  $('#archive-path').textContent=value.archivePath; $('#version').textContent='v'+value.version; previewEndpoint();
}
function previewEndpoint() {
  const f=$('#settings-form');
  try { $('#endpoint-preview').textContent=t('endpointPreview',{url:endpointFor(f.elements.protocol.value,f.elements.baseURL.value)}); }
  catch { $('#endpoint-preview').textContent=t("endpointHelp"); }
}
async function open(initial) { screen=initial === 'settings' ? 'settings' : 'reading'; await update(await bridge().state()); if (screen === 'settings') await loadSettings(); }

document.addEventListener('click',event => {
  const concept=event.target.closest('[data-concept]');
  const button=event.target.closest('[data-action]');
  if (!concept && !button) return;
  event.preventDefault();
  const article=(concept ?? button).closest('[data-node-id]');
  const id=button?.dataset.id ?? article?.dataset.nodeId;
  if (concept) {
    anchor=concept;
    void perform(async () => {
      screen='reading';
      await bridge().child(article.dataset.nodeId,concept.dataset.concept,concept.closest('.summary,.detail,.message')?.textContent ?? '');
    });
    return;
  }
  void perform(async () => {
    switch (button.dataset.action) {
      case 'reading': screen='reading'; anchor=null; await bridge().mutate('resumeReading'); break;
      case 'knowledge': screen='reading'; anchor=null; await bridge().mutate('showKnowledgeTree'); break;
      case 'settings':
        if (bridge().openView) await bridge().openView('settings');
        else { screen='settings'; await loadSettings(); render(); }
        break;
      case 'dismiss': await bridge().dismiss(); break;
      case 'open': screen='reading'; anchor=null; await bridge().mutate('openSession',[id,'page']); break;
      case 'select-tree': await bridge().mutate('showKnowledgeTree',[id]); break;
      case 'select-document':
        if (state.archive.workspace.view === 'knowledge') await bridge().mutate('showKnowledgeTree',[id]);
        else await bridge().mutate('openDocument',[id]);
        break;
      case 'expand': anchor=null; await bridge().mutate('openSession',[id,'page']); break;
      case 'shrink': anchor=null; await bridge().mutate('openSession',[id,'floating']); break;
      case 'parent':
        anchor=null;
        if (nodeById(id)?.parentId) await bridge().mutate('openSession',[nodeById(id).parentId,'page']);
        else { await bridge().mutate('closeFloating'); await bridge().dismiss(); }
        break;
      case 'close-session': anchor=null; await bridge().mutate('closeFloating'); if (!state.archive.workspace.pageNodeId) await bridge().dismiss(); break;
      case 'original':
        await bridge().navigateOriginal(id);
        // A native workbench is a retained Zotero tab, not a disposable overlay.
        // The floating view stays available on the source PDF and our own tab.
        break;
      case 'selection-child': {
        const target=captureExplanationSelection(window.getSelection());
        if (!target || target.article !== article) throw new Error(t("selectionRequired"));
        hideSelection();window.getSelection()?.removeAllRanges();
        screen='reading'; anchor=null; await bridge().child(id,target.text,target.context); break;
      }
      case 'delete-node': {
        hideSelection();anchor=null;button.disabled=true;
        try {
          const result=await bridge().deleteSession(id);
          if (result) info(t('deletedCount',{count:result.deletedNodeIds.length})+(result.mode==='node' && result.reparentedNodeIds.length ? t("promotedChildren") : t("otherNodesKept")));
        }
        finally { if (button.isConnected) button.disabled=false; }
        break;
      }
      case 'full-text': await bridge().regenerateFullText(id,button.dataset.messageId ?? null);break;
      case 'cancel': await bridge().cancel(id); break;
      case 'retry': await bridge().retry(id); break;
      case 'probe':
        button.disabled=true; info(t("probing"));
        try { info(await bridge().probe()); } finally { button.disabled=false; }
        break;
    }
  });
});
$('#language-select').addEventListener('change',event => {
  const choice=event.target.value;
  void perform(async()=>{
    event.target.disabled=true;
    try {await bridge().saveLanguage(choice);await update(await bridge().state());info(t('languageSaved'));}
    catch(error){event.target.value=state?.language ?? 'auto';throw error;}
    finally{event.target.disabled=false;}
  });
});
$('#settings-form').addEventListener('input',previewEndpoint);
$('#settings-form').addEventListener('submit',event => {
  event.preventDefault();
  void perform(async () => {
    const form=event.target,submit=form.querySelector('[type=submit]');
    submit.disabled=true;
    try {
      await bridge().saveSettings({protocol:form.elements.protocol.value,baseURL:form.elements.baseURL.value,model:form.elements.model.value,key:form.elements.key.value.trim(),clearKey:form.elements.clearKey.checked});
      form.elements.key.value=''; await loadSettings(); info(t("settingsSaved"));
    } finally { submit.disabled=false; }
  });
});
window.addEventListener('beforeunload',() => { void flushViews().catch(() => {}); });
document.addEventListener('visibilitychange',() => { if (document.hidden) void flushViews().catch(() => {}); });
window.addEventListener('resize',() => { void positionFloating(); });
window.ConceptPanel={
  async init(initial='reading',options={}) { translateDOM(document,l10n);document.documentElement.lang=l10n.locale;surface=options.surface ?? 'auto'; markdown=createSafeMarkdown(window.markdownit,{conceptPlaceholders:true,mathPlaceholders:true,katex:window.katex}); await open(initial); },
  async visibilityChanged(visible) { if(!visible) {hideSelection();await flushViews();} else render(); },
  open,update,showError,flushViews
};
