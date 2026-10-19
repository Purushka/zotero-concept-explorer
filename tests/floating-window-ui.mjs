import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';
const require=createRequire(import.meta.url);
const {chromium,launchOptions}=require('./helpers/browser.cjs');
const root=resolve(import.meta.dirname,'..');
await mkdir(join(root,'.test-artifacts'),{recursive:true});
const artifact=await mkdtemp(join(root,'.test-artifacts','ui-floating-'));
const store=await KnowledgeTreeStore.open(createNodeStorage(artifact));
const doc=await store.registerDocument({libraryId:1,itemKey:'FLOAT001',attachmentKey:'FLOATPDF',title:'浮窗拖动合成测试论文'});
await store.createSession({documentId:doc.id,concept:'可移动概念',explanation:{summary:'拖动后仍可划词。\n\n'+('这是一段足够长的合成解释，用于检查浮窗滚动、文字选择和草稿是否保留。\n\n'.repeat(20)),detail:'详细解释不应被拖动修改。'}});
const state={archive:store.snapshot(),jobs:[],version:'0.2.7',startupError:''};
const bundle=await build({entryPoints:[join(root,'src/floating-window.mjs')],bundle:true,write:false,format:'esm',platform:'browser',target:'firefox128'});
const host=`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden}#tab-bar-container{height:80px;background:#eee}#float{position:fixed;right:22px;bottom:22px;width:min(440px,calc(100vw - 32px));height:min(610px,calc(100vh - 110px));border:0}</style></head><body><div id="tab-bar-container">原生标签栏仍可点击</div><iframe id="float" src="/panel.html"></iframe><script type="module">
import {createFloatingWindow} from '/floating.js';
const frame=document.querySelector('#float');
await new Promise(resolve=>{if(frame.contentDocument?.readyState==='complete' && frame.contentWindow.ConceptPanel)resolve();else frame.addEventListener('load',resolve,{once:true});});
window.saves=[];window.dismissed=0;window.failSave=false;
frame.contentWindow.ConceptBridge={state:async()=>(${JSON.stringify(state)}),mutate:async()=>(${JSON.stringify(state)}),presentation(){},isVisible:()=>true,dismiss:async()=>{window.dismissed++;}};
await frame.contentWindow.ConceptPanel.init('reading',{surface:'floating'});
window.attach=()=>{window.controller=createFloatingWindow({window,frame,interact:frame.contentWindow.interact,initialPosition:sessionStorage.getItem('floating'),onSave(value){if(window.failSave)throw Error('synthetic preference failure');window.saves.push(value);sessionStorage.setItem('floating',JSON.stringify(value));},onError(error){window.saveError=error.message;}});window.controller.setVisible(true);};
window.attach();window.ready=true;
</script></body></html>`;
const base=join(root,'dist/addon/content');
const server=createServer(async(req,res)=>{
  try {
    const route=new URL(req.url,'http://localhost').pathname;
    if(route==='/'){res.setHeader('Content-Type','text/html');res.end(host);return;}
    if(route==='/floating.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(route==='/panel.html'){res.setHeader('Content-Type','text/html');res.end(await readFile(join(root,'addon/content/panel.html')));return;}
    if(route==='/vendor/interact.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(root,'vendor/interact.js')));return;}
    const file=resolve(base,'.'+decodeURIComponent(route));
    if(!file.startsWith(base+sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.woff2?$/.test(file)?'font/woff2':'text/javascript');
    res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const errors=[],checks=[];let browser;
const pass=label=>checks.push(label);
try {
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1200,height:1400}});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready);
  const rect=()=>page.locator('#float').boundingBox();
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1,`${a} != ${b}`);
  const original=await rect(),panel=page.frameLocator('#float');
  const field=panel.locator('textarea').first();await field.fill('拖动以后仍保留的追问草稿');
  async function drag(left,top,{release=true}={}) {
    const r=await rect(),h=await page.locator('#concept-explorer-drag-handle').boundingBox();
    const x=h.x+Math.min(40,h.width/2),y=h.y+20;
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+left-r.x,y+top-r.y,{steps:15});
    if(release)await page.mouse.up();
  }
  await drag(20,300);let r=await rect();close(r.x,12);close(r.y,300);pass('左侧靠边松手吸附');
  await drag(730,300);r=await rect();close(r.x,748);close(r.y,300);pass('右侧靠边松手吸附');
  await drag(350,110);r=await rect();close(r.x,350);close(r.y,92);pass('顶部吸附避开原生标签栏');
  await drag(350,760);r=await rect();close(r.x,350);close(r.y,778);pass('底部靠边松手吸附');
  await drag(350,350);r=await rect();close(r.x,350);close(r.y,350);pass('远离边缘时可自由停放');
  await drag(20,110,{release:false});r=await rect();close(r.x,20);close(r.y,110);
  await page.mouse.up();r=await rect();close(r.x,12);close(r.y,92);pass('拖动中不吸附，松手同时吸附角落');
  close(r.width,original.width);close(r.height,original.height);
  assert.equal(await field.inputValue(),'拖动以后仍保留的追问草稿');pass('重复拖动不改变窗口尺寸和追问草稿');
  await panel.locator('[data-action=dismiss]').click();assert.equal(await page.evaluate(()=>window.dismissed),1);pass('标题栏导航及关闭按钮不被拖动区域遮挡');
  const paragraph=panel.locator('#floating-slot .summary p').first();
  await paragraph.evaluate(p=>{const selection=getSelection(),range=document.createRange();range.selectNodeContents(p);selection.removeAllRanges();selection.addRange(range);});
  await panel.locator('#explanation-selection').waitFor({state:'visible'});pass('正文划词入口仍可用');
  const scroll=panel.locator('#floating-slot .session-body');
  const scrolled=await scroll.evaluate(el=>{el.scrollTop=90;return el.scrollTop;});
  assert.ok(scrolled>0,'The real explanation body must be scrollable');
  await drag(350,300);assert.equal(await scroll.evaluate(el=>el.scrollTop),scrolled);
  await drag(20,110);pass('拖动不重建正文，保留实际滚动位置');
  const count=await page.evaluate(()=>window.saves.length);
  await drag(350,300,{release:false});await page.keyboard.press('Escape');await page.mouse.up();r=await rect();close(r.x,12);close(r.y,92);
  assert.equal(await page.evaluate(()=>window.saves.length),count);pass('Escape取消拖动且不覆盖保存的位置');
  await drag(730,760);r=await rect();close(r.x,748);close(r.y,778);
  await page.reload();await page.waitForFunction(()=>window.ready);r=await rect();close(r.x,748);close(r.y,778);pass('重新打开恢复上次位置及贴边状态');
  await page.setViewportSize({width:700,height:500});
  await page.waitForFunction(()=>{const r=document.querySelector('#float').getBoundingClientRect();return Math.abs(r.right-688)<1 && Math.abs(r.bottom-488)<1;});
  r=await rect();close(r.x+r.width,688);close(r.y+r.height,488);assert.ok(r.y>=92);pass('缩小宿主窗口仍贴边，标题栏不越界');
  await page.evaluate(()=>{document.querySelector('#float').style.display='none';window.controller.setVisible(false);});
  assert.equal(await page.locator('#concept-explorer-drag-handle').isVisible(),false);pass('浮窗隐藏时拖动层同步隐藏，不拦截论文点击');
  await page.evaluate(()=>{document.querySelector('#float').style.display='';window.controller.setVisible(true);});
  const h=page.locator('#concept-explorer-drag-handle');await h.focus();await page.keyboard.press('ArrowLeft');
  assert.ok(await page.evaluate(()=>window.saves.length)>0);pass('标题栏支持方向键移动');
  await page.evaluate(()=>{window.failSave=true;});await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(()=>window.saveError),'synthetic preference failure');pass('位置保存失败显示错误，但不影响解释和知识树');
  await page.screenshot({path:join(artifact,'floating.png')});
  await page.evaluate(()=>window.controller.dispose());assert.equal(await h.count(),0);pass('卸载后清理拖动层、交互实例和事件监听');
  assert.deepEqual(errors,[]);
  await writeFile(join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks,errors},null,2));
  console.log(JSON.stringify({artifact,passed:checks.length,checks}));
} catch(error) {
  await writeFile(join(artifact,'failed.json'),JSON.stringify({message:String(error),stack:error.stack,checks,errors},null,2));throw error;
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
