// Never installed in a real profile. All papers, answers and Keys are synthetic.
var watcher;
const formulaText=__MATH_JSON__;
const ROOT=__ROOT_JSON__,local=n=>PathUtils.join(ROOT,n),DATA=local('data');
function install(){}function uninstall(){}function shutdown(){if(watcher)clearInterval(watcher);}
function startup(){setTimeout(()=>void run().catch(async e=>{await IOUtils.writeJSON(local('failed.json'),{message:String(e),stack:e.stack});}),1000);}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label){for(let i=0;i<320;i++){const value=await fn();if(value)return value;await pause(100);}throw Error('Timed out: '+label);}
function assert(value,label){if(!value)throw Error(label);}
function same(a,b,label){assert(JSON.stringify(a)===JSON.stringify(b),label);}
async function run(){
 await Zotero.initializationPromise;await Zotero.uiReadyPromise;
 assert(Zotero.DataDirectory.dir.replaceAll('\\','/').toLowerCase()===DATA.replaceAll('\\','/').toLowerCase(),'Refusing non-test data directory');
 watcher=setInterval(async()=>{if(await IOUtils.exists(local('stop'))){clearInterval(watcher);watcher=null;Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);}},250);
 const phase=(await IOUtils.readJSON(local('phase.json'))).phase,expected=await IOUtils.readJSON(local('package-under-test.json')),checks=[];
 const pass=async label=>{checks.push(label);await IOUtils.writeJSON(local('progress.json'),{phase,checks});};
 const api=await wait(()=>Zotero.ConceptExplorer,'plugin startup'),win=await wait(()=>Zotero.getMainWindow(),'main window'),tabs=win.Zotero_Tabs;
 assert(api.snapshot().archive,'Archive unavailable: '+api.snapshot().startupError);
 const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');const addon=await AddonManager.getAddonByID('concept-explorer@local.research');
 assert(Zotero.version===expected.expectedZoteroVersion && api.version===expected.expectedPluginVersion && addon?.isActive && !addon.appDisabled,'Version/activation mismatch');
 const xpi=await IOUtils.read(PathUtils.join(ROOT,'profile','extensions','concept-explorer@local.research.xpi'));
 const digest=await win.crypto.subtle.digest('SHA-256',xpi),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');assert(hash===expected.packageSHA256,'Package bytes differ');
 await pass('Exact packaged XPI SHA256, active addon and Zotero 10.0.6 confirmed');
 let tabFrame=await api.showPanel(win,'settings'),np=()=>tabFrame.contentWindow,nd=()=>tabFrame.contentDocument,bridge=()=>np().ConceptBridge;
 await wait(()=>bridge()?.settings,'native panel bridge');
 const floatFrame=()=>win.document.getElementById('concept-explorer-panel'),fd=()=>floatFrame()?.contentDocument;
 const calls=()=>IOUtils.readJSON(local('relay-calls.json')),mode=value=>IOUtils.writeJSON(local('relay-mode.json'),{mode:value}),job=id=>api.snapshot().jobs.find(j=>j.nodeId===id);
 const relay=await IOUtils.readJSON(local('relay.json')),save=protocol=>bridge().saveSettings({protocol,baseURL:relay.rootURL,model:'synthetic-model',key:'DUMMY-ROLLBACK-HOST'});
 const finished=async id=>{await wait(()=>job(id)?.status==='saved' || ['error','cancelled'].includes(job(id)?.status),'generation completion');assert(job(id)?.status==='saved','Generation failed: '+job(id)?.error);};
 const regenerate=async id=>{await bridge().retry(id);await finished(id);};
 const prompt=call=>JSON.parse((call.protocol==='responses'?call.body.input:call.body.messages).filter(m=>m.role==='user')[0].content);
 const complete=async()=>{await api.store.flush();await IOUtils.writeJSON(local(phase+'.complete.json'),{phase,...expected,pluginVersion:api.version,zoteroVersion:Zotero.version,passed:checks.length,checks,model:'localhost synthetic SSE only',installedUserProfileModified:false});};
 const legacy=await IOUtils.readJSON(local('legacy-expected.json'));
 if(phase==='restart'){
  assert(Zotero.Prefs.get('extensions.zotero.conceptExplorer.language',true)==='en-US','Restart lost language preference');
  assert(nd().documentElement.lang==='en-US' && nd().querySelector('#settings-title').textContent==='Use your own model and API','Restart failed to restore English interface');
  await pass('Real process restart restores the independently saved English language preference');
  await bridge().saveLanguage('zh-CN');
  const ids=await IOUtils.readJSON(local('fixture-ids.json')),persisted=await IOUtils.readJSON(local('restart-expected.json')),state=api.store.snapshot();
  for(const id of [ids.rootId,ids.childId,'legacy-child'])same(api.store.getSession(id),persisted.nodes.find(n=>n.id===id),'Persisted node lost: '+id);
  assert(state.nodes.some(n=>n.id===ids.childId && n.parentId===ids.rootId),'Child branch lost');
  await pass('Process restart retains complete explanations, tree, metadata, messages, draft and scroll');
  const deletion=await IOUtils.readJSON(local('deletion-expected.json'));
  assert(deletion.deletedNodeIds.every(id=>!state.nodes.some(n=>n.id===id) && !state.workspace.openNodeIds.includes(id)),'Restart restored deleted sessions/pages');
  same(api.store.getSession(deletion.sibling.id),deletion.sibling,'Restart lost unrelated branch');
  assert(state.documents.some(d=>d.id===deletion.documentId),'Restart deleted original paper record');
  same(state,persisted,'Restart changed post-deletion persisted workspace');
  await pass('Process restart keeps deleted nodes/pages absent, original paper present and independent branch unchanged');

  const untouched=api.store.getSession('legacy-child');same(untouched.generation,legacy.nodes[1].generation,'Legacy metadata changed');
  await bridge().mutate('openSession',[ids.rootId,'page']);await bridge().mutate('openSession',[ids.childId,'floating']);
  same(api.store.getSession('legacy-child').generation,legacy.nodes[1].generation,'Navigation discarded metadata');
  await pass('Restored plugin reads 0.2.4 metadata and preserves untouched branches after restart');
  const savedPosition=await IOUtils.readJSON(local('floating-position-expected.json'));
  assert(Zotero.Prefs.get('extensions.zotero.conceptExplorer.floatingWindowPosition',true)===savedPosition.value,'Restart lost floating position preference');
  assert(win.document.getElementById('concept-explorer-drag-handle'),'Restart failed to reconstruct drag handle');
  await pass('Process restart preserves floating position preference and reconstructs the native drag handle');
  await save('responses');const root=api.store.getSession(ids.rootId),before=(await calls()).length;
  const repeat=await api.store.createSession({documentId:root.documentId,concept:root.concept,source:root.source});await regenerate(repeat.id);
  assert((await calls()).length===before+1 && api.store.getSession(repeat.id).explanation.detail,'Restored baseline unexpectedly reused cached explanation or delayed detail');
  same(prompt((await calls()).at(-1)).nearbyText,root.source.context,'Restart request clipped context');
  await pass('Same article/concept after restart makes one fresh combined request with unchanged context');
  await nativeComposerRestartChecks({api,pass,assert,same});
  await nativeSelectionRestartChecks({api,pass,assert,same});
  await nativeAnnotationRestartChecks({api,addon,pass,wait,calls,assert,same});
  await complete();return;
 }
 for(const node of legacy.nodes)same(api.store.getSession(node.id),node,'Failed to read legacy archive unchanged');
 assert((await calls()).length===0,'Startup generated a model call');assert(!bridge().generatePart,'Lazy-detail bridge unexpectedly present');
 await pass('0.2.4 metadata archive opens with both branches intact and no startup network call');
 const item=new Zotero.Item('journalArticle');item.setField('title','Rollback verification — synthetic paper');item.libraryID=Zotero.Libraries.userLibraryID;await item.saveTx();
 const attachment=await Zotero.Attachments.importFromFile({file:local('fixture.pdf'),parentItemID:item.id});let reader=await Zotero.Reader.open(attachment.id);
 let readerDoc=await wait(()=>reader._iframeWindow?.document?.querySelector('.toolbar') && reader._iframeWindow.document,'actual PDF Reader');
 const buttons=[];Zotero.Reader._dispatchEvent({type:'renderTextSelectionPopup',reader,doc:readerDoc,params:{annotation:{text:'Posterior distribution',position:{pageIndex:0}}},append:button=>{buttons.push(button);readerDoc.body.append(button);}});
 assert(buttons.length===2 && buttons[0].textContent==='解释' && buttons[1].textContent==='全文解释','Selection entries missing/duplicated');assert(await wait(()=>readerDoc.querySelector('button[title="概念探索 · 我的知识树"]'),'reader toolbar'),'Reader toolbar missing');
 await pass('Actual PDF Reader offers Explain and Explain with full paper beside its knowledge-tree toolbar');
 const contextText='Synthetic paper setting: Bayesian parameter estimation. '+ 'Provided paper paragraph. '.repeat(22)+'Posterior distribution'+' updates parameters using the observed experiment. '+ 'Synthetic evidence and assumptions. '.repeat(24);
 function selectReaderContext(){
  let p=readerDoc.getElementById('rollback-synthetic-context');if(!p){p=readerDoc.createElement('p');p.id='rollback-synthetic-context';p.textContent=contextText;readerDoc.body.append(p);}
  const offset=p.firstChild.data.indexOf('Posterior distribution'),range=readerDoc.createRange();range.setStart(p.firstChild,offset);range.setEnd(p.firstChild,offset+22);
  const selection=readerDoc.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);
 }
 let root;
 for(const protocol of ['chat','responses','anthropic']){
  await save(protocol);tabs.select(reader.tabID);selectReaderContext();const before=(await calls()).length;
  root=await api.explainSelection(reader,{text:'Posterior distribution',pageLabel:'1',sortIndex:'00000|'+String(['chat','responses','anthropic'].indexOf(protocol)).padStart(6,'0')+'|00040',position:{pageIndex:0,rects:[[30,40+['chat','responses','anthropic'].indexOf(protocol)*20,180,55+['chat','responses','anthropic'].indexOf(protocol)*20]]}},readerDoc);assert(root,'Reader failed to create session');
  await wait(()=>job(root.id)?.status==='loading' && job(root.id)?.preview?.summary?.includes('测试简述') && fd()?.querySelector('.stream-preview')?.textContent?.includes('测试简述'),'stream preview '+protocol);
  assert(!api.store.getSession(root.id).explanation.summary && !api.store.getSession(root.id).explanation.detail,'Partial text saved prematurely');
  let recorded=await calls();assert(recorded.length===before+1 && !recorded.at(-1).completed && recorded.at(-1).combined,'Preview waited for completion or prompt is not original JSON pair');
  same(prompt(recorded.at(-1)),{paper:item.getField('title'),selectedConcept:root.concept,selectedText:root.source.selectedText,nearbyText:root.source.context,parentConcepts:[]},'Original prompt fields differ');
  same(root.source.context,contextText.trim(),'0.2.3 nearby paragraph extraction differs');
  fd().querySelector('[data-action=expand]').click();await wait(()=>nd().querySelector('#page-slot h1')?.textContent===root.concept,'native explanation tab');
  assert(floatFrame().style.display!=='none','Expansion dismissed float');
  await finished(root.id);recorded=await calls();const saved=api.store.getSession(root.id);
  assert(saved.explanation.summary && saved.explanation.detail && recorded.length===before+1,'Combined one-call generation not restored');
  await wait(()=>fd()?.querySelector('.answer .katex') && nd().querySelector('.answer .detail .katex'),'native math rendering');
  assert(recorded.at(-1).stream,'Stream disabled');if(protocol==='responses')assert(recorded.at(-1).path==='/responses','Native Responses inserted /v1');
  await pass(protocol+': original nearby-context prompt, live preview, one complete summary/detail call, native math, retained float');
  fd().querySelector('[data-action=expand]').click();await pause(100);assert((await calls()).length===before+1,'Expand sent a detail request');
 }
 const beforeLanguage=api.store.snapshot(),callsBeforeLanguage=(await calls()).length;
 await bridge().saveLanguage('en-US');
 assert(nd().documentElement.lang==='en-US' && fd().documentElement.lang==='en-US','Language failed to reach both native frames');
 assert(win.document.getElementById('concept-explorer-settings').getAttribute('label')==='Concept Explorer · Model settings','Native Tools menu not translated');
 assert(buttons[0].textContent==='Explain' && buttons[1].textContent==='Explain with full paper' && readerDoc.querySelector('button[title="Concept Explorer · My knowledge tree"]'),'Existing reader buttons not translated');
 assert(win.document.getElementById('concept-explorer-drag-handle').getAttribute('aria-label').startsWith('Move concept popover'),'Native drag handle not translated');
 assert(!nd().querySelector('.brand-mark,.empty-icon') && !fd().querySelector('.brand-mark,.empty-icon'),'Logo remains in a native surface');
 await bridge().saveLanguage('zh-TW');assert(fd().querySelector('.app-header [data-action=settings]').textContent==='設定','Traditional Chinese missing');
 await bridge().saveLanguage('zh-CN');
 same(api.store.snapshot(),beforeLanguage,'Language switching changed archive data');assert((await calls()).length===callsBeforeLanguage,'Language switching called a model');
 await pass('Native live language changes update two frames, Tools menus, retained reader buttons and drag accessibility without model calls or archive changes; logos removed');
 // Real Gecko/XUL host, original panel iframe, synthetic pointer input only.
 const movingFrame=floatFrame(),nativeHandle=win.document.getElementById('concept-explorer-drag-handle');
 assert(nativeHandle && nativeHandle.style.display!=='none','Native floating title-bar handle missing');
 const nativeBefore=api.store.snapshot(),modelCallsBeforeDrag=(await calls()).length,initialRect=movingFrame.getBoundingClientRect();
 const hostWidth=win.document.documentElement.clientWidth || win.innerWidth,hostHeight=win.document.documentElement.clientHeight || win.innerHeight;
 const barBottom=win.document.getElementById('tab-bar-container').getBoundingClientRect().bottom;
 const edges={left:12,top:barBottom+12,right:hostWidth-12-initialRect.width,bottom:hostHeight-12-initialRect.height};
 const mid={left:(edges.left+edges.right)/2,top:(edges.top+edges.bottom)/2};
 const near=(a,b,label)=>assert(Math.abs(a-b)<1,label+': '+a+' != '+b);
 function nativeDrag(left,top){
  const origin=movingFrame.getBoundingClientRect(),handleRect=nativeHandle.getBoundingClientRect();
  const x=handleRect.left+Math.min(30,handleRect.width/2),y=handleRect.top+18;
  const event=(type,px,py)=>nativeHandle.dispatchEvent(new win.PointerEvent(type,{bubbles:true,cancelable:true,pointerId:42,pointerType:'mouse',isPrimary:true,button:type==='pointermove'?-1:0,buttons:type==='pointerup'?0:1,clientX:px,clientY:py,screenX:win.screenX+px,screenY:win.screenY+py}));
  event('pointerdown',x,y);
  for(let i=1;i<=12;i++)event('pointermove',x+(left-origin.left)*i/12,y+(top-origin.top)*i/12);
  event('pointerup',x+left-origin.left,y+top-origin.top);
 }
 const nearX=Math.min(8,(edges.right-edges.left)/4),nearY=Math.min(8,(edges.bottom-edges.top)/4);
 nativeDrag(edges.left+nearX,mid.top);near(movingFrame.getBoundingClientRect().left,edges.left,'Native left docking');
 nativeDrag(edges.right-nearX,mid.top);near(movingFrame.getBoundingClientRect().left,edges.right,'Native right docking');
 nativeDrag(mid.left,edges.top+nearY);near(movingFrame.getBoundingClientRect().top,edges.top,'Native top docking');
 nativeDrag(mid.left,edges.bottom-nearY);near(movingFrame.getBoundingClientRect().top,edges.bottom,'Native bottom docking');
 const afterDrag=movingFrame.getBoundingClientRect();near(afterDrag.width,initialRect.width,'Drag changed width');near(afterDrag.height,initialRect.height,'Drag changed height');
 assert(afterDrag.top>=barBottom,'Native tabs are covered');
 same(api.store.snapshot(),nativeBefore,'Dragging changed knowledge archive');assert((await calls()).length===modelCallsBeforeDrag,'Dragging called model');
 const positionPref=Zotero.Prefs.get('extensions.zotero.conceptExplorer.floatingWindowPosition',true);
 assert(JSON.parse(positionPref).version===1,'Native position preference not saved');
 await IOUtils.writeJSON(local('floating-position-expected.json'),{value:positionPref});
 await pass('Gecko pointer dragging docks all four edges, reserves native tab bar, preserves size/archive and makes zero model calls');
 const beforeRepeat=(await calls()).length,repeat=await api.store.createSession({documentId:root.documentId,concept:root.concept,source:root.source});await regenerate(repeat.id);
 assert((await calls()).length===beforeRepeat+1 && api.store.getSession(repeat.id).explanation.detail,'Completed result incorrectly cached or lazy');
 await pass('Repeated first-level lookup uses a fresh 0.2.3 request, not 0.2.4 fingerprints');
 const childContext='Synthetic full supplied context. '.repeat(250)+'END-CONTEXT-SENTINEL';const parent=api.store.getSession(root.id),beforeChild=(await calls()).length;
 const child=await bridge().child(root.id,'Synthetic sub-concept',childContext);await finished(child.id);
 const childPrompt=prompt((await calls()).at(-1));same(childPrompt.nearbyText,childContext,'Provided child context was clipped');same(childPrompt.parentConcepts,[{concept:parent.concept,summary:parent.explanation.summary}],'Ancestor summary missing/changed');
 assert((await calls()).length===beforeChild+1 && api.store.snapshot().workspace.pageNodeId===root.id && api.store.snapshot().workspace.floatingNodeId===child.id,'Child routing differs');
 await bridge().mutate('openSession',[root.id,'page']);assert(api.store.getSession(child.id).explanation.detail,'Parent navigation lost child');
 await pass('Sub-concept sends full supplied context and ancestor summary; parent navigation retains child page');
 const savedBeforeFailure=api.store.getSession(repeat.id);await mode('truncate');await bridge().retry(repeat.id);await wait(()=>job(repeat.id)?.status==='error','truncated stream rejected');same(api.store.getSession(repeat.id),savedBeforeFailure,'Truncation overwrote complete answer');await mode('normal');
 await pass('Incomplete refresh never overwrites complete explanation');
 same(api.store.getSession('legacy-child').generation,legacy.nodes[1].generation,'Unrelated request stripped archived metadata');
 await save('responses');const beforeRefresh=(await calls()).length;await regenerate('legacy-parent');
 assert((await calls()).length===beforeRefresh+1 && !api.store.getSession('legacy-parent').generation && api.store.getSession('legacy-parent').explanation.detail,'Legacy regeneration failed or left obsolete fingerprints');
 same(api.store.getSession('legacy-child').generation,legacy.nodes[1].generation,'Legacy child fingerprint removed');
 await pass('Regeneration invalidates only replaced node fingerprints and preserves untouched descendant');
 await api.store.saveSessionView(root.id,{draft:'Synthetic persistent draft',scrollTop:456});
 await api.store.openSession(root.id,'page');await api.store.flush();
 await IOUtils.writeJSON(local('fixture-ids.json'),{rootId:root.id,childId:child.id});await IOUtils.writeJSON(local('restart-expected.json'),api.store.snapshot());
 const disk=await IOUtils.readJSON(api.storage.paths.file);same(disk,api.store.snapshot(),'Native on-disk archive differs');assert(await IOUtils.exists(api.storage.paths.backup),'Atomic backup missing');
 await pass('Native atomic archive and backup preserve explanations, metadata, tree and independent views');
 const beforeClose=(await calls()).length;
 await tabs.close(reader.tabID);reader=await Zotero.Reader.open(attachment.id);readerDoc=await wait(()=>reader._iframeWindow?.document?.querySelector('.toolbar') && reader._iframeWindow.document,'reopened Reader');
 const reopenedButtons=[];Zotero.Reader._dispatchEvent({type:'renderTextSelectionPopup',reader,doc:readerDoc,params:{annotation:{text:'Synthetic concept',position:{pageIndex:0}}},append:b=>reopenedButtons.push(b)});assert(reopenedButtons.length===2 && reopenedButtons[0].textContent==='解释' && reopenedButtons[1].textContent==='全文解释' && (await calls()).length===beforeClose,'Reader reopen lost/duplicated entry or sent HTTP');
 await pass('Closing and reopening the PDF retains both selection entries without extra requests');

 // New checks use only synthetic sessions in this disposable profile.
 const deletionIds=[],originalConfirm=Zotero.Prompt.confirm,originalWrite=api.storage.write;
 let choice=2,prompts=[];
 Zotero.Prompt.confirm=options=>{prompts.push(options);return choice;};
 try {
  const add=async(concept,parentId=null)=>api.store.createSession({documentId:root.documentId,parentId,concept,open:false,explanation:{summary:'Synthetic deletion summary',detail:'## Synthetic retained detail\n\nChild explanation and $x^2$ remain.'}});
  const branch=await add('Synthetic removable parent',root.id),kept=await add('Synthetic promoted child',branch.id),grand=await add('Synthetic branch grandchild',kept.id),sibling=await add('Synthetic untouched sibling',root.id);
  await api.store.saveSessionView(kept.id,{draft:'Synthetic child draft',scrollTop:123});
  await api.store.appendMessage(kept.id,{role:'assistant',content:'Synthetic independent child answer'});
  await bridge().mutate('openSession',[grand.id,'floating']);await bridge().mutate('openSession',[branch.id,'page']);
  await wait(()=>nd().querySelector('#page-slot h1')?.textContent===branch.concept && fd()?.querySelector('#floating-slot h1')?.textContent===grand.concept,'deletion test surfaces');
  await pause(500);await np().ConceptPanel.flushViews();await floatFrame().contentWindow.ConceptPanel.flushViews();await api.store.flush();
  assert(nd().querySelector('#tree .tree-delete[data-id="'+branch.id+'"]') && nd().querySelector('#page-slot [data-action="delete-node"]') && fd().querySelector('[data-action="delete-node"]'),'Deletion UI entry missing');
  let bypass=false;try{await bridge().mutate('deleteSession',[branch.id]);}catch(e){bypass=String(e).includes('Unsupported operation');}assert(bypass,'Deletion bypassed confirmation');
  const beforeCancel=api.store.snapshot();assert(await bridge().deleteSession(branch.id)===null,'Cancel returned deletion');same(api.store.snapshot(),beforeCancel,'Cancel changed archive');
  assert(prompts.at(-1).defaultButton===2 && prompts.at(-1).button2===Zotero.Prompt.BUTTON_TITLE_CANCEL && prompts.at(-1).text.includes('共删除 3 个节点'),'Branch prompt scope/default mismatch');
  await pass('Native tree/page/float deletion entries, explicit scope and default Cancel; generic mutation cannot bypass confirmation');

  choice=1;const beforeFail=api.store.snapshot(),diskBeforeFail=await IOUtils.readJSON(api.storage.paths.file);
  api.storage.write=async()=>{throw Error('Synthetic deletion write failure');};
  let failure=false;try{await bridge().deleteSession(branch.id);}catch(e){failure=String(e).includes('Synthetic deletion write failure');}finally{api.storage.write=originalWrite;}
  assert(failure,'Write failure was swallowed');same(api.store.snapshot(),beforeFail,'Failed deletion changed memory');same(await IOUtils.readJSON(api.storage.paths.file),diskBeforeFail,'Failed deletion changed disk');
  assert(floatFrame().style.display!=='none' && fd().querySelector('#floating-slot h1').textContent===grand.concept,'Failed deletion dismissed float');
  await pass('Native deletion write failure leaves disk, tree, pages and float intact');

  choice=0;const keptBefore=api.store.getSession(kept.id),siblingBefore=api.store.getSession(sibling.id);
  const only=await bridge().deleteSession(branch.id);deletionIds.push(branch.id);
  same(only.deletedNodeIds,[branch.id],'Node-only removed descendants');assert(only.reparentedNodeIds.includes(kept.id),'Child not promoted');
  const promoted=api.store.getSession(kept.id);assert(promoted.parentId===root.id,'Child promoted to wrong parent');
  same({...promoted,parentId:keptBefore.parentId,updatedAt:keptBefore.updatedAt},keptBefore,'Promotion changed child content/messages/draft/metadata');
  assert(api.store.getSession(grand.id).parentId===kept.id && floatFrame().style.display!=='none','Node-only deletion lost grandchild/float');
  await wait(()=>!nd().querySelector('[data-node-id="'+branch.id+'"]') && !nd().querySelector('#retained [data-id="'+branch.id+'"]'),'removed parent caches');
  await pass('Native node-only deletion promotes children while retaining descendants, answers, messages, drafts and float');

  await bridge().mutate('openSession',[kept.id,'page']);await bridge().mutate('openSession',[grand.id,'floating']);
  const textarea=fd().querySelector('textarea'),floatWindow=floatFrame().contentWindow;textarea.value='Synthetic pending cross-frame draft';textarea.dispatchEvent(new floatWindow.Event('input',{bubbles:true}));
  choice=1;nd().querySelector('#page-slot [data-action="delete-node"]').click();
  await wait(()=>!api.store.snapshot().nodes.some(n=>n.id===kept.id),'native subtree deletion');deletionIds.push(kept.id,grand.id);
  await wait(()=>!fd().querySelector('#floating-slot article') && floatFrame().style.display==='none','deleted float hidden');
  await pause(450);await np().ConceptPanel.flushViews();await floatFrame().contentWindow.ConceptPanel.flushViews();
  const revision=api.store.snapshot().revision;const stale=await bridge().mutate('saveSessionView',[grand.id,{draft:'Synthetic late discarded save'}]);
  assert(stale===null && api.store.snapshot().revision===revision,'Stale frame wrote or resurrected deleted session');
  same(api.store.getSession(sibling.id),siblingBefore,'Sibling changed by subtree deletion');assert(api.store.snapshot().workspace.pageNodeId===root.id,'Deleted page did not fall back to parent');
  assert(nd().querySelector('#retained [data-id="'+root.id+'"]') && !nd().querySelector('[data-node-id="'+kept.id+'"]'),'Retained tab cleanup failed');
  same(api.store.getSession('legacy-child').generation,legacy.nodes[1].generation,'Deletion stripped independent metadata');
  await pass('Native page deletion synchronizes retained pages/float; pending or stale cross-frame saves cannot resurrect nodes');

  await mode('slow');const loading=await add('Synthetic delete during stream',root.id);await bridge().retry(loading.id);
  await wait(()=>job(loading.id)?.status==='loading' && job(loading.id)?.preview?.summary?.includes('测试简述'),'loading deletion preview');
  const beforeStreamCancel=api.store.snapshot();choice=1;assert(await bridge().deleteSession(loading.id)===null,'Leaf cancel was not null');same(api.store.snapshot(),beforeStreamCancel,'Leaf cancel changed archive');
  assert(job(loading.id)?.status==='loading' && prompts.at(-1).defaultButton===1,'Leaf cancel stopped job/default mismatch');
  await pass('Native leaf confirmation defaults to Cancel; cancelling deletion keeps the active stream');
  choice=0;await bridge().deleteSession(loading.id);deletionIds.push(loading.id);
  await wait(async()=>!job(loading.id) && (await calls()).at(-1).closed,'deleted stream aborted');await mode('normal');await pause(500);await api.store.flush();
  assert(!api.store.snapshot().nodes.some(n=>n.id===loading.id) && !api.snapshot().jobs.some(j=>j.nodeId===loading.id),'Streaming completion resurrected deleted node/job');
  same(api.store.getSession(sibling.id),siblingBefore,'Streaming deletion affected another branch');
  await pass('Successful native deletion aborts its streaming request without ghost jobs, resurrection or sibling damage');

  await api.store.openSession(root.id,'page');await api.store.openSession(child.id,'floating');await np().ConceptPanel.update(api.snapshot());
  await pause(450);await np().ConceptPanel.flushViews();await floatFrame().contentWindow.ConceptPanel.flushViews();await api.store.flush();
  await IOUtils.writeJSON(local('deletion-expected.json'),{deletedNodeIds:deletionIds,sibling:api.store.getSession(sibling.id),documentId:root.documentId});
  await nativeSelectionEntryChecks({api,win,tabs,reader,readerDoc,attachment,item,bridge,nd,fd,floatFrame,calls,mode,job,finished,prompt,pass,wait,pause,assert,same,root,child,save});
 await IOUtils.writeJSON(local('restart-expected.json'),api.store.snapshot());same(await IOUtils.readJSON(api.storage.paths.file),api.store.snapshot(),'Post-deletion disk mismatch');
  await pass('Native deletion results and untouched branch persist in the atomic archive for process restart');
 } finally {Zotero.Prompt.confirm=originalConfirm;api.storage.write=originalWrite;await mode('normal');}

 await nativeFormulaAnnotationChecks({api,win,tabs,reader,readerDoc,attachment,item,bridge,nd,fd,floatFrame,calls,mode,job,finished,pass,wait,pause,assert,same,root,child});
 await nativeComposerFullTextChecks({api,bridge,nd,fd,floatFrame,calls,mode,job,finished,pass,wait,pause,assert,same,root,child,attachment,save});
 await IOUtils.writeJSON(local('restart-expected.json'),api.store.snapshot());
 await bridge().saveLanguage('en-US');
 await pass('English language preference saved for independent process restart');
 await complete();
}
