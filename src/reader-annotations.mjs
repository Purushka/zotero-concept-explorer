// PDF documents and split views use nested frames. Keep each listener tied to
// its live document so closing/navigating a Reader releases the old documents.
export function watchReaderAnnotations(reader,rootDocument,{onOpen,onError=()=>{},onDispose=()=>{}}) {
  const documents=new Map(),frames=new Map();let disposed=false;
  const ignored='button,a,input,textarea,select,[contenteditable="true"],[role="menu"],[role="menuitem"],.annotation-popup,.context-menu';
  function detachFrame(frame) {
    const record=frames.get(frame);if(!record)return;
    frames.delete(frame);
    try{frame.removeEventListener('load',record.load);}catch{}
    if(record.doc)detachDocument(record.doc);
  }
  function detachDocument(doc) {
    const cleanup=documents.get(doc);if(!cleanup)return;
    documents.delete(doc);
    for(const frame of [...frames.keys()])if(frame.ownerDocument===doc)detachFrame(frame);
    try{cleanup();}catch{}
  }
  function dispose() {
    if(disposed)return;disposed=true;
    for(const doc of [...documents.keys()])detachDocument(doc);
    for(const frame of [...frames.keys()])detachFrame(frame);
    onDispose();
  }
  function attachFrame(frame) {
    if(disposed || frames.has(frame))return;
    const record={doc:null,load:()=>{
      try{
        const next=frame.contentDocument;
        if(record.doc && record.doc!==next)detachDocument(record.doc);
        record.doc=next;if(next)attach(next);
      }catch{}
    }};
    frame.addEventListener('load',record.load);frames.set(frame,record);record.load();
  }
  function attach(doc) {
    if(disposed || documents.has(doc))return;
    const view=doc.defaultView;let down=null,timer=null;
    const start=event=>{down={x:event.clientX,y:event.clientY,moved:false};};
    const move=event=>{if(down && Math.hypot(event.clientX-down.x,event.clientY-down.y)>5)down.moved=true;};
    const click=event=>{
      const target=event.target?.nodeType===1 ? event.target : event.target?.parentElement;
      if(event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || down?.moved || !target || target.closest(ignored))return;
      const direct=target.closest('[data-annotation-id],[data-sidebar-annotation-id]');
      const key=direct?.getAttribute('data-annotation-id') || direct?.getAttribute('data-sidebar-annotation-id');
      if(!key && !target.closest('.page,.textLayer,canvas'))return;
      if(view.getSelection()?.toString().trim())return;
      if(timer!==null)view.clearTimeout(timer);
      timer=view.setTimeout(()=>{
        timer=null;if(disposed)return;
        const selected=reader._internalReader?._state?.selectedAnnotationIDs ?? [];
        const annotationKey=key || (selected.length===1 ? selected[0] : null);
        if(annotationKey)Promise.resolve().then(()=>onOpen(annotationKey)).catch(onError);
      },0);
    };
    const unload=()=>doc===rootDocument ? dispose() : detachDocument(doc);
    doc.addEventListener('mousedown',start,true);doc.addEventListener('mousemove',move,true);doc.addEventListener('click',click,true);view.addEventListener('unload',unload);
    const observer=new view.MutationObserver(changes=>{
      for(const change of changes){
        for(const node of change.addedNodes)if(node.nodeType===1){if(node.matches('iframe'))attachFrame(node);for(const frame of node.querySelectorAll('iframe'))attachFrame(frame);}
        for(const node of change.removedNodes)if(node.nodeType===1 && !node.isConnected){if(node.matches('iframe'))detachFrame(node);for(const frame of node.querySelectorAll('iframe'))detachFrame(frame);}
      }
    });
    observer.observe(doc,{childList:true,subtree:true});
    documents.set(doc,()=>{observer.disconnect();if(timer!==null)view.clearTimeout(timer);doc.removeEventListener('mousedown',start,true);doc.removeEventListener('mousemove',move,true);doc.removeEventListener('click',click,true);view.removeEventListener('unload',unload);});
    for(const frame of doc.querySelectorAll('iframe'))attachFrame(frame);
  }
  attach(rootDocument);return dispose;
}
