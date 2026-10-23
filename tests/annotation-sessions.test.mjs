import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeTreeStore,validateArchive} from '../src/knowledge-tree-store.mjs';
import {createAnnotationSessions,highlightPosition} from '../src/annotation-sessions.mjs';
const copy=value=>structuredClone(value);
const selection={text:'InfoNCE $L_{tcn}$',pageLabel:'4',sortIndex:'00003|000123|00100',position:{pageIndex:3,rects:[[10,100,200,118],[10,80,200,98]],nextPageRects:[[10,700,200,718]]}};
async function fixture() {
  let disk=null,fail=false,sequence=0,writes=0,lookupError=false,afterWrite=null;
  const storage={read:async()=>copy(disk),write:async value=>{if(fail){fail=false;throw Error('Disk full');}disk=copy(value);writes++;if(afterWrite)await afterWrite(value);}};
  const store=await KnowledgeTreeStore.open(storage,{idFactory:()=>String(++sequence)}),items=new Map(),jobs=new Map(),saved=[];
  const attachment={id:10,libraryID:1,key:'PDF00001',isEditable:()=>true,getAnnotations:()=>[...items.values()].filter(item=>item.parentItem===attachment)};
  const item={key:'PAPER001'},Zotero={Items:{getByLibraryAndKey:(libraryId,key)=>{if(lookupError)throw Error('DB unavailable');return items.get(libraryId+':'+key);}},DataObjectUtilities:{generateKey:()=>('HL'+String(++sequence).padStart(6,'0'))},Annotations:{saveFromJSON:async (attachment,value)=>{
    saved.push(copy(value));const highlight={key:value.key,libraryID:attachment.libraryID,parentItem:attachment,deleted:false,annotationType:'highlight',annotationPosition:JSON.stringify(value.position),annotationComment:value.comment,isAnnotation:()=>true};items.set(attachment.libraryID+':'+value.key,highlight);return highlight;
  }}};
  const service=createAnnotationSessions({Zotero,store,jobs});
  return {store,storage,attachment,item,items,jobs,saved,Zotero,service,input:{attachment,item,annotation:selection,context:'Paper context',title:'R3M'},fail:()=>{fail=true;},lookupError:()=>{lookupError=true;},afterWrite:fn=>{afterWrite=fn;},disk:()=>copy(disk),writes:()=>writes};
}
test('highlight positions require valid PDF rectangles and preserve multi-page geometry',()=>{
  assert.deepEqual(highlightPosition(selection),selection.position);
  for(const position of [{pageIndex:0},{pageIndex:-1,rects:[[0,0,10,10]]},{pageIndex:0,rects:[[5,0,1,10]]},{pageIndex:0,rects:[[0,0,NaN,10]]}])assert.equal(highlightPosition({position}),null);
});
test('concurrent repeated selections create one native highlight and one archived conversation',async()=>{
  const f=await fixture(),results=await Promise.all([f.service.select(f.input),f.service.select(f.input),f.service.select(f.input)]);
  assert.equal(f.saved.length,1);assert.equal(f.store.snapshot().nodes.length,1);assert.deepEqual(results.map(value=>value.reused),[false,true,true]);
  assert.equal(new Set(results.map(value=>value.node.id)).size,1);assert.deepEqual(f.saved[0].position,selection.position);assert.equal(f.saved[0].sortIndex,selection.sortIndex);assert.equal(results[0].node.source.location.annotationKey,f.saved[0].key);
});
test('existing user highlight is reused without changing its note or text and can open a saved conversation',async()=>{
  const f=await fixture(),highlight=await f.Zotero.Annotations.saveFromJSON(f.attachment,{key:'EXIST001',position:selection.position,comment:'User note'});f.saved.length=0;
  const {node}=await f.service.select(f.input);await f.store.appendMessage(node.id,{role:'assistant',content:'Saved answer $z_i^b$'});
  assert.equal(f.saved.length,0);assert.equal(highlight.annotationComment,'User note');const opened=await f.service.open(f.attachment,highlight.key);
  assert.equal(opened.messages[0].content,'Saved answer $z_i^b$');assert.equal(opened.id,node.id);assert.equal(f.store.snapshot().workspace.floatingNodeId,node.id);
});
test('deleting a highlight removes its tree, cancels active work and repairs retained views atomically',async()=>{
  const f=await fixture(),{node}=await f.service.select(f.input),key=node.source.location.annotationKey;
  const child=await f.store.createSession({documentId:node.documentId,parentId:node.id,concept:'Child',source:{location:node.source.location}});
  const grand=await f.store.createSession({documentId:node.documentId,parentId:child.id,concept:'Grandchild'});
  const otherDoc=await f.store.registerDocument({libraryId:2,itemKey:'PAPER002',attachmentKey:'PDF00001',title:'Different library'});
  const unrelated=await f.store.createSession({documentId:otherDoc.id,concept:'Same key in other library',source:{location:{annotationKey:key}}});
  f.items.set('2:'+key,{key,parentItem:{key:'PDF00001'},isAnnotation:()=>true});
  await f.store.openSession(child.id,'page');await f.store.openSession(grand.id,'floating');await f.store.showKnowledgeTree(grand.id);
  const beforeOther=f.store.getSession(unrelated.id),beforeWrites=f.writes();let cancelled=0;f.jobs.set(child.id,{cancel:()=>cancelled++});
  f.items.delete('1:'+key);const result=await f.service.reconcile();
  assert.deepEqual(new Set(result.deletedNodeIds),new Set([node.id,child.id,grand.id]));assert.equal(cancelled,1);assert.equal(f.jobs.size,0);assert.equal(f.writes(),beforeWrites+1);
  const state=validateArchive(f.store.snapshot());assert.equal(state.workspace.floatingNodeId,null);assert.equal(state.workspace.treeSelectionId,node.documentId);assert.deepEqual(f.store.getSession(unrelated.id),beforeOther);assert.deepEqual(f.disk(),state);
});
test('a failed cleanup keeps the archived branch and active jobs; retry commits before cancelling',async()=>{
  const f=await fixture(),{node}=await f.service.select(f.input),job={cancelled:false};let cancellations=0;job.cancel=()=>cancellations++;f.jobs.set(node.id,job);
  const before=f.store.snapshot();f.items.delete('1:'+node.source.location.annotationKey);f.fail();await assert.rejects(f.service.reconcile(),/Disk full/);
  assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(f.disk(),before);assert.equal(job.cancelled,false);assert.equal(cancellations,0);
  await f.service.reconcile();assert.equal(job.cancelled,true);assert.equal(cancellations,1);assert.equal(f.store.snapshot().nodes.length,0);
});
test('database lookup failures never masquerade as deleted highlights',async()=>{
  const f=await fixture();await f.service.select(f.input);const before=f.store.snapshot();f.lookupError();await assert.rejects(f.service.reconcile(),/DB unavailable/);assert.deepEqual(f.store.snapshot(),before);
});
test('read-only documents and invalid selections do not create orphan conversations',async()=>{
  const f=await fixture();f.attachment.isEditable=()=>false;await assert.rejects(f.service.select(f.input),/highlightReadOnly/);await assert.rejects(f.service.select({...f.input,annotation:{text:'Missing position'}}),/highlightPositionMissing/);assert.equal(f.store.snapshot().nodes.length,0);assert.equal(f.saved.length,0);
});
test('a highlight removed while session write is in flight cannot leave a live conversation',async()=>{
  const f=await fixture();f.afterWrite(state=>{if(state.nodes.length)f.items.clear();});await assert.rejects(f.service.select(f.input),/highlightDeleted/);assert.equal(f.store.snapshot().nodes.length,0);
});
test('reconciliation after restart removes offline-deleted highlights without touching older unlinked sessions',async()=>{
  const f=await fixture(),{node}=await f.service.select(f.input);const legacy=await f.store.createSession({documentId:node.documentId,concept:'Legacy session'});
  f.items.clear();const store=await KnowledgeTreeStore.open(f.storage),service=createAnnotationSessions({Zotero:f.Zotero,store,jobs:new Map()});await service.reconcile();assert.deepEqual(store.snapshot().nodes.map(node=>node.id),[legacy.id]);
});
