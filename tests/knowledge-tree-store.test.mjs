import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeTreeStore,validateArchive,emptyArchive} from '../src/knowledge-tree-store.mjs';

const copy = value => structuredClone(value);
function memoryStorage() {
  let disk = null, failNext = false, active = 0, maximum = 0;
  return {
    read:async () => copy(disk),
    async write(value,{expectedRevision}) {
      active++; maximum = Math.max(maximum,active);
      try {
        await new Promise(resolve => setTimeout(resolve,1));
        if (failNext) { failNext = false; throw new Error('Disk full'); }
        assert.equal(disk?.revision ?? 0,expectedRevision);
        disk = copy(value);
      } finally { active--; }
    },
    failNextWrite:() => { failNext = true; }, maximum:() => maximum,
    onDisk:() => copy(disk)
  };
}
async function fixture() {
  const storage = memoryStorage(); let sequence = 0;
  const options = {clock:() => 1000 + sequence,idFactory:() => String(++sequence)};
  const store = await KnowledgeTreeStore.open(storage,options);
  const document = await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Example paper'});
  return {store,storage,options,document};
}
const session = (fixture,concept,parentId = null,extra = {}) => fixture.store.createSession({documentId:fixture.document.id,parentId,concept,...extra});

test('opening an empty archive does not write anything',async () => {
  const storage = memoryStorage();
  const store = await KnowledgeTreeStore.open(storage);
  assert.deepEqual(store.snapshot(),emptyArchive());
  assert.equal(storage.onDisk(),null);
});

test('document identity is stable and scoped to library and attachment',async () => {
  const f = await fixture();
  const same = await f.store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Duplicate'});
  const group = await f.store.registerDocument({libraryId:2,itemKey:'PAPER001',attachmentKey:'PDF00001'});
  const attachment = await f.store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00002'});
  assert.equal(same.id,f.document.id);
  assert.notEqual(group.id,same.id); assert.notEqual(attachment.id,same.id);
  assert.equal(f.store.snapshot().documents.length,3);
});

test('child click expands its parent and preserves all pages when returning',async () => {
  const f = await fixture();
  const root = await session(f,'Self-attention');
  const child = await session(f,'Query',root.id);
  const grandchild = await session(f,'Dot product',child.id);
  assert.equal(f.store.snapshot().workspace.pageNodeId,child.id);
  assert.equal(f.store.getSession(child.id).view.expanded,true);
  await f.store.openSession(root.id);
  const state = f.store.snapshot();
  assert.equal(state.workspace.pageNodeId,root.id);
  assert.equal(state.workspace.floatingNodeId,grandchild.id);
  assert.deepEqual(state.workspace.openNodeIds,[root.id,child.id,grandchild.id]);
  assert.equal(state.nodes.length,3);
});

test('closing a floating view hides it without deleting its session',async () => {
  const f = await fixture(); const root = await session(f,'Root'); const child = await session(f,'Child',root.id);
  await f.store.closeFloating();
  assert.equal(f.store.snapshot().workspace.pageNodeId,root.id);
  assert.equal(f.store.snapshot().workspace.floatingNodeId,null);
  assert.equal(f.store.getSession(child.id).concept,'Child');
  await f.store.openSession(child.id,'floating');
  assert.equal(f.store.snapshot().workspace.floatingNodeId,child.id);
});

test('branches and repeated concepts remain independent sessions',async () => {
  const f = await fixture(); const root = await session(f,'Root');
  const query = await session(f,'Query',root.id); const key = await session(f,'Key',root.id);
  const dot1 = await session(f,'Dot product',query.id); const dot2 = await session(f,'Dot product',key.id);
  const dot3 = await session(f,'Dot product',key.id,{source:{context:'Different source sentence'}});
  assert.equal(new Set([dot1.id,dot2.id,dot3.id]).size,3);
  const tree = f.store.getKnowledgeForest();
  assert.equal(tree[0].children[0].children[0].children[0].id,dot1.id);
  assert.equal(tree[0].children[0].children[1].children.length,2);
});

test('original explanations, independent chats, drafts and page positions survive reopening',async () => {
  const f = await fixture(); const root = await session(f,'Root'); const child = await session(f,'Child',root.id);
  const detail = '这是完整的详细解释，不应该被截断。\n'.repeat(8000);
  await f.store.setExplanation(child.id,{summary:'Summary',detail});
  await f.store.appendMessage(child.id,{role:'user',content:'Why?'});
  await f.store.appendMessage(child.id,{role:'assistant',content:'Because…'});
  await f.store.saveSessionView(child.id,{scrollTop:735,draft:'An unfinished follow-up'});
  await f.store.openSession(root.id);
  const reopened = await KnowledgeTreeStore.open(f.storage,f.options);
  assert.deepEqual(reopened.snapshot(),f.store.snapshot());
  assert.equal(reopened.getSession(child.id).explanation.detail,detail);
  assert.equal(reopened.getSession(child.id).view.scrollTop,735);
  assert.equal(reopened.getSession(root.id).messages.length,0);
  assert.equal(reopened.getSession(child.id).messages.length,2);
});

test('knowledge-tree navigation preserves the complete reading scene',async () => {
  const f = await fixture(); const root = await session(f,'Root'); const child = await session(f,'Child',root.id);
  const before = f.store.snapshot();
  await f.store.showKnowledgeTree(root.id);
  await f.store.showKnowledgeTree(child.id);
  await f.store.resumeReading();
  const after = f.store.snapshot();
  assert.equal(after.workspace.pageNodeId,before.workspace.pageNodeId);
  assert.equal(after.workspace.floatingNodeId,before.workspace.floatingNodeId);
  assert.deepEqual(after.nodes,before.nodes);
});

test('concurrent saves are serialized and none overwrite newer changes',async () => {
  const f = await fixture(); const node = await session(f,'Concurrent session');
  await Promise.all(Array.from({length:30},(_,index) => f.store.appendMessage(node.id,{role:'user',content:`Message ${index}`})));
  await f.store.flush();
  assert.equal(f.storage.maximum(),1);
  assert.deepEqual(f.store.getSession(node.id).messages.map(message => message.content),Array.from({length:30},(_,index) => `Message ${index}`));
  assert.deepEqual(f.storage.onDisk(),f.store.snapshot());
});

test('a failed write preserves committed data and does not poison later saves',async () => {
  const f = await fixture(); const node = await session(f,'Saved session');
  const before = f.store.snapshot();
  f.storage.failNextWrite();
  await assert.rejects(f.store.setExplanation(node.id,{detail:'Unsaved replacement'}),/Disk full/);
  assert.deepEqual(f.store.snapshot(),before);
  assert.deepEqual(f.storage.onDisk(),before);
  await f.store.setExplanation(node.id,{detail:'Successfully saved'});
  assert.equal(f.store.getSession(node.id).explanation.detail,'Successfully saved');
});

test('unbounded session history is not restricted to the preview node cap',async () => {
  const f = await fixture();
  for (let index = 0; index < 45; index++) await session(f,`Session ${index}`,null,{open:false});
  const reopened = await KnowledgeTreeStore.open(f.storage,f.options);
  assert.equal(reopened.snapshot().nodes.length,45);
  assert.equal(reopened.getKnowledgeForest()[0].children.length,45);
});

test('one-step parent navigation preserves descendants and session drafts',async () => {
  const f = await fixture(); const root = await session(f,'Root'); const child = await session(f,'Child',root.id);
  await f.store.saveSessionView(child.id,{draft:'Keep me'});
  await f.store.openSession(child.id);
  await f.store.returnToParent();
  assert.equal(f.store.snapshot().workspace.pageNodeId,root.id);
  await f.store.returnToParent();
  assert.equal(f.store.snapshot().workspace.pageNodeId,null);
  assert.equal(f.store.getSession(child.id).view.draft,'Keep me');
  assert.equal(f.store.snapshot().nodes.length,2);
});

test('invalid parents, cycles, unknown fields and future archives are rejected',async () => {
  const f = await fixture(); const root = await session(f,'Root'); const child = await session(f,'Child',root.id);
  const document = await f.store.registerDocument({libraryId:2,itemKey:'PAPER001',attachmentKey:'PDF00001'});
  const before = f.store.snapshot();
  await assert.rejects(f.store.createSession({documentId:document.id,parentId:root.id,concept:'Cross-document'}),/another document/);
  await assert.rejects(session(f,'Orphan','missing'),/does not exist/);
  const cyclic = f.store.snapshot(); cyclic.nodes[0].parentId = child.id;
  assert.throws(() => validateArchive(cyclic),/cycle/);
  const future = {...before,version:99};
  await assert.rejects(KnowledgeTreeStore.open({read:async () => future,write:async () => { throw new Error('Must not write'); }}),/unsupported schema/);
  assert.throws(() => f.store.setExplanation(root.id,{apiKey:'do-not-save'}),/unsupported fields/);
  assert.deepEqual(f.store.snapshot(),before);
});

test('read snapshots and queued patches cannot mutate committed state',async () => {
  const f = await fixture(); const node = await session(f,'Root');
  const patch = {detail:'Original patch'};
  const pending = f.store.setExplanation(node.id,patch); patch.detail = 'Mutated by caller';
  await pending;
  const detached = f.store.snapshot(); detached.nodes[0].explanation.detail = 'Changed snapshot';
  const tree = f.store.getKnowledgeForest(); tree[0].children[0].view.draft = 'Changed tree';
  assert.equal(f.store.getSession(node.id).explanation.detail,'Original patch');
  assert.equal(f.store.getSession(node.id).view.draft,'');
});

test('opening a different paper retains sessions from all papers in the forest',async () => {
  const f = await fixture(); const root = await session(f,'First paper concept');
  const document = await f.store.registerDocument({libraryId:1,itemKey:'PAPER002',attachmentKey:'PDF00002'});
  const second = await f.store.createSession({documentId:document.id,concept:'Second paper concept'});
  await f.store.openDocument(f.document.id);
  assert.equal(f.store.snapshot().workspace.activeDocumentId,f.document.id);
  assert.equal(f.store.getSession(second.id).concept,'Second paper concept');
  const forest = f.store.getKnowledgeForest();
  assert.equal(forest.length,2);
  assert.equal(forest[0].children[0].id,root.id);
  assert.equal(forest[1].children[0].id,second.id);
});

test('expand keeps the same floating session and both independent pointers survive disk reopen',async()=>{
  const f=await fixture(),root=await session(f,'Root');
  await f.store.openSession(root.id,'page');
  let w=f.store.snapshot().workspace;assert.equal(w.pageNodeId,root.id);assert.equal(w.floatingNodeId,root.id);
  const child=await session(f,'Child',root.id);
  await f.store.openSession(child.id,'page');await f.store.openSession(root.id,'page');
  w=f.store.snapshot().workspace;assert.equal(w.pageNodeId,root.id);assert.equal(w.floatingNodeId,child.id);
  const reopened=await KnowledgeTreeStore.open({read:async()=>f.store.snapshot(),write:async()=>{}});
  assert.deepEqual(reopened.snapshot().workspace,w);
  const other=await f.store.registerDocument({libraryId:2,itemKey:'PAPER002',attachmentKey:'PDF00002'});
  const otherNode=await f.store.createSession({documentId:other.id,concept:'Other',open:false});
  await f.store.openSession(otherNode.id,'page');assert.equal(f.store.snapshot().workspace.floatingNodeId,null);
});
