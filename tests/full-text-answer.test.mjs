import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';
import {createFullTextAnswers,readSessionFullText} from '../src/full-text-answer.mjs';
import {buildRequest,friendlyHTTPError} from '../src/model-adapter.mjs';
import {createLocalizer,localizeModelMessages} from '../src/localization.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const l10n=createLocalizer('zh-CN'),t=(...args)=>l10n.t(...args);
const fullText={text:'FIRST PAGE\n'+String.raw`$$L=-\log\frac{e^{S(z_i,z_j)}}{e^{S(z_i,z_j)}+e^{S(z_i,z_k)}}$$`+'\n'+'complete paper '.repeat(15000)+'\nLAST PAGE',totalPages:9,extractedPages:9};
const attachment={id:91,isPDFAttachment:()=>true};
async function fixture({pdf=async()=>structuredClone(fullText),lookup=()=>attachment}={}) {
 let disk=null,seq=0,fail=false,gate=null;const writes=[];
 const storage={read:async()=>structuredClone(disk),async write(value,{expectedRevision}){if(gate)await gate.promise;if(fail){fail=false;throw Error('Disk full');}assert.equal(disk?.revision??0,expectedRevision);disk=structuredClone(value);writes.push(value.revision);}};
 const store=await KnowledgeTreeStore.open(storage,{clock:()=>1000+seq,idFactory:()=>String(++seq)});
 const doc=await store.registerDocument({libraryId:7,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'Bound paper'});
 const node=await store.createSession({documentId:doc.id,concept:'InfoNCE',source:{selectedText:String.raw`$z_i$ and $z_j$`,location:{pageIndex:3}},explanation:{summary:'Old summary',detail:'Old detail',format:'markdown'}});
 await store.saveSessionView(node.id,{draft:'unsent draft',scrollTop:12});
 const extraction=[],lookups=[],requests=[],jobs=new Map();let alive=true,notifications=0;
 const Zotero={Items:{getByLibraryAndKey(...args){lookups.push(args);return lookup(...args);}},PDFWorker:{getFullText(...args){extraction.push(args);return pdf(...args);}},Reader:{getByTabID(){throw Error('must not use current PDF');}}};
 const controller=createFullTextAnswers({Zotero,store,jobs,request(messages,job){const pending=deferred();requests.push({messages,job,...pending});return pending.promise;},ancestors:()=>[],notify(){notifications++;},endJob(job,error){job.status=job.cancelled?'cancelled':'error';job.error=error.message;},isAlive:()=>alive,t});
 const settle=async()=>{for(let i=0;i<5;i++)await tick();await store.flush();};
 const cancel=()=>{const job=jobs.get(node.id);job.cancelled=true;job.status='cancelled';job.cancel?.();};
 return {Zotero,store,doc,node,jobs,controller,lookups,extraction,requests,writes,settle,cancel,setAlive:v=>{alive=v;},fail:()=>{fail=true;},gate:()=>{gate=deferred();return gate;},disk:()=>structuredClone(disk),notifications:()=>notifications};
}
async function conversation(f) {
 const q1=await f.store.appendMessage(f.node.id,{role:'user',content:'First question'});
 const a1=await f.store.appendMessage(f.node.id,{role:'assistant',content:'Old first answer'});
 const q2=await f.store.appendMessage(f.node.id,{role:'user',content:'Second question'});
 const a2=await f.store.appendMessage(f.node.id,{role:'assistant',content:'Old second answer'});
 return {q1,a1,q2,a2};
}

test('full-text extraction uses the bound library and attachment and requests every page unchanged',async()=>{
 const f=await fixture();assert.deepEqual(await readSessionFullText(f.Zotero,f.doc,t),{text:fullText.text,totalPages:9});assert.deepEqual(f.lookups,[[7,'PDF00001']]);assert.deepEqual(f.extraction,[[91,null]]);
});
for(const [name,lookup,pdf,key] of [
 ['missing',()=>null,undefined,'fullTextAttachmentMissing'],['deleted',()=>({...attachment,deleted:true}),undefined,'fullTextAttachmentMissing'],['non-PDF',()=>({...attachment,isPDFAttachment:()=>false}),undefined,'fullTextAttachmentMissing'],['lookup failure',()=>{throw Error('SECRET path');},undefined,'fullTextReadFailed'],['worker failure',undefined,async()=>{throw Error('SECRET path');},'fullTextReadFailed'],['scanned or empty',undefined,async()=>({text:'  ',totalPages:5,extractedPages:5}),'fullTextEmpty'],['partial extraction',undefined,async()=>({text:'one page',totalPages:9,extractedPages:1}),'fullTextIncomplete'],['invalid worker response',undefined,async()=>({text:{raw:'invalid'}}),'fullTextEmpty']
])test('safe extraction error: '+name,async()=>{
 const f=await fixture({...(lookup?{lookup}:{}),...(pdf?{pdf}:{})});await assert.rejects(readSessionFullText(f.Zotero,f.doc,t),{message:t(key)});f.controller.regenerate(f.node.id);await f.settle();assert.equal(f.jobs.get(f.node.id).status,'error');assert.equal(f.jobs.get(f.node.id).error,t(key));assert.equal(f.requests.length,0);assert.equal(f.store.getSession(f.node.id).explanation.detail,'Old detail');
});
test('regeneration returns immediately, deduplicates clicks and preserves the old answer until complete',async()=>{
 const f=await fixture();const before=f.store.snapshot();assert.equal(f.controller.regenerate(f.node.id),undefined);f.controller.regenerate(f.node.id);assert.equal(f.jobs.get(f.node.id).phase,'reading');await tick();assert.equal(f.requests.length,1);assert.equal(f.jobs.get(f.node.id).phase,'answering');assert.deepEqual(f.store.snapshot(),before);
 const context=JSON.parse(f.requests[0].messages[1].content);assert.equal(context.fullPaper.text,fullText.text);assert.equal(context.fullPaper.totalPages,9);assert.equal(context.selectedText,before.nodes[0].source.selectedText);
 f.requests[0].resolve(JSON.stringify({summary:'New summary',detail:'New full answer\n\n$z_i$'}));await f.settle();assert.equal(f.jobs.get(f.node.id).status,'saved');const node=f.store.getSession(f.node.id);assert.equal(node.explanation.detail,'New full answer\n\n$z_i$');assert.deepEqual(node.view,before.nodes[0].view);assert.equal(node.id,before.nodes[0].id);assert.equal(node.createdAt,before.nodes[0].createdAt);assert.ok(!JSON.stringify(f.disk()).includes('LAST PAGE'));
});
test('answer replacement uses its original question and only history before that question',async()=>{
 const f=await fixture(),{q1,a1,q2,a2}=await conversation(f);const before=f.store.getSession(f.node.id);f.controller.regenerate(f.node.id,a2.id);await tick();const messages=f.requests[0].messages;assert.equal(messages.at(-1).content,q2.content);assert.deepEqual(messages.slice(2).map(m=>m.content),[q1.content,a1.content,q2.content]);assert.equal(JSON.parse(messages[1].content).fullPaper.text,fullText.text);
 f.requests[0].resolve('Updated second answer');await f.settle();const next=f.store.getSession(f.node.id);assert.deepEqual(next.messages.slice(0,3),before.messages.slice(0,3));assert.deepEqual(next.messages[3],{...a2,content:'Updated second answer'});assert.deepEqual(next.explanation,before.explanation);assert.deepEqual(next.view,before.view);
});
test('regenerating an earlier answer keeps later messages, tree structure and message identity',async()=>{
 const f=await fixture(),{a1}=await conversation(f);const child=await f.store.createSession({documentId:f.doc.id,parentId:f.node.id,concept:'child'});const before=f.store.snapshot();f.controller.regenerate(f.node.id,a1.id);await tick();assert.equal(f.requests[0].messages.length,3);assert.equal(f.requests[0].messages.at(-1).content,'First question');f.requests[0].resolve('Revised first answer');await f.settle();const after=f.store.snapshot();assert.deepEqual(after.nodes.find(n=>n.id===child.id),before.nodes.find(n=>n.id===child.id));assert.deepEqual(after.workspace,before.workspace);assert.deepEqual(after.nodes[0].messages.slice(2),before.nodes[0].messages.slice(2));assert.deepEqual(after.nodes[0].messages[1],{...a1,content:'Revised first answer'});
});
test('last unanswered question appends one assistant; invalid message targets do not start requests',async()=>{
 const f=await fixture();const first=await f.store.appendMessage(f.node.id,{role:'user',content:'unanswered'});f.controller.regenerate(f.node.id,first.id);await tick();assert.equal(f.requests[0].messages.at(-1).content,'unanswered');f.requests[0].resolve('answer');await f.settle();assert.equal(f.store.getSession(f.node.id).messages.length,2);assert.throws(()=>f.controller.regenerate(f.node.id,first.id),{message:t('fullTextQuestionMissing')});assert.throws(()=>f.controller.regenerate(f.node.id,'absent'),{message:t('fullTextQuestionMissing')});assert.equal(f.requests.length,1);
});
test('failed generation or failed persistence leaves the previous answer intact',async()=>{
 for(const persistence of [false,true]){const f=await fixture();const before=f.store.snapshot();f.controller.regenerate(f.node.id);await tick();if(persistence){f.fail();f.requests[0].resolve('{"summary":"new","detail":"new"}');}else f.requests[0].reject(Error(friendlyHTTPError({status:413})));await f.settle();assert.deepEqual(f.store.snapshot(),before);assert.equal(f.jobs.get(f.node.id).status,'error');}
});
test('stop during PDF extraction starts no request and preserves the answer',async()=>{
 const worker=deferred(),f=await fixture({pdf:()=>worker.promise}),before=f.store.snapshot();f.controller.regenerate(f.node.id);f.cancel();worker.resolve(fullText);await f.settle();assert.equal(f.requests.length,0);assert.deepEqual(f.store.snapshot(),before);
});
for(const reason of ['cancel','shutdown','replacement','deletion'])test('late output after '+reason+' cannot overwrite or revive a node',async()=>{
 const f=await fixture();f.controller.regenerate(f.node.id);await tick();if(reason==='cancel')f.cancel();if(reason==='shutdown')f.setAlive(false);if(reason==='replacement')f.jobs.set(f.node.id,{status:'loading',kind:'ask'});if(reason==='deletion')await f.store.deleteSession(f.node.id);const before=f.store.snapshot();f.requests[0].resolve('{"summary":"late","detail":"late"}');await f.settle();assert.deepEqual(f.store.snapshot(),before);
});
test('stop while a completed answer is waiting behind another save prevents replacement',async()=>{
 const f=await fixture(),{a1}=await conversation(f);f.controller.regenerate(f.node.id,a1.id);await tick();const blocker=f.gate();const saving=f.store.saveSessionView(f.node.id,{draft:'latest draft'});await tick();f.requests[0].resolve('late replacement');await tick();f.cancel();blocker.resolve();await saving;await f.settle();assert.equal(f.store.getSession(f.node.id).messages[1].content,'Old first answer');assert.equal(f.store.getSession(f.node.id).view.draft,'latest draft');
});
test('concurrent replacement protects the newer answer using expectedContent',async()=>{
 const f=await fixture(),{a1}=await conversation(f);f.controller.regenerate(f.node.id,a1.id);await tick();await f.store.replaceAssistantMessage(f.node.id,a1.id,'Newer independent answer');f.requests[0].resolve('obsolete answer');await f.settle();assert.equal(f.store.getSession(f.node.id).messages[1].content,'Newer independent answer');assert.equal(f.jobs.get(f.node.id).status,'error');
});
test('whole paper and language instructions survive all three protocol request builders',async()=>{
 const f=await fixture();f.controller.regenerate(f.node.id);await tick();for(const locale of ['zh-CN','zh-TW','en-US'])for(const protocol of ['chat','responses','anthropic']){const messages=localizeModelMessages(f.requests[0].messages,locale),built=buildRequest({protocol,model:'fixture',baseURL:'http://127.0.0.1:1/v1'},'dummy',messages);const input=protocol==='responses'?built.body.input:built.body.messages;assert.equal(JSON.parse(input.find(m=>m.role==='user').content).fullPaper.text,fullText.text);assert.equal(built.body.stream,true);assert.ok(JSON.stringify(built.body).includes('LAST PAGE'));}f.cancel();f.requests[0].resolve('discard');await f.settle();
});
