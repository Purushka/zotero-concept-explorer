import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {KnowledgeTreeStore,emptyArchive} from '../src/knowledge-tree-store.mjs';
import {createZoteroStorage} from '../src/zotero-storage.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';

const artifacts = fileURLToPath(new URL('../.test-artifacts/',import.meta.url));
const documentInput = {libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Isolated test paper'};
const options = {idFactory:() => globalThis.crypto.randomUUID()};
async function diskDirectory() {
  await mkdir(artifacts,{recursive:true});
  return mkdtemp(path.join(artifacts,'archive-'));
}
function mockGecko() {
  const files = new Map(), writes = [], directories = [];
  let failNext = false;
  const IOUtils = {
    exists:async file => files.has(file),
    readJSON:async file => JSON.parse(files.get(file)),
    makeDirectory:async (directory,options) => { directories.push({directory,options}); },
    writeJSON:async (file,value,options) => {
      writes.push({file,value:structuredClone(value),options});
      if (failNext) { failNext = false; throw new Error('No disk space'); }
      if (files.has(file)) files.set(options.backupFile,files.get(file));
      files.set(file,JSON.stringify(value));
    }
  };
  const adapter = createZoteroStorage({dataDirectory:'D:\\TEST-ZOTERO-ONLY',IOUtils,PathUtils:path.win32});
  return {adapter,files,writes,directories,fail:() => { failNext = true; }};
}

test('disk archive survives a separate Node process and preserves full explanations',async () => {
  const directory = await diskDirectory(); const storage = createNodeStorage(directory);
  const store = await KnowledgeTreeStore.open(storage,options);
  const document = await store.registerDocument(documentInput);
  const node = await store.createSession({documentId:document.id,concept:'持久化概念',source:{selectedText:'A source sentence',context:'Full context',location:{pageIndex:7}},explanation:{summary:'Summary',detail:'Long explanation\n'.repeat(2000)}});
  await store.appendMessage(node.id,{role:'assistant',content:'Independent saved conversation'});
  await store.saveSessionView(node.id,{scrollTop:312,draft:'Not yet sent'});
  await store.showKnowledgeTree(node.id);
  await store.flush();
  const source = new URL('../src/knowledge-tree-store.mjs',import.meta.url).href;
  const helper = new URL('./helpers/node-storage.mjs',import.meta.url).href;
  const program = `import {KnowledgeTreeStore} from ${JSON.stringify(source)}; import {createNodeStorage} from ${JSON.stringify(helper)}; const store = await KnowledgeTreeStore.open(createNodeStorage(process.argv[1])); console.log(JSON.stringify(store.snapshot()));`;
  const recovered = JSON.parse(execFileSync(process.execPath,['--input-type=module','--eval',program,directory],{encoding:'utf8',maxBuffer:2000000}));
  assert.deepEqual(recovered,store.snapshot());
  assert.equal(JSON.parse(await readFile(storage.paths.backup,'utf8')).revision,recovered.revision - 1);
});

test('corrupt, JSON-null and future-version files are never reset or overwritten',async () => {
  for (const bytes of ['{broken','null',JSON.stringify({...emptyArchive(),version:99})]) {
    const directory = await diskDirectory(); const storage = createNodeStorage(directory);
    await writeFile(storage.paths.file,bytes,'utf8');
    await assert.rejects(KnowledgeTreeStore.open(storage,options));
    assert.equal(await readFile(storage.paths.file,'utf8'),bytes);
  }
});

test('Zotero adapter uses its own directory and native atomic flush with backup',async () => {
  const mock = mockGecko(); const store = await KnowledgeTreeStore.open(mock.adapter,options);
  const document = await store.registerDocument(documentInput);
  await store.createSession({documentId:document.id,concept:'Concept'});
  assert.equal(mock.writes.length,2);
  const write = mock.writes.at(-1);
  assert.equal(write.file,'D:\\TEST-ZOTERO-ONLY\\concept-explorer\\knowledge-tree.json');
  assert.deepEqual(write.options,{tmpPath:`${write.file}.tmp`,backupFile:`${write.file}.bak`,flush:true,mode:'overwrite'});
  assert.equal(mock.writes[0].options.mode,'create');
  assert.deepEqual(mock.directories[0].options,{ignoreExisting:true,createAncestors:true});
  assert.equal([...mock.files.keys()].some(file => file.endsWith('zotero.db')),false);
  const reopened = await KnowledgeTreeStore.open(mock.adapter,options);
  assert.deepEqual(reopened.snapshot(),store.snapshot());
});

test('native write failure propagates and the next transaction can still save',async () => {
  const mock = mockGecko(); const store = await KnowledgeTreeStore.open(mock.adapter,options);
  const document = await store.registerDocument(documentInput); const before = store.snapshot();
  mock.fail();
  await assert.rejects(store.createSession({documentId:document.id,concept:'Unsaved'}),/No disk space/);
  assert.deepEqual(store.snapshot(),before);
  await store.createSession({documentId:document.id,concept:'Saved'});
  assert.equal(store.snapshot().nodes.length,1);
  assert.equal(store.snapshot().nodes[0].concept,'Saved');
});

test('changed disk revisions reject a stale writer rather than overwrite history',async () => {
  const mock = mockGecko(); const first = await KnowledgeTreeStore.open(mock.adapter,options);
  const document = await first.registerDocument(documentInput);
  const second = await KnowledgeTreeStore.open(mock.adapter,options);
  await first.createSession({documentId:document.id,concept:'Newer history'});
  await assert.rejects(second.createSession({documentId:document.id,concept:'Stale state'}),/changed on disk/);
  const recovered = await KnowledgeTreeStore.open(mock.adapter,options);
  assert.equal(recovered.snapshot().nodes[0].concept,'Newer history');
});

test('a file changed to corrupt or future data is preserved before any later save',async () => {
  for (const bytes of ['{broken',JSON.stringify({...emptyArchive(),version:99})]) {
    const mock = mockGecko(); const store = await KnowledgeTreeStore.open(mock.adapter,options);
    const document = await store.registerDocument(documentInput);
    mock.files.set(mock.adapter.paths.file,bytes);
    const count = mock.writes.length;
    await assert.rejects(store.createSession({documentId:document.id,concept:'Must not overwrite'}));
    assert.equal(mock.files.get(mock.adapter.paths.file),bytes);
    assert.equal(mock.writes.length,count);
    assert.equal(store.snapshot().nodes.length,0);
  }
});

test('missing archive with a surviving backup requires explicit recovery',async () => {
  const mock = mockGecko();
  mock.files.set(mock.adapter.paths.backup,JSON.stringify(emptyArchive()));
  await assert.rejects(KnowledgeTreeStore.open(mock.adapter,options),/recovery is required/);
  assert.equal(mock.writes.length,0);
});

test('relative data paths and missing privileged APIs are rejected',() => {
  assert.throws(() => createZoteroStorage({dataDirectory:'relative',IOUtils:{},PathUtils:path.win32}),/absolute/);
  assert.throws(() => createZoteroStorage({dataDirectory:'D:\\TEST-ZOTERO-ONLY',IOUtils:{},PathUtils:path.win32}),/IOUtils/);
});
