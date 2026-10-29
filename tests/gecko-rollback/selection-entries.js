// Runs only in the disposable native profile; uses synthetic passages and local SSE.
async function nativeSelectionEntryChecks({api,win,tabs,reader,readerDoc,attachment,item,bridge,nd,fd,floatFrame,calls,mode,job,finished,prompt,pass,wait,pause,assert,same,root,child,save}) {
 await bridge().saveLanguage('zh-CN');await save('chat');await mode('normal');tabs.select(reader.tabID);
 const selected='完整选段：'+('This entire paragraph explains temporal contrast and $z_i^b$. '.repeat(80))+'末尾证据 END-OF-PARAGRAPH';
 const annotation={text:selected,pageLabel:'1',position:{pageIndex:0,rects:[[30,240,280,260],[30,220,280,238]]}};
 const entries=[];
 Zotero.Reader._dispatchEvent({type:'renderTextSelectionPopup',reader,doc:readerDoc,params:{annotation},append:button=>{entries.push(button);readerDoc.body.append(button);}});
 assert(entries.length===2 && entries[0].textContent==='解释' && entries[1].textContent==='全文解释','Native selection pair differs');
 assert(entries[1].title.includes('全文') && entries[1].dataset.conceptExplorerContext==='full-paper','Native full-paper action has no context hint');
 await pass('Native PDF selection popup exposes Explain and Explain with full paper with localized context hints');
 const before=(await calls()).length;entries[1].click();entries[1].click();
 const node=await wait(()=>api.store.snapshot().nodes.find(n=>n.source.selectedText===selected),'native full paragraph session');
 await finished(node.id);const recorded=await calls(),paper=await Zotero.PDFWorker.getFullText(attachment.id,null),request=prompt(recorded.at(-1));
 assert(recorded.length===before+1,'Direct full-paper selection sent a preliminary or duplicate request');
 assert(request.selectedText===selected && request.selectedConcept===selected && request.selectedText.endsWith('END-OF-PARAGRAPH'),'Native long paragraph was clipped');
 same(request.fullPaper,{text:paper.text,totalPages:paper.totalPages},'Native entry did not use the complete bound PDF');
 const saved=api.store.getSession(node.id),key=saved.source.location.annotationKey;
 assert(saved.source.selectedText===selected && saved.explanation.summary.startsWith('全文修订'),'Native full-paper entry not saved');
 assert(Zotero.Items.getByLibraryAndKey(attachment.libraryID,key).annotationText===selected,'Native paragraph highlight was clipped');
 await pass('Full-paper selection entry sends one request with the complete paragraph and actual PDFWorker text, retaining one native highlight');
 const beforeOpen=(await calls()).length;entries[0].click();await pause(700);assert((await calls()).length===beforeOpen,'Opening paragraph through Explain generated again');
 assert(api.store.sessionsForAnnotation({libraryId:attachment.libraryID,attachmentKey:attachment.key,annotationKey:key}).length===1,'Entry pair duplicated the conversation');
 await pass('Both PDF entry points share the saved highlight and conversation; Explain reopens an existing answer without another model call');
 const localText='普通整段：'+('A long nearby-context explanation paragraph. '.repeat(75))+'LOCAL-END';
 const localAnnotation={text:localText,pageLabel:'1',position:{pageIndex:0,rects:[[30,280,280,300]]}},localEntries=[];
 Zotero.Reader._dispatchEvent({type:'renderTextSelectionPopup',reader,doc:readerDoc,params:{annotation:localAnnotation},append:button=>{localEntries.push(button);readerDoc.body.append(button);}});
 const beforeLocal=(await calls()).length;localEntries[0].click();
 const localNode=await wait(()=>api.store.snapshot().nodes.find(n=>n.source.selectedText===localText),'native local paragraph');await finished(localNode.id);
 const localPrompt=prompt((await calls()).at(-1));assert((await calls()).length===beforeLocal+1 && localPrompt.selectedText===localText && !localPrompt.fullPaper,'Explain read or sent the full paper');
 await pass('Explain accepts a whole paragraph larger than the old PDF cap and sends nearby context without full-paper text');
 await mode('slow');const beforeSwitch=(await calls()).length,switchText='Switching active context. '.repeat(60).trim();
 const switchAnnotation={text:switchText,pageLabel:'1',position:{pageIndex:0,rects:[[30,320,280,340]]}};
 const switchNode=await api.explainSelection(reader,switchAnnotation,readerDoc);
 await wait(async()=>job(switchNode.id)?.status==='loading' && (await calls()).length===beforeSwitch+1,'local request before switching');
 await mode('normal');await api.explainSelection(reader,switchAnnotation,readerDoc,{fullText:true});await finished(switchNode.id);
 await wait(async()=>(await calls())[beforeSwitch].closed,'superseded stream abort');
 const switched=await calls();assert(switched.length===beforeSwitch+2 && !prompt(switched[beforeSwitch]).fullPaper && prompt(switched[beforeSwitch+1]).fullPaper,'Context switch made unexpected requests');
 assert(api.store.getSession(switchNode.id).explanation.summary.startsWith('全文修订'),'Late local answer replaced full-paper answer');
 await pass('Selecting full-paper context cancels an active local request and prevents its late result from replacing the new answer');
 // Select a large generated paragraph in the real Gecko panel and click both actions.
 const generated='AI whole paragraph '+('explain each step with $z_i$. '.repeat(90))+'AI-PARAGRAPH-END';
 await api.store.setExplanation(node.id,{detail:generated});await bridge().mutate('openSession',[node.id,'page']);
 await wait(()=>nd().querySelector('#page-slot article')?.dataset.nodeId===node.id,'paragraph native page');
 const selectParagraph=async()=>{
  const el=nd().querySelector('#page-slot .detail p'),range=nd().createRange();range.selectNodeContents(el);
  const selection=nd().defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);nd().dispatchEvent(new (nd().defaultView.Event)('selectionchange'));
  await wait(()=>!nd().getElementById('explanation-selection-menu').hidden,'native AI selection pair');return selection.toString().trim();
 };
 const childText=await selectParagraph(),beforeChild=(await calls()).length;
 assert(childText.length>1200 && nd().getElementById('explanation-selection').textContent==='解释' && nd().getElementById('explanation-selection-full-text').textContent==='全文解释','Native AI pair missing');
 nd().getElementById('explanation-selection-full-text').click();
 const selectedChild=await wait(()=>api.store.snapshot().nodes.find(n=>n.parentId===node.id && n.concept===childText),'native paragraph child');await finished(selectedChild.id);
 const childPrompt=prompt((await calls()).at(-1));assert((await calls()).length===beforeChild+1 && childPrompt.selectedText===childText && childPrompt.fullPaper?.text===paper.text,'Native full-paper child clipped the paragraph or sent local request');
 assert(selectedChild.source.location.annotationKey===key,'Child lost annotation link');
 await pass('Generated whole-paragraph selection offers both native buttons and full-paper explanation creates one linked child with no clipped text');
 await bridge().mutate('openSession',[node.id,'page']);await selectParagraph();const beforeLocalChild=(await calls()).length;
 nd().getElementById('explanation-selection').click();await pause(700);
 assert((await calls()).length===beforeLocalChild && api.store.snapshot().nodes.filter(n=>n.parentId===node.id && n.concept===childText).length===1,'Local AI action duplicated saved child');
 const overLimitBefore=api.store.snapshot().nodes.length;
 let rejected=false;try{await bridge().child(node.id,'x'.repeat(20001));}catch(error){rejected=String(error).includes('20000');}
 assert(rejected && api.store.snapshot().nodes.length===overLimitBefore,'Oversized child was clipped or saved');
 await pass('Paragraph child entry reuses its saved conversation; selections above 20,000 characters are explicitly refused without clipping or extra nodes');
 await bridge().saveLanguage('en-US');assert(entries[0].textContent==='Explain' && entries[1].textContent==='Explain with full paper','Native PDF entry pair did not translate');
 assert(nd().getElementById('explanation-selection-full-text').textContent==='Explain with full paper','Native AI entry pair did not translate');
 await pass('Both new PDF and generated-text entry points switch live between Simplified Chinese and English');
 await bridge().saveLanguage('zh-CN');await mode('normal');
 await bridge().mutate('openSession',[root.id,'page']);await bridge().mutate('openSession',[child.id,'floating']);
 for(const button of [...entries,...localEntries])button.remove();
 await pause(450);await nd().defaultView.ConceptPanel.flushViews();await floatFrame().contentWindow.ConceptPanel.flushViews();await api.store.flush();
 await IOUtils.writeJSON(local('selection-fixture.json'),{node:api.store.getSession(node.id),child:api.store.getSession(selectedChild.id),local:api.store.getSession(localNode.id)});
}
async function nativeSelectionRestartChecks({api,pass,assert,same}) {
 const expected=await IOUtils.readJSON(local('selection-fixture.json'));
 for(const node of Object.values(expected))same(api.store.getSession(node.id),node,'Paragraph/full-paper entry session changed after restart');
 assert(expected.node.source.selectedText.length>1200 && expected.child.source.selectedText.length>600,'Paragraph fixture missing long text');
 await pass('Full process restart restores complete paragraph selections, linked full-paper explanations and their child sessions');
}
