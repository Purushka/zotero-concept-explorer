import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';
import {createFullTextAnswers} from '../src/full-text-answer.mjs';
import {createLocalizer} from '../src/localization.mjs';
const {chromium,launchOptions}=createRequire(import.meta.url)('./helpers/browser.cjs');
const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.test-artifacts'),{recursive:true});
const artifact=await mkdtemp(join(root,'.test-artifacts','composer-full-text-ui-'));
const store=await KnowledgeTreeStore.open(createNodeStorage(artifact));
const doc=await store.registerDocument({libraryId:1,itemKey:'INPUT001',attachmentKey:'BOUND001',title:'Synthetic complete paper'});
const node=await store.createSession({documentId:doc.id,concept:'Temporal contrast',source:{selectedText:'Original selection $z_i$'},explanation:{summary:'原有简述。',detail:'原有解释 $z_i$。'}});
await store.openSession(node.id,'page');await store.openSession(node.id,'floating');
const l10n=createLocalizer('zh-CN'),jobs=new Map(),requests=[],lookups=[],extractions=[],checks=[],errors=[],pages=[];
let asks=0,cancels=0,browser,closing=false;
const state=()=>({archive:store.snapshot(),locale:l10n.locale,startupError:'',jobs:[...jobs].map(([nodeId,job])=>({nodeId,...job}))});
const sync=async()=>{if(!closing)await Promise.all(pages.map(page=>page.evaluate(s=>window.ConceptPanel?.update(s),state())));};
const notify=()=>{void sync().catch(e=>{if(!closing)errors.push(e.message);});};
const until=async(fn,label)=>{for(let i=0;i<250;i++){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+label);};
const fullPaper='FIRST PAGE synthetic evidence\n'+ 'Complete paper context. '.repeat(3000)+'\nLAST PAGE $S(u,v)=-\\lVert u-v\\rVert_2$';
const Zotero={Items:{getByLibraryAndKey(libraryId,key){lookups.push([libraryId,key]);return {id:47,isPDFAttachment:()=>true};}},PDFWorker:{async getFullText(...args){extractions.push(args);return {text:fullPaper,totalPages:5,extractedPages:5};}}};
const full=createFullTextAnswers({Zotero,store,jobs,ancestors:()=>[],notify,isAlive:()=>!closing,t:key=>l10n.t(key),endJob(job,error){job.status='error';job.error=error.message;},request(messages,job){
 let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
 requests.push({messages,job,resolve,reject});
 if(job.kind==='explanation')job.preview={summary:'全文流式预览 $z_i$'};else job.text='追问流式预览 $z_i$';
 notify();return promise;
}});
const server=createServer(async(req,res)=>{
 const base=join(root,'dist','addon','content'),file=join(base,req.url==='/'?'panel.html':decodeURIComponent(req.url.split('?')[0]));
 if(!file.startsWith(base+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.woff2?$/.test(file)?'font/woff2':'application/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
 browser=await chromium.launch(launchOptions);
 const connect=async(surface,viewport)=>{
  const page=await browser.newPage({viewport});pages.push(page);page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('rpc',async(action,args)=>{
   if(action==='state')return state();
   if(action==='settings')return {language:l10n.locale,locale:l10n.locale,version:'0.2.11',protocol:'chat',hasKey:false};
   if(action==='mutate')await store[args[0]](...(args[1]??[]));
   if(action==='ask'){
    asks++;await store.appendMessage(args[0],{role:'user',content:args[1]});await store.saveSessionView(args[0],{draft:''});
    jobs.set(args[0],{status:'loading',kind:'ask',text:'这是保留的流式回答 $z_i$。'});
   }
   if(action==='cancel'){cancels++;const job=jobs.get(args[0]);job.cancelled=true;job.status='cancelled';job.error=l10n.t('cancelledPreview');}
   if(action==='full')full.regenerate(...args);
   await sync();return state();
  });
  await page.addInitScript(()=>{
   const call=async(action,...args)=>{const value=await window.rpc(action,args);if(value?.archive && action!=='state')await window.ConceptPanel.update(value);return value;};
   window.ConceptBridge={state:()=>call('state'),settings:()=>call('settings'),mutate:(...args)=>call('mutate',...args),ask:(...args)=>call('ask',...args),cancel:(...args)=>call('cancel',...args),regenerateFullText:(...args)=>call('full',...args),presentation:()=>{},navigateOriginal:async()=>{},dismiss:async()=>{}};
  });
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.evaluate(s=>window.ConceptPanel.init('reading',{surface:s}),surface);await page.evaluate(()=>document.fonts.ready);return page;
 };
 const page=await connect('tab',{width:1240,height:900}),floating=await connect('floating',{width:440,height:700});
 const article=page.locator('#page-slot .session'),field=article.locator('textarea'),send=article.locator('.composer-send');
 const floatArticle=floating.locator('#floating-slot .session'),floatSend=floatArticle.locator('.composer-send');
 const pass=label=>checks.push(label);
 const icon=button=>button.evaluate(b=>({state:b.dataset.state,disabled:b.disabled,label:b.getAttribute('aria-label'),arrow:getComputedStyle(b.querySelector('.send-arrow')).display,stop:getComputedStyle(b.querySelector('.stop-square')).display,color:getComputedStyle(b).backgroundColor,w:b.getBoundingClientRect().width,h:b.getBoundingClientRect().height,r:getComputedStyle(b).borderRadius}));
 let v=await icon(send);assert.equal(v.state,'send');assert.equal(v.color,'rgb(22, 133, 248)');assert.equal(v.r,'50%');assert.equal(v.w,v.h);assert.equal(v.w,36);assert.equal(v.stop,'none');assert.notEqual(v.arrow,'none');assert.ok(v.disabled);pass('Blue circular up-arrow is accessible and disabled for empty input');
 await field.fill('   ');assert.ok((await icon(send)).disabled);await field.fill('一行输入');assert.equal((await icon(send)).disabled,false);pass('Whitespace cannot send; text enables the arrow');
 const metrics=()=>field.evaluate(el=>({h:el.getBoundingClientRect().height,resize:getComputedStyle(el).resize,overflow:getComputedStyle(el).overflowY,scroll:el.scrollHeight}));
 const small=await metrics();assert.equal(small.resize,'none');
 await field.fill(Array.from({length:6},(_,i)=>'第'+i+'行').join('\n'));let grown=await metrics();assert.ok(grown.h>small.h && grown.h<=176);
 await field.fill('变回一行');assert.ok((await metrics()).h<=small.h+1);pass('Textarea has no resize grip and grows/retracts with multiline editing');
 await field.fill('很长的输入内容 '.repeat(200));grown=await metrics();assert.equal(grown.h,176);assert.equal(grown.overflow,'auto');assert.ok(grown.scroll>grown.h);pass('Long drafts stop growing at 176 px and scroll internally');
 await field.fill('自动换行 '.repeat(25));const wide=await metrics();await page.setViewportSize({width:700,height:900});await until(async()=> (await metrics()).h>wide.h,'resize observer wrapping');await page.setViewportSize({width:1240,height:900});await until(async()=> (await metrics()).h===wide.h,'resize observer shrink');pass('Input reflows and resizes when the available panel width changes');
 await field.fill('第一行');await field.press('Shift+Enter');await field.press('End');await field.type('第二行');assert.equal(await field.inputValue(),'第一行\n第二行');assert.equal(asks,0);pass('Shift+Enter inserts a newline without sending');
 await field.fill('中文候选');await field.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await field.press('Enter');assert.equal(asks,0);
 await field.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,bubbles:true,cancelable:true}));});assert.equal(asks,0);pass('IME composition, isComposing and legacy keyCode 229 do not send');
 await field.fill('连续回车只发送一次');await field.evaluate(el=>{for(let i=0;i<3;i++)el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
 await until(()=>asks===1 && jobs.get(node.id)?.status==='loading','Enter submission');await until(async()=>await field.inputValue()==='','clear sent draft');
 assert.equal(store.getSession(node.id).messages.length,1);assert.equal(store.getSession(node.id).messages[0].content,'连续回车只发送一次');assert.equal(asks,1);pass('Bare Enter sends once even if repeated while view saves are queued');
 await until(async()=> (await icon(send)).state==='stop' && (await icon(floatSend)).state==='stop','shared Stop buttons');v=await icon(send);assert.equal(v.label,'停止生成');assert.equal(v.arrow,'none');assert.notEqual(v.stop,'none');assert.equal(v.disabled,false);assert.equal(await article.locator('.job-state').textContent(),'');assert.ok(await article.locator('.stream-preview .katex').count());pass('Generation uses the same square Stop button on both surfaces, with live math preview and no green status bar');
 await field.fill('生成时继续写的草稿');await field.press('Enter');assert.equal(cancels,0);assert.equal(asks,1);assert.equal(await field.inputValue(),'生成时继续写的草稿');pass('Enter during generation neither stops the answer nor loses the next draft');
 await send.click();await until(()=>cancels===1,'Stop click');assert.equal(await field.inputValue(),'生成时继续写的草稿');await until(async()=> (await icon(send)).state==='send' && (await icon(floatSend)).state==='send','stop synchronization');pass('Clicking the square cancels generation and restores both arrows while preserving the draft');
 await store.appendMessage(node.id,{role:'assistant',content:'原始追问回答 $z_i$。'});jobs.delete(node.id);await sync();
 const before=store.getSession(node.id),original=before.explanation.detail;
 await article.locator('.answer-actions [data-action=full-text]').click();await until(()=>requests.length===1,'full-text request');await sync();
 assert.deepEqual(lookups.at(-1),[1,'BOUND001']);assert.deepEqual(extractions.at(-1),[47,null]);const context=JSON.parse(requests[0].messages[1].content);assert.equal(context.fullPaper.text,fullPaper);assert.equal(context.selectedText,'Original selection $z_i$');assert.equal(store.getSession(node.id).explanation.detail,original);assert.ok(await article.locator('.answer-actions button').isDisabled());pass('Full-text action reads every page of the bound attachment and leaves the previous answer until success');
 requests[0].resolve(JSON.stringify({summary:'全文修订简述 $z_i$。',detail:'全文修订解释\n\n$$L=-\\log p$$'}));await until(()=>jobs.get(node.id)?.status==='saved','full explanation saved');await sync();
 assert.equal(store.getSession(node.id).explanation.summary,'全文修订简述 $z_i$。');assert.deepEqual(store.getSession(node.id).messages,before.messages);assert.equal(await field.inputValue(),'生成时继续写的草稿');assert.ok(await article.locator('.answer .math-display .katex').count());assert.ok((await floatArticle.locator('.answer').textContent()).includes('全文修订简述'));pass('Successful full-text explanation replaces in place, preserves conversation/draft and syncs formula rendering');
 const answer=store.getSession(node.id).messages.at(-1);await article.locator('.message.assistant [data-action=full-text]').click();await until(()=>requests.length===2,'follow-up full request');assert.equal(requests[1].messages.at(-1).content,'连续回车只发送一次');
 requests[1].resolve('全文修订追问回答 $S(u,v)=-\\lVert u-v\\rVert_2$。');await until(()=>jobs.get(node.id)?.status==='saved','follow-up replacement');await sync();const replaced=store.getSession(node.id).messages.at(-1);assert.equal(replaced.id,answer.id);assert.equal(replaced.createdAt,answer.createdAt);assert.equal(store.getSession(node.id).messages.length,2);assert.ok(await article.locator('.message.assistant .katex').count());pass('A follow-up full-text action repeats its original question and replaces that answer without duplicating the conversation');
 await article.locator('.message.assistant [data-action=full-text]').click();await until(()=>requests.length===3,'failed full-text request');requests[2].reject(Error(l10n.t('contextTooLong')));await until(()=>jobs.get(node.id)?.status==='error','full-text error');await sync();assert.deepEqual(store.getSession(node.id).messages.at(-1),replaced);assert.ok((await article.locator('.job-error').textContent()).includes('已有答案已保留'));assert.equal((await icon(send)).state,'send');pass('Context-limit failures display a safe error, retain the existing answer and restore Send');
 await article.locator('.answer-actions [data-action=full-text]').click();await until(()=>requests.length===4,'cancelled full-text request');const prior=store.getSession(node.id).explanation;await floatSend.click();await until(()=>jobs.get(node.id)?.cancelled,'cross-surface full-text cancellation');requests[3].resolve('{"summary":"迟到的覆盖","detail":"不应保存"}');await new Promise(r=>setImmediate(r));await store.flush();await sync();assert.deepEqual(store.getSession(node.id).explanation,prior);assert.equal(await field.inputValue(),'生成时继续写的草稿');pass('Stop in the floating view cancels full-text regeneration; late results cannot overwrite the retained answer');
 l10n.setLocale('en-US');await sync();assert.equal(await send.getAttribute('aria-label'),'Send');assert.equal(await article.locator('.answer-actions button').textContent(),'Answer again with full paper');pass('Composer and full-text action labels follow the selected interface language');
 await page.screenshot({path:join(artifact,'composer-full-text.png'),fullPage:true});await floating.screenshot({path:join(artifact,'floating-composer.png')});
 assert.deepEqual(errors,[]);await writeFile(join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));console.log(JSON.stringify({artifact,passed:checks.length,checks}));
}catch(error){await writeFile(join(artifact,'failed.json'),JSON.stringify({message:String(error),stack:error.stack,checks,errors},null,2));throw error;}
finally{closing=true;await browser?.close();await new Promise(r=>server.close(r));}
