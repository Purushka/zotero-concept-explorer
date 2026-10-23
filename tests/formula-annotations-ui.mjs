import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';
import {formulaText} from './fixtures/formulas.mjs';
const {chromium,launchOptions}=createRequire(import.meta.url)('./helpers/browser.cjs');
const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'.test-artifacts'),{recursive:true});const artifact=await mkdtemp(join(root,'.test-artifacts','formula-annotations-ui-'));
const store=await KnowledgeTreeStore.open(createNodeStorage(artifact));
const doc=await store.registerDocument({libraryId:1,itemKey:'FORM0001',attachmentKey:'MATHPDF1',title:'R3M: A Universal Visual Representation for Robot Manipulation'});
const node=await store.createSession({documentId:doc.id,concept:formulaText,source:{selectedText:formulaText},explanation:{summary:'编码器 \\(z=F_{\\phi}(I)\\) 与 $S(u,v)=-\\lVert u-v\\rVert_2$。',detail:formulaText+'\n\n<script>window.formulaXSS=true</script>'}});
await store.saveSessionView(node.id,{draft:formulaText});await store.openSession(node.id,'page');
const state=()=>({archive:store.snapshot(),jobs:[],locale:'zh-CN',startupError:''});const checks=[],errors=[];let asks=0;
const server=createServer(async(req,res)=>{
 const pathname=decodeURIComponent(req.url.split('?')[0]),base=join(root,'dist','addon','content');
 const file=pathname==='/watcher.mjs'?join(root,'src','reader-annotations.mjs'):join(base,pathname==='/'?'panel.html':pathname);
 if(pathname!=='/watcher.mjs' && !file.startsWith(base+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.woff2?$/.test(file)?'font/woff2':'application/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch(launchOptions);const page=await browser.newPage({viewport:{width:1240,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.exposeFunction('rpc',async(action,args)=>{
  if(action==='state')return state();if(action==='settings')return {language:'zh-CN',locale:'zh-CN',version:'0.2.9',protocol:'chat',hasKey:false};
  if(action==='mutate')await store[args[0]](...args[1]);
  if(action==='ask'){asks++;await store.appendMessage(args[0],{role:'user',content:args[1]});await store.saveSessionView(args[0],{draft:''});await store.appendMessage(args[0],{role:'assistant',content:'模型的公式回答：\n\n'+formulaText});}
  return state();
 });
 await page.addInitScript(()=>{const call=async(action,...args)=>{const value=await window.rpc(action,args);if(value?.archive && action!=='state')await window.ConceptPanel.update(value);return value;};window.ConceptBridge={state:()=>call('state'),settings:()=>call('settings'),mutate:(...args)=>call('mutate',...args),ask:(...args)=>call('ask',...args),presentation:()=>{},navigateOriginal:async()=>{},dismiss:async()=>{}};});
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.evaluate(()=>window.ConceptPanel.init('reading',{surface:'tab'}));await page.evaluate(()=>document.fonts.ready);
 const inspect=async selector=>{
  const value=await page.locator(selector).first().evaluate(el=>{const formula=el.querySelector('.katex-display .katex-html'),frac=formula?.querySelector('.mfrac'),sum=formula?.querySelector('.op-symbol'),scripts=formula?.querySelector('.msupsub');return {formula:!!formula,frac:!!frac,sum:!!sum,scripts:!!scripts,w:formula?.getBoundingClientRect().width,h:formula?.getBoundingClientRect().height,errors:el.querySelectorAll('.katex-error,.math-error,.math-token').length,mathml:!!el.querySelector('math mfrac')};});
  assert.ok(value.formula && value.frac && value.sum && value.scripts && value.mathml && value.w>100 && value.h>30 && value.errors===0,selector+': '+JSON.stringify(value));
 };
 for(const selector of ['#page-slot .detail','#page-slot .source-content','#page-slot .composer-preview'])await inspect(selector);
 assert.ok(await page.locator('#page-slot .summary .katex').count()>=2);assert.equal(await page.locator('#page-slot h1').textContent(),'选段解释');assert.equal(await page.evaluate(()=>window.formulaXSS),undefined);checks.push('InfoNCE fractions, sums, subscripts and superscripts render in answers, source and draft preview; bracket delimiters and inert HTML supported');
 await page.screenshot({path:join(artifact,'formula-source-and-answer.png'),fullPage:true});
 await page.locator('#page-slot textarea').fill('请说明这个输入公式：\n\n'+formulaText);await inspect('#page-slot .composer-preview');await page.locator('#page-slot textarea').press('Control+Enter');await page.waitForSelector('#page-slot .message.assistant');
 await inspect('#page-slot .message.user');await inspect('#page-slot .message.assistant');assert.equal(asks,1);assert.equal(await page.locator('#page-slot textarea').inputValue(),'');assert.equal(await page.locator('#page-slot .composer-preview').isVisible(),false);checks.push('User input and model follow-up retain exact TeX and visible layout, send once and clear preview');
 await page.locator('#page-slot .messages').scrollIntoViewIfNeeded();await page.screenshot({path:join(artifact,'formula-conversation.png'),fullPage:true});
 await page.setViewportSize({width:440,height:780});await page.evaluate(()=>window.ConceptPanel.init('reading',{surface:'floating'}));await inspect('#floating-slot .message.user');await inspect('#floating-slot .message.assistant');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2));checks.push('Long formulas scroll inside the narrow floating view without overflowing the window');
 const watcherResult=await page.evaluate(async()=>{
  const {watchReaderAnnotations}=await import('/watcher.mjs');
  const frame=document.createElement('iframe');document.body.append(frame);const doc=frame.contentDocument,reader={_internalReader:{_state:{selectedAnnotationIDs:[]}}},opened=[],failures=[];let disposed=0;
  const cleanup=watchReaderAnnotations(reader,doc,{onOpen:key=>opened.push(key),onError:e=>failures.push(String(e)),onDispose:()=>disposed++});
  const delay=()=>new Promise(r=>setTimeout(r,30));
  const click=(el,opts={})=>{const w=el.ownerDocument.defaultView ?? frame.contentWindow;el.dispatchEvent(new w.MouseEvent('mousedown',{bubbles:true,button:0,...opts}));el.dispatchEvent(new w.MouseEvent('click',{bubbles:true,button:0,...opts}));};
  const span=doc.createElement('span');span.dataset.annotationId='ROOT';span.textContent='Saved highlight';doc.body.append(span);click(span);await delay();
  click(span,{ctrlKey:true});const button=doc.createElement('button');span.append(button);click(button);await delay();
  span.dispatchEvent(new frame.contentWindow.MouseEvent('mousedown',{bubbles:true,clientX:0}));span.dispatchEvent(new frame.contentWindow.MouseEvent('mousemove',{bubbles:true,clientX:30}));span.dispatchEvent(new frame.contentWindow.MouseEvent('click',{bubbles:true,button:0,clientX:30}));await delay();
  const canvas=doc.createElement('canvas');doc.body.append(canvas);reader._internalReader._state.selectedAnnotationIDs=['CANVAS'];click(canvas);await delay();
  const split=doc.createElement('iframe');doc.body.append(split);await delay();const nested=split.contentDocument.createElement('span');nested.dataset.sidebarAnnotationId='SPLIT';split.contentDocument.body.append(nested);click(nested);await delay();
  split.remove();await delay();click(nested);await delay();
  frame.contentWindow.dispatchEvent(new frame.contentWindow.Event('unload'));click(span);await delay();cleanup();frame.remove();return {opened,failures,disposed};
 });
 assert.deepEqual(watcherResult,{opened:['ROOT','CANVAS','SPLIT'],failures:[],disposed:1});checks.push('Highlight click, PDF canvas fallback, split-view frame attach/detach, drag/button/modifier filtering and root unload cleanup verified');
 assert.deepEqual(errors,[]);await writeFile(join(artifact,'result.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({artifact,checks},null,2));
}catch(e){console.error('Artifacts: '+artifact);throw e;}finally{await browser?.close();await new Promise(r=>server.close(r));}
