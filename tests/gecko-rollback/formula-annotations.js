// Runs only inside the disposable real Zotero profile created by prepare.mjs.
async function nativeFormulaAnnotationChecks({api,win,tabs,reader,readerDoc,attachment,item,bridge,nd,fd,floatFrame,calls,mode,job,finished,pass,wait,pause,assert,same,root,child}) {
 const selection={text:formulaText,pageLabel:'1',position:{pageIndex:0,rects:[[30,150,280,175]]}};
 const before=(await calls()).length,node=await api.explainSelection(reader,selection,readerDoc);
 assert(node,'Formula selection failed');await finished(node.id);
 const key=node.source.location.annotationKey,highlight=Zotero.Items.getByLibraryAndKey(attachment.libraryID,key);
 assert(highlight?.isAnnotation() && highlight.annotationType==='highlight' && highlight.parentItemID===attachment.id,'Native highlight was not saved');
 assert(highlight.annotationText===formulaText && /^00000\|\d{6}\|\d{5}$/.test(highlight.annotationSortIndex),'Text or fallback sort index differs');
 assert((await calls()).length===before+1,'Formula selection generated duplicate requests');
 fd().querySelector('[data-action=expand]').click();
 await wait(()=>nd().querySelector('#page-slot article')?.dataset.nodeId===node.id,'formula page');
 const inspect=async(selector)=>{
  const el=await wait(()=>nd().querySelector(selector+' .katex-display .katex-html'),'native formula '+selector);
  await nd().fonts.ready;const container=nd().querySelector(selector),rect=el.getBoundingClientRect();
  assert(el.querySelector('.mfrac') && el.querySelector('.op-symbol') && el.querySelector('.msupsub') && container.querySelector('math mfrac') && rect.width>100 && rect.height>30 && !container.querySelector('.katex-error,.math-error,.math-token'),'Incomplete native math layout: '+selector+' '+rect.width+'x'+rect.height);
 };
 await inspect('#page-slot .source-content');await inspect('#page-slot .detail');
 const input=nd().querySelector('#page-slot textarea');input.value='请解释这个公式：\n\n'+formulaText;input.dispatchEvent(new (nd().defaultView.Event)('input',{bubbles:true}));
 await inspect('#page-slot .composer-preview');
 nd().querySelector('#page-slot .composer').dispatchEvent(new (nd().defaultView.Event)('submit',{bubbles:true,cancelable:true}));
 await wait(()=>job(node.id)?.kind==='ask' && job(node.id)?.status==='loading','native formula follow-up started');await finished(node.id);
 await inspect('#page-slot .message.user');await inspect('#page-slot .message.assistant');
 assert(api.store.getSession(node.id).messages[0].content.includes(formulaText) && nd().querySelector('#page-slot textarea').value==='','Native formula input changed or was not cleared');
 await pass('Gecko lays out InfoNCE fractions, sums, scripts and MathML in source, explanation, draft preview and both conversation roles');
 highlight.annotationComment='Synthetic user comment must survive reuse';await highlight.saveTx();
 const count=(await attachment.getAnnotations()).length,unchanged=api.store.getSession(node.id),beforeReuse=(await calls()).length;
 const reused=await api.explainSelection(reader,selection,readerDoc);
 assert(reused.id===node.id && (await attachment.getAnnotations()).length===count && (await calls()).length===beforeReuse,'Repeat selection duplicated highlight, conversation or request');
 same(api.store.getSession(node.id).messages,unchanged.messages,'Repeat selection lost conversation');assert(highlight.annotationComment==='Synthetic user comment must survive reuse','Reuse replaced user comment');
 await bridge().mutate('openSession',[root.id,'floating']);tabs.select(reader.tabID);
 readerDoc.defaultView.getSelection()?.removeAllRanges();reader._internalReader.toggleSidebar(true);reader._internalReader.setSidebarView('annotations');
 const card=await wait(()=>readerDoc.querySelector('[data-sidebar-annotation-id="'+key+'"]'),'native sidebar annotation');
 card.dispatchEvent(new readerDoc.defaultView.MouseEvent('mousedown',{bubbles:true,button:0}));card.dispatchEvent(new readerDoc.defaultView.MouseEvent('click',{bubbles:true,button:0}));
 await wait(()=>api.store.snapshot().workspace.floatingNodeId===node.id && fd()?.querySelector('article')?.dataset.nodeId===node.id,'native highlight click restores conversation');
 same(api.store.getSession(node.id).messages,unchanged.messages,'Click lost saved messages');assert((await calls()).length===beforeReuse,'Highlight click called model');
 await pass('Native saved highlight, valid fallback position, repeat reuse and actual sidebar-card click restore the conversation without extra model calls or comment changes');
 const removable=await api.explainSelection(reader,{text:'Synthetic highlight to remove',position:{pageIndex:0,rects:[[30,190,280,210]]}},readerDoc);assert(removable,'Removable highlight failed');await finished(removable.id);
 const descendant=await api.store.createSession({documentId:node.documentId,parentId:removable.id,concept:'Synthetic active descendant',source:removable.source});
 await mode('slow');await bridge().retry(descendant.id);await wait(()=>job(descendant.id)?.status==='loading' && job(descendant.id)?.preview?.summary,'annotation deletion active stream');
 await bridge().mutate('openSession',[removable.id,'page']);await bridge().mutate('openSession',[descendant.id,'floating']);
 const removedKey=removable.source.location.annotationKey;await Zotero.Items.getByLibraryAndKey(attachment.libraryID,removedKey).eraseTx();
 await wait(()=>[removable.id,descendant.id].every(id=>!api.store.snapshot().nodes.some(n=>n.id===id) && !job(id)),'native highlight deletion cleans branch and jobs');
 await wait(async()=> (await calls()).at(-1).closed,'native annotation deletion aborts SSE');await mode('normal');await pause(400);
 assert(!nd().querySelector('[data-node-id="'+removable.id+'"]') && !fd().querySelector('[data-node-id="'+descendant.id+'"]'),'Deleted annotation left stale UI');
 assert(api.store.getSession(node.id).messages.length===2 && api.store.getSession(root.id).id===root.id,'Highlight deletion touched independent sessions');
 await pass('Erasing a real Zotero highlight removes its entire branch, clears retained UI and aborts descendant SSE without resurrecting jobs');
 const offline=await api.explainSelection(reader,{text:'Synthetic annotation deleted while disabled',position:{pageIndex:0,rects:[[30,230,280,250]]}},readerDoc);assert(offline,'Offline fixture failed');await finished(offline.id);
 const offlineChild=await api.store.createSession({documentId:node.documentId,parentId:offline.id,concept:'Offline child',source:offline.source,open:false});
 await IOUtils.writeJSON(local('annotation-fixture.json'),{nodeId:node.id,key,attachmentId:attachment.id,messages:api.store.getSession(node.id).messages,offlineId:offline.id,offlineChildId:offlineChild.id,offlineKey:offline.source.location.annotationKey,removedIds:[removable.id,descendant.id]});
 await bridge().mutate('openSession',[root.id,'page']);await bridge().mutate('openSession',[child.id,'floating']);
 await pause(450);await nd().defaultView.ConceptPanel.flushViews();await floatFrame().contentWindow.ConceptPanel.flushViews();await api.store.flush();
}
async function nativeAnnotationRestartChecks({api,addon,pass,wait,calls,assert,same}) {
 const saved=await IOUtils.readJSON(local('annotation-fixture.json')),before=(await calls()).length;
 same(api.store.getSession(saved.nodeId).messages,saved.messages,'Process restart lost linked conversation');
 assert(api.store.getSession(saved.nodeId).source.location.annotationKey===saved.key && saved.removedIds.every(id=>!api.store.snapshot().nodes.some(n=>n.id===id)),'Process restart lost highlight link or revived deleted branch');
 const attachment=Zotero.Items.get(saved.attachmentId);assert(Zotero.Items.getByLibraryAndKey(attachment.libraryID,saved.key)?.annotationComment==='Synthetic user comment must survive reuse','Restart lost native highlight/comment');
 await pass('Process restart retains native highlight links, exact saved formula conversation and user comment, while deleted branches stay absent');
 await addon.disable();await wait(()=>!Zotero.ConceptExplorer,'plugin disabled');
 await Zotero.Items.getByLibraryAndKey(attachment.libraryID,saved.offlineKey).eraseTx();
 assert(api.store.snapshot().nodes.some(n=>n.id===saved.offlineId),'Disabled runtime unexpectedly changed archive');
 await addon.enable();const restarted=await wait(()=>Zotero.ConceptExplorer && Zotero.ConceptExplorer!==api && Zotero.ConceptExplorer,'plugin enabled');
 assert([saved.offlineId,saved.offlineChildId].every(id=>!restarted.store.snapshot().nodes.some(n=>n.id===id)),'Startup kept branch whose annotation was deleted while disabled');
 same(restarted.store.getSession(saved.nodeId).messages,saved.messages,'Reconciliation changed unrelated conversation');
 assert((await calls()).length===before,'Restart/reconciliation made a model request');await restarted.store.flush();
 await pass('Real disable/delete/enable cycle reconciles highlights deleted while the plugin was inactive and preserves unrelated conversations without model calls');
}
