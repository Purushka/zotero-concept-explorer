import pLimit from '../vendor/p-limit.mjs';
import {cancelDeletedJobs} from './session-deletion.mjs';
const copy=value=>JSON.parse(JSON.stringify(value));
const validRects=rects=>Array.isArray(rects) && rects.length>0 && rects.every(rect=>Array.isArray(rect) && rect.length===4 && rect.every(Number.isFinite) && rect[2]>rect[0] && rect[3]>rect[1]);
export function highlightPosition(annotation) {
  const position=annotation?.position;
  if(!Number.isSafeInteger(position?.pageIndex) || position.pageIndex<0 || !validRects(position.rects) || (position.nextPageRects && !validRects(position.nextPageRects)))return null;
  return copy(position);
}
function samePosition(left,right) {
  return left?.pageIndex===right?.pageIndex && JSON.stringify(left?.rects)===JSON.stringify(right?.rects) && JSON.stringify(left?.nextPageRects ?? null)===JSON.stringify(right?.nextPageRects ?? null);
}
// Serialize selection and reconciliation so double clicks cannot create two
// highlights and notifier events cannot run halfway through a session save.
export function createAnnotationSessions({Zotero,store,jobs,onChanged=()=>{},message=key=>key}) {
  const queue=pLimit(1);
  const identity=(attachment,key)=>({libraryId:attachment.libraryID,attachmentKey:attachment.key,annotationKey:key});
  function annotationExists(ref) {
    // Lookup errors propagate: a locked/unavailable database is not deletion.
    const item=Zotero.Items.getByLibraryAndKey(ref.libraryId,ref.annotationKey);
    return !!item && !item.deleted && item.isAnnotation() && item.parentItem?.key===ref.attachmentKey;
  }
  async function removeMissing(refs) {
    const missing=refs.filter(ref=>!annotationExists(ref));
    if(!missing.length)return {deletedNodeIds:[]};
    const result=await store.deleteAnnotationSessions(missing);
    cancelDeletedJobs(jobs,result.deletedNodeIds);onChanged();return result;
  }
  function references() {
    const state=store.snapshot(),documents=new Map(state.documents.map(doc=>[doc.id,doc.identity])),refs=new Map();
    for(const node of state.nodes)if(node.source.location.annotationKey) {
      const doc=documents.get(node.documentId),ref={libraryId:doc.libraryId,attachmentKey:doc.attachmentKey,annotationKey:node.source.location.annotationKey};
      refs.set(JSON.stringify(ref),ref);
    }
    return [...refs.values()];
  }
  function find(attachment,key) {return store.sessionsForAnnotation(identity(attachment,key));}
  return {
    select({attachment,item,annotation,context,title}) {return queue(async()=>{
      const position=highlightPosition(annotation);
      if(!position)throw new Error(message('highlightPositionMissing'));
      const text=String(annotation.text).trim();
      let highlight=(await attachment.getAnnotations()).find(candidate=>{
        if(candidate.deleted || candidate.annotationType!=='highlight')return false;
        try {return samePosition(JSON.parse(candidate.annotationPosition),position);}catch {return false;}
      });
      if(!highlight) {
        if(!attachment.isEditable())throw new Error(message('highlightReadOnly'));
        highlight=await Zotero.Annotations.saveFromJSON(attachment,{
          key:Zotero.DataObjectUtilities.generateKey(),type:'highlight',text,comment:'',color:'#ffd400',
          pageLabel:String(annotation.pageLabel ?? position.pageIndex+1),
          sortIndex:annotation.sortIndex || String(position.pageIndex).padStart(5,'0')+'|000000|'+String(Math.max(0,Math.round(position.rects[0][1]))).padStart(5,'0'),
          position,tags:[]
        });
      }
      const ref=identity(attachment,highlight.key),existing=find(attachment,highlight.key).find(node=>node.parentId===null) ?? find(attachment,highlight.key)[0];
      if(existing) {await store.openSession(existing.id,'floating');return {node:store.getSession(existing.id),reused:true};}
      const document=await store.registerDocument({libraryId:attachment.libraryID,itemKey:item.key,attachmentKey:attachment.key,title});
      if(!annotationExists(ref))throw new Error(message('highlightDeleted'));
      const node=await store.createSession({documentId:document.id,concept:text,source:{selectedText:text,context,location:{pageIndex:position.pageIndex,annotationKey:highlight.key}}});
      // Covers deletion while the archive was being committed, before jobs start.
      if(!annotationExists(ref)) {await removeMissing([ref]);throw new Error(message('highlightDeleted'));}
      onChanged();return {node,reused:false};
    });},
    open(attachment,key) {return queue(async()=>{
      const node=find(attachment,key).find(node=>node.parentId===null) ?? find(attachment,key)[0];
      if(!node)return null;
      if(!annotationExists(identity(attachment,key))) {await removeMissing([identity(attachment,key)]);return null;}
      await store.openSession(node.id,'floating');onChanged();return store.getSession(node.id);
    });},
    has:(attachment,key)=>find(attachment,key).length>0,
    reconcile:()=>queue(()=>removeMissing(references())),
    flush:()=>queue(()=>{})
  };
}
