import test from 'node:test';
import assert from 'node:assert/strict';
import {KnowledgeTreeStore,validateArchive,emptyArchive} from '../src/knowledge-tree-store.mjs';
import {createZoteroStorage} from '../src/zotero-storage.mjs';
import {join} from 'node:path';

const copy = value => structuredClone(value);
const entry = (key='a'.repeat(64),source='network') => ({key,metrics:{source,requestId:'synthetic-request',elapsedMs:120,firstTextMs:40,completedAt:1000,usage:{inputTokens:120,outputTokens:80,cachedInputTokens:null}}});
async function fixture(withMetadata=true) {
  let disk=null,writes=0,sequence=0;
  const storage={read:async()=>copy(disk),write:async(value,{expectedRevision})=>{assert.equal(disk?.revision ?? 0,expectedRevision);disk=copy(value);writes++;}};
  const options={idFactory:()=>String(++sequence),clock:()=>1000+sequence};
  let store=await KnowledgeTreeStore.open(storage,options);
  const doc=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Synthetic paper only'});
  const parent=await store.createSession({documentId:doc.id,concept:'Root',source:{context:'Synthetic nearby paragraph; no text is clipped.'},explanation:{summary:'Root brief',detail:'## Full original detail\n\n$E=mc^2$'}});
  const child=await store.createSession({documentId:doc.id,parentId:parent.id,concept:'Child',explanation:{summary:'Child brief',detail:'Child full detail'}});
  await store.appendMessage(parent.id,{role:'user',content:'Synthetic saved question'});
  await store.appendMessage(parent.id,{role:'assistant',content:'Synthetic saved answer'});
  await store.saveSessionView(parent.id,{draft:'Unsent question',scrollTop:456,expanded:true});
  await store.openSession(parent.id);
  if(withMetadata) for(const node of disk.nodes) node.generation={summary:entry(),detail:entry('b'.repeat(64),'shared')};
  const before=copy(disk),initialWrites=writes;
  store=await KnowledgeTreeStore.open(storage,options);
  return {store,storage,options,doc,parent,child,before,disk:()=>copy(disk),writes:()=>writes-initialWrites,replace:value=>{disk=copy(value);}};
}

test('0.2.3 archives without generation metadata retain their original shape',async()=>{
  const f=await fixture(false);
  assert.deepEqual(f.store.snapshot(),f.before);
  assert.equal(f.writes(),0);
  assert(f.store.snapshot().nodes.every(node=>!Object.hasOwn(node,'generation')));
  assert.deepEqual(validateArchive(emptyArchive()),emptyArchive());
});

test('0.2.4 archives are read without mutating, pruning, or writing metadata',async()=>{
  const f=await fixture();
  const frozen=copy(f.before),serialized=JSON.stringify(frozen);
  for(const node of frozen.nodes) {Object.freeze(node.generation);Object.freeze(node);}
  assert.equal(validateArchive(frozen),frozen);
  assert.equal(JSON.stringify(frozen),serialized);
  assert.deepEqual(f.store.snapshot(),f.before);
  assert.deepEqual(f.disk(),f.before);
  assert.equal(f.writes(),0);
});

test('navigation and restart preserve all answers, context, branches, drafts, scroll and metadata',async()=>{
  const f=await fixture();
  await f.store.showKnowledgeTree(f.child.id);
  await f.store.openSession(f.child.id,'floating');
  await f.store.openSession(f.parent.id,'page');
  await f.store.returnToParent();
  await f.store.closeFloating();
  await f.store.resumeReading();
  assert.deepEqual(f.store.snapshot().nodes,f.before.nodes);
  assert.deepEqual(f.store.snapshot().documents,f.before.documents);
  const reopened=await KnowledgeTreeStore.open(f.storage,f.options);
  assert.deepEqual(reopened.snapshot(),f.store.snapshot());
  assert.equal(reopened.getSession(f.child.id).parentId,f.parent.id);
});

test('regenerating only summary invalidates its metadata and preserves detail and siblings',async()=>{
  const f=await fixture();
  await f.store.setExplanation(f.parent.id,{summary:'New baseline summary'});
  const node=f.store.getSession(f.parent.id),original=f.before.nodes[0];
  assert.deepEqual(node.generation,{detail:original.generation.detail});
  assert.equal(node.explanation.detail,original.explanation.detail);
  assert.deepEqual(node.messages,original.messages);
  assert.deepEqual(node.source,original.source);
  assert.deepEqual(node.view,original.view);
  assert.deepEqual(f.store.getSession(f.child.id),f.before.nodes[1]);
});

test('regenerating only detail invalidates its metadata and preserves summary metadata',async()=>{
  const f=await fixture();
  await f.store.setExplanation(f.parent.id,{detail:'New full detail'});
  assert.deepEqual(f.store.getSession(f.parent.id).generation,{summary:f.before.nodes[0].generation.summary});
  assert.equal(f.store.getSession(f.parent.id).explanation.summary,f.before.nodes[0].explanation.summary);
});

test('the restored one-call summary/detail save removes only obsolete fingerprints',async()=>{
  const f=await fixture();
  await f.store.setExplanation(f.parent.id,{summary:'New brief',detail:'New complete detail',format:'markdown'});
  const node=f.store.getSession(f.parent.id);
  assert.equal(Object.hasOwn(node,'generation'),false);
  assert.deepEqual(node.source,f.before.nodes[0].source);
  assert.deepEqual(node.view,f.before.nodes[0].view);
  assert.deepEqual(node.messages,f.before.nodes[0].messages);
  assert.deepEqual(f.store.getSession(f.child.id),f.before.nodes[1]);
  assert.deepEqual((await KnowledgeTreeStore.open(f.storage,f.options)).snapshot(),f.store.snapshot());
});

test('format-only changes and chat append do not discard valid metadata',async()=>{
  const f=await fixture();
  await f.store.setExplanation(f.parent.id,{format:'plain'});
  await f.store.appendMessage(f.parent.id,{role:'user',content:'Another synthetic question'});
  assert.deepEqual(f.store.getSession(f.parent.id).generation,f.before.nodes[0].generation);
});

test('invalid or unknown generation fields are rejected without modifying the archive',async()=>{
  const f=await fixture();
  const corrupt=[null,[],{unknown:entry()},{summary:{...entry(),key:'bad'}},{summary:{...entry(),unknown:1}},{summary:{key:entry().key,metrics:{...entry().metrics,source:'untrusted'}}},{summary:{key:entry().key,metrics:{...entry().metrics,elapsedMs:-1}}},{summary:{key:entry().key,metrics:{...entry().metrics,usage:{inputTokens:1.2,outputTokens:80,cachedInputTokens:null}}}},{summary:{key:entry().key,metrics:{...entry().metrics,usage:{inputTokens:1,outputTokens:80,cachedInputTokens:null,unknown:1}}}}];
  for(const generation of corrupt) {
    const archive=copy(f.before);archive.nodes[0].generation=generation;
    const text=JSON.stringify(archive);
    assert.throws(()=>validateArchive(archive),/Invalid knowledge archive/);
    assert.equal(JSON.stringify(archive),text);
    let writes=0;
    await assert.rejects(KnowledgeTreeStore.open({read:async()=>archive,write:async()=>writes++}),/Invalid knowledge archive/);
    assert.equal(writes,0);
  }
});

test('accepting known metadata does not relax future-schema or other unknown-field checks',async()=>{
  const f=await fixture();
  for(const mutate of [a=>a.version=2,a=>a.nodes[0].unknown=true,a=>a.workspace.unknown=true,a=>a.documents[0].unknown=true]) {
    const archive=copy(f.before);mutate(archive);const before=JSON.stringify(archive);
    assert.throws(()=>validateArchive(archive),/Invalid knowledge archive/);
    assert.equal(JSON.stringify(archive),before);
  }
});

test('native atomic writes preserve metadata and stale revision/corrupt-disk protections',async()=>{
  const f=await fixture();let disk=copy(f.before),writeOptions,writeCount=0;
  const dataDirectory=join(process.cwd(),'.test-artifacts','synthetic-archive');
  const io={exists:async path=>path.endsWith('knowledge-tree.json'),readJSON:async()=>copy(disk),makeDirectory:async()=>{},writeJSON:async(path,value,options)=>{disk=copy(value);writeOptions=options;writeCount++;}};
  const adapter=createZoteroStorage({dataDirectory,IOUtils:io,PathUtils:{join}});
  const store=await KnowledgeTreeStore.open(adapter,f.options);
  assert.equal(writeCount,0);
  await store.saveSessionView(f.parent.id,{draft:'Updated draft'});
  assert.equal(writeCount,1);
  assert.equal(writeOptions.flush,true);
  assert.equal(writeOptions.backupFile,adapter.paths.backup);
  assert.deepEqual(disk.nodes[0].generation,f.before.nodes[0].generation);
  disk.revision++;let preserved=JSON.stringify(disk);
  await assert.rejects(store.closeFloating(),/changed on disk/);
  assert.equal(JSON.stringify(disk),preserved);
  disk=copy(f.before);disk.nodes[0].generation={summary:{key:'bad'}};preserved=JSON.stringify(disk);
  await assert.rejects(store.closeFloating(),/Invalid knowledge archive/);
  assert.equal(JSON.stringify(disk),preserved);
  assert.equal(writeCount,1);
});
