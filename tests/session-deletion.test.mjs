import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {KnowledgeTreeStore,validateArchive} from '../src/knowledge-tree-store.mjs';
import {deleteSessionWithConfirmation,confirmSessionDeletion} from '../src/session-deletion.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';
const copy=value=>structuredClone(value);
async function fixture() {
  let disk=null,writes=0,failNext=false,sequence=0;
  const storage={read:async()=>copy(disk),write:async(value,{expectedRevision})=>{
    await new Promise(resolve=>setTimeout(resolve,1));
    if(failNext){failNext=false;throw Error('Disk full');}
    assert.equal(disk?.revision ?? 0,expectedRevision);disk=copy(value);writes++;
  }};
  const options={idFactory:()=>String(++sequence),clock:()=>1000+sequence};
  let store=await KnowledgeTreeStore.open(storage,options);
  const doc=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Synthetic paper'});
  const add=(concept,parentId=null,documentId=doc.id)=>store.createSession({documentId,parentId,concept,explanation:{summary:concept+' brief',detail:concept+' full detail'}});
  const root=await add('Root'),target=await add('Target',root.id),child=await add('Child',target.id),grandchild=await add('Grandchild',child.id),sibling=await add('Sibling',root.id);
  const otherDoc=await store.registerDocument({libraryId:1,itemKey:'PAPER002',attachmentKey:'PDF00002',title:'Other paper'}),other=await add('Other',null,otherDoc.id);
  await store.appendMessage(child.id,{role:'assistant',content:'Preserve child answer'});
  await store.saveSessionView(child.id,{draft:'Saved draft',scrollTop:42});
  for(const node of disk.nodes)node.generation={summary:{key:'a'.repeat(64),metrics:{source:'network',requestId:'synthetic',elapsedMs:120,firstTextMs:40,completedAt:1000,usage:{inputTokens:120,outputTokens:30,cachedInputTokens:null}}}};
  store=await KnowledgeTreeStore.open(storage,options);
  return {store,storage,options,doc,otherDoc,root,target,child,grandchild,sibling,other,fail:()=>{failNext=true;},disk:()=>copy(disk),writes:()=>writes};
}
const jobMap=(ids)=>{
  const cancelled=[];
  const jobs=new Map(ids.map(id=>[id,{status:'loading',cancelled:false,cancel:()=>cancelled.push(id)}]));
  return {jobs,cancelled};
};
test('deletion preview is read-only and counts every descendant',async()=>{
  const f=await fixture(),before=f.store.snapshot(),writes=f.writes();
  const plan=f.store.getDeletionPlan(f.target.id);
  assert.equal(plan.descendantCount,2);assert.deepEqual(new Set(plan.nodeIds),new Set([f.target.id,f.child.id,f.grandchild.id]));
  plan.nodeIds.length=0;assert.equal(f.store.getDeletionPlan(f.target.id).nodeIds.length,3);
  assert.equal(f.store.getDeletionPlan(f.sibling.id).descendantCount,0);
  assert.deepEqual(f.store.snapshot(),before);assert.equal(f.writes(),writes);
});
test('subtree deletion is atomic and preserves unrelated explanations and metadata',async()=>{
  const f=await fixture();await f.store.openSession(f.grandchild.id,'floating');await f.store.openSession(f.child.id,'page');await f.store.showKnowledgeTree(f.grandchild.id);
  const before=f.store.snapshot(),writes=f.writes();
  const result=await f.store.deleteSession(f.target.id),after=validateArchive(f.store.snapshot());
  assert.deepEqual(new Set(result.deletedNodeIds),new Set([f.target.id,f.child.id,f.grandchild.id]));
  assert.equal(after.revision,before.revision+1);assert.equal(f.writes(),writes+1);
  for(const id of [f.sibling.id,f.other.id])assert.deepEqual(f.store.getSession(id),before.nodes.find(n=>n.id===id));
  assert.equal(after.workspace.pageNodeId,f.root.id);assert.equal(after.workspace.floatingNodeId,null);assert.equal(after.workspace.treeSelectionId,f.root.id);
  assert(after.workspace.openNodeIds.every(id=>!result.deletedNodeIds.includes(id)));assert.equal(after.workspace.view,'knowledge');
  assert.deepEqual(f.disk(),after);
});
test('leaf deletion cleans all pointers without removing its parent',async()=>{
  const f=await fixture();await f.store.openSession(f.grandchild.id,'floating');await f.store.openSession(f.grandchild.id,'page');
  await f.store.deleteSession(f.grandchild.id);
  const w=validateArchive(f.store.snapshot()).workspace;
  assert.equal(w.pageNodeId,f.child.id);assert.equal(w.floatingNodeId,null);assert.equal(w.treeSelectionId,f.child.id);
  assert.equal(f.store.getSession(f.child.id).messages[0].content,'Preserve child answer');
});
test('deleting only a middle node promotes immediate children and preserves their content',async()=>{
  const f=await fixture(),before=f.store.snapshot();
  const result=await f.store.deleteSession(f.target.id,{mode:'node'});
  assert.deepEqual(result.deletedNodeIds,[f.target.id]);assert.deepEqual(result.reparentedNodeIds,[f.child.id]);
  const child=f.store.getSession(f.child.id),old=before.nodes.find(n=>n.id===child.id);
  assert.deepEqual({...child,parentId:old.parentId,updatedAt:old.updatedAt},old);assert.equal(child.parentId,f.root.id);
  assert.deepEqual(f.store.getSession(f.grandchild.id),before.nodes.find(n=>n.id===f.grandchild.id));
  assert.equal(f.store.snapshot().nodes.length,before.nodes.length-1);validateArchive(f.store.snapshot());
});
test('deleting only a root makes its immediate children document-level nodes',async()=>{
  const f=await fixture();await f.store.openSession(f.root.id,'page');
  await f.store.deleteSession(f.root.id,{mode:'node'});
  assert.equal(f.store.getSession(f.target.id).parentId,null);assert.equal(f.store.getSession(f.sibling.id).parentId,null);
  assert.equal(f.store.getSession(f.child.id).parentId,f.target.id);assert.equal(f.store.snapshot().workspace.treeSelectionId,f.doc.id);
  assert.equal(f.store.snapshot().workspace.pageNodeId,f.sibling.id);validateArchive(f.store.snapshot());
});
test('deleting all concepts retains the source document and a valid empty reading view',async()=>{
  const f=await fixture();await f.store.openSession(f.root.id,'floating');await f.store.openSession(f.root.id,'page');
  await f.store.deleteSession(f.root.id);
  const state=validateArchive(f.store.snapshot());
  assert.equal(state.nodes.filter(n=>n.documentId===f.doc.id).length,0);assert(state.documents.some(d=>d.id===f.doc.id));
  assert.equal(state.workspace.activeDocumentId,f.doc.id);assert.equal(state.workspace.pageNodeId,null);assert.equal(state.workspace.floatingNodeId,null);assert.equal(state.workspace.treeSelectionId,f.doc.id);
  assert.deepEqual(state.workspace.openNodeIds,[f.other.id]);
});
test('deletion in an inactive document does not change the active page or float',async()=>{
  const f=await fixture(),before=f.store.snapshot();await f.store.deleteSession(f.root.id);
  assert.deepEqual(f.store.snapshot().workspace,{...before.workspace,openNodeIds:[f.other.id]});assert.deepEqual(f.store.getSession(f.other.id),before.nodes.find(n=>n.id===f.other.id));
  assert.deepEqual(f.store.snapshot().documents.find(d=>d.id===f.otherDoc.id),before.documents.find(d=>d.id===f.otherDoc.id));
});
test('an unrelated sibling float and page survive deleting another branch',async()=>{
  const f=await fixture();await f.store.openSession(f.sibling.id,'floating');await f.store.openSession(f.sibling.id,'page');const w=f.store.snapshot().workspace;
  await f.store.deleteSession(f.target.id);const after=f.store.snapshot().workspace;
  assert.equal(after.pageNodeId,w.pageNodeId);assert.equal(after.floatingNodeId,w.floatingNodeId);assert.equal(after.treeSelectionId,w.treeSelectionId);
});
test('invalid modes, missing nodes, document IDs and mismatched confirmation reject without writes',async()=>{
  const f=await fixture(),before=f.store.snapshot(),writes=f.writes();
  for(const [id,options] of [['missing',{}],[f.doc.id,{}],[f.target.id,{mode:'invalid'}],[f.target.id,{expectedNodeIds:[f.target.id]}],[f.target.id,{expectedNodeIds:[f.target.id,f.child.id,f.child.id]}],[f.target.id,{expectedNodeIds:'all'}]])await assert.rejects(f.store.deleteSession(id,options));
  assert.deepEqual(f.store.snapshot(),before);assert.equal(f.writes(),writes);
});
test('cancelled confirmation changes neither archive nor jobs',async()=>{
  const f=await fixture(),before=f.store.snapshot(),writes=f.writes(),work=jobMap([f.target.id,f.child.id]);
  const result=await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:plan=>{assert.equal(plan.descendantCount,2);return null;}});
  assert.equal(result,null);assert.deepEqual(f.store.snapshot(),before);assert.equal(f.writes(),writes);assert.deepEqual(work.cancelled,[]);assert.equal(work.jobs.size,2);
});
test('successful branch deletion cancels affected jobs only after committed storage',async()=>{
  const f=await fixture(),work=jobMap([f.target.id,f.child.id,f.grandchild.id,f.sibling.id]);
  const jobs=[...work.jobs.values()];
  for(const job of jobs){const cancel=job.cancel;job.cancel=()=>{assert(!f.disk().nodes.some(n=>n.id===f.target.id));cancel();};}
  await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:()=> 'subtree'});
  assert.deepEqual(new Set(work.cancelled),new Set([f.target.id,f.child.id,f.grandchild.id]));assert.deepEqual([...work.jobs.keys()],[f.sibling.id]);assert.equal(jobs[3].cancelled,false);
});
test('only-node deletion keeps child generation jobs running',async()=>{
  const f=await fixture(),work=jobMap([f.target.id,f.child.id,f.grandchild.id]);
  await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:()=> 'node'});
  assert.deepEqual(work.cancelled,[f.target.id]);assert.deepEqual([...work.jobs.keys()],[f.child.id,f.grandchild.id]);
});
test('failed deletion leaves memory, disk, pointers and jobs intact and can be retried',async()=>{
  const f=await fixture(),before=f.store.snapshot(),work=jobMap([f.target.id,f.child.id]);f.fail();
  await assert.rejects(deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:()=> 'subtree'}),/Disk full/);
  assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(f.disk(),before);assert.deepEqual(work.cancelled,[]);assert.equal(work.jobs.size,2);
  await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:()=> 'subtree'});assert.equal(work.jobs.size,0);
});
test('new descendants during confirmation require fresh consent rather than unseen deletion',async()=>{
  const f=await fixture(),work=jobMap([f.target.id]);let added;
  await assert.rejects(deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:async()=>{added=await f.store.createSession({documentId:f.doc.id,parentId:f.child.id,concept:'Created during dialog'});return 'subtree';}}),/分支已变化/);
  assert(f.store.getSession(added.id));assert(f.store.getSession(f.target.id));assert.deepEqual(work.cancelled,[]);validateArchive(f.store.snapshot());
});
test('changing explanation text during confirmation does not invalidate deletion consent',async()=>{
  const f=await fixture(),work=jobMap([]);
  await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:async()=>{await f.store.setExplanation(f.child.id,{summary:'Finished while dialog open'});return 'subtree';}});
  assert.throws(()=>f.store.getSession(f.child.id),/does not exist/);
});
test('queued drafts and model completions cannot resurrect deleted nodes',async()=>{
  const f=await fixture(),revision=f.store.snapshot().revision;
  const before=f.store.saveSessionView(f.child.id,{draft:'Queued before deletion'}),remove=f.store.deleteSession(f.target.id);
  const late=[f.store.saveSessionView(f.child.id,{draft:'Late'}),f.store.setExplanation(f.target.id,{detail:'Late model completion'}),f.store.appendMessage(f.grandchild.id,{role:'assistant',content:'Late answer'}),f.store.createSession({documentId:f.doc.id,parentId:f.target.id,concept:'Late child'})];
  const results=await Promise.allSettled([before,remove,...late]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'fulfilled');assert(results.slice(2).every(r=>r.status==='rejected'));
  assert.deepEqual(f.store.snapshot(),f.disk());assert.equal(f.store.snapshot().revision,revision+2);validateArchive(f.store.snapshot());
});
test('throwing abort handlers do not undo committed deletion or affect sibling jobs',async()=>{
  const f=await fixture(),work=jobMap([f.target.id,f.sibling.id]);work.jobs.get(f.target.id).cancel=()=>{throw Error('Abort failed');};
  await deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:work.jobs,confirm:()=> 'subtree'});
  assert.equal(work.jobs.has(f.target.id),false);assert.equal(work.jobs.get(f.sibling.id).cancelled,false);
});
test('invalid confirmation results cannot bypass the allowed deletion choices',async()=>{
  const f=await fixture(),before=f.store.snapshot();await assert.rejects(deleteSessionWithConfirmation({store:f.store,nodeId:f.target.id,jobs:new Map(),confirm:()=> 'all'}),/Unknown deletion mode/);assert.deepEqual(f.store.snapshot(),before);
});
test('native confirmation defaults to cancel and distinguishes leaf, node-only and subtree choices',()=>{
  const calls=[],window={},Zotero={Prompt:{BUTTON_TITLE_CANCEL:2,confirm:options=>{calls.push(options);return choice;}}};let choice=1;
  const leaf={concept:'Leaf',descendantCount:0};assert.equal(confirmSessionDeletion(Zotero,window,leaf),null);assert.equal(calls.at(-1).defaultButton,1);
  choice=0;assert.equal(confirmSessionDeletion(Zotero,window,leaf),'subtree');
  const branch={concept:'Root',descendantCount:4};assert.equal(confirmSessionDeletion(Zotero,window,branch),'node');assert.equal(calls.at(-1).defaultButton,2);assert(calls.at(-1).text.includes('共删除 5 个节点'));assert.equal(calls.at(-1).window,window);
  choice=1;assert.equal(confirmSessionDeletion(Zotero,window,branch),'subtree');choice=2;assert.equal(confirmSessionDeletion(Zotero,window,branch),null);choice=-1;assert.equal(confirmSessionDeletion(Zotero,window,branch),null);
});
test('deletion persists across restart with an intact pre-deletion atomic backup',async()=>{
  const root=resolve(import.meta.dirname,'../.test-artifacts');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'deletion-store-')),storage=createNodeStorage(directory);let sequence=0;
  let store=await KnowledgeTreeStore.open(storage,{idFactory:()=>String(++sequence)});
  const doc=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001'}),rootNode=await store.createSession({documentId:doc.id,concept:'Root'}),child=await store.createSession({documentId:doc.id,parentId:rootNode.id,concept:'Child'});
  const before=store.snapshot();await store.deleteSession(rootNode.id);const after=store.snapshot();assert.equal(after.nodes.length,0);
  assert.deepEqual(JSON.parse(await readFile(storage.paths.backup,'utf8')),before);
  store=await KnowledgeTreeStore.open(storage);assert.deepEqual(store.snapshot(),after);assert.throws(()=>store.getSession(child.id),/does not exist/);
});
