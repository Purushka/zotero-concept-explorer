import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {KnowledgeTreeStore} from '../src/knowledge-tree-store.mjs';
import {createNodeStorage} from './helpers/node-storage.mjs';
import {resolveLocale} from '../src/localization.mjs';
const require=createRequire(import.meta.url);
const {chromium,launchOptions}=require('./helpers/browser.cjs');
const root=resolve(import.meta.dirname,'..');await mkdir(join(root,'.test-artifacts'),{recursive:true});
const artifact=await mkdtemp(join(root,'.test-artifacts','ui-language-'));
const store=await KnowledgeTreeStore.open(createNodeStorage(artifact));
const doc=await store.registerDocument({libraryId:1,itemKey:'LANG0001',attachmentKey:'LANGPDF1',title:'原论文标题 — unchanged'});
const node=await store.createSession({documentId:doc.id,concept:'后验分布',explanation:{summary:'已保存的中文解释 [[贝叶斯推断]]。',detail:'## 原文内容\n\nSaved answer with $x^2$.'}});
await store.saveSessionView(node.id,{draft:'原有追问草稿'});
await store.appendMessage(node.id,{role:'user',content:'原有问题'});await store.appendMessage(node.id,{role:'assistant',content:'原有回答'});
await store.openSession(node.id,'page');await store.openSession(node.id,'floating');
let hostLocale='en-GB',failSave=false,modelCalls=0;
let config={language:'auto',locale:'en-US',protocol:'chat',baseURL:'',model:'',hasKey:false,archivePath:'synthetic/knowledge-tree.json',version:'0.2.8'};
const state=()=>({archive:store.snapshot(),jobs:[],startupError:'',language:config.language,locale:config.locale,version:config.version});
const original=store.snapshot(),pages=[],errors=[],checks=[];
const pass=message=>checks.push(message);
const server=createServer(async(req,res)=>{
  const base=join(root,'dist','addon','content'),file=join(base,decodeURIComponent(req.url.split('?')[0])==='/'?'panel.html':decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(base+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.woff2?$/.test(file)?'font/woff2':'application/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const publish=()=>Promise.all(pages.map(page=>page.evaluate(value=>window.ConceptPanel.update(value),state())));
try{
  browser=await chromium.launch(launchOptions);
  for(const surface of ['tab','floating']){
    const page=await browser.newPage({viewport:surface==='tab'?{width:1200,height:860}:{width:440,height:610}});pages.push(page);
    page.on('pageerror',error=>errors.push(error.message));
    await page.exposeFunction('rpc',async(action,args)=>{
      if(action==='state')return state();
      if(action==='settings')return config;
      if(action==='saveLanguage'){
        if(failSave){failSave=false;throw Error('Synthetic preference write failure');}
        config={...config,language:args[0],locale:resolveLocale(args[0],hostLocale)};
        await publish();return {language:config.language,locale:config.locale};
      }
      if(action==='mutate'){await store[args[0]](...(args[1]??[]));await publish();return state();}
      if(action==='probe' || action==='ask'){modelCalls++;throw Error('Unexpected model request');}
      throw Error('Unexpected action: '+action);
    });
    await page.addInitScript(()=>{const call=(action,...args)=>window.rpc(action,args);window.ConceptBridge={state:()=>call('state'),settings:()=>call('settings'),saveLanguage:value=>call('saveLanguage',value),mutate:(...args)=>call('mutate',...args),probe:()=>call('probe'),ask:(...args)=>call('ask',...args),presentation(){},isVisible:()=>true,dismiss:async()=>{}};});
    await page.goto('http://127.0.0.1:'+server.address().port+'/');
    await page.evaluate(surface=>window.ConceptPanel.init('reading',{surface}),surface);
    assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
    assert.equal(await page.locator('.brand-mark,.empty-icon').count(),0);
  }
  const [page,floating]=pages;
  assert.equal(await page.locator('.app-header [data-action=settings]').textContent(),'Settings');
  assert.equal(await floating.locator('.session-actions [data-action=expand]').textContent(),'Expand in tab ↗');
  assert.equal(await page.locator('#page-slot textarea').inputValue(),'原有追问草稿');
  pass('Automatic English follows Zotero; both surfaces remove logos and translate cached session controls');
  await page.locator('.app-header [data-action=settings]').click();await page.waitForSelector('#settings:not([hidden])');
  assert.equal(await page.locator('#language-select').inputValue(),'auto');
  await page.locator('[name=baseURL]').fill('https://unsaved.example/v1');await page.locator('[name=model]').fill('unsaved-model');await page.locator('[name=key]').fill('UNSAVED-DUMMY-KEY');
  await page.locator('#language-select').selectOption('zh-TW');await page.waitForFunction(()=>document.documentElement.lang==='zh-TW' && !document.querySelector('#language-select').disabled);
  assert.equal(await page.locator('#settings-title').textContent(),'使用你的模型與轉接服務');
  assert.equal(await floating.locator('.app-header [data-action=settings]').textContent(),'設定');
  assert.equal(await page.locator('[name=key]').inputValue(),'UNSAVED-DUMMY-KEY');
  assert.equal(await page.locator('[name=baseURL]').inputValue(),'https://unsaved.example/v1');
  assert.equal(await page.locator('[name=model]').inputValue(),'unsaved-model');
  assert.equal(config.hasKey,false);assert.equal(config.baseURL,'');
  assert.deepEqual(store.snapshot(),original);assert.equal(modelCalls,0);
  pass('Traditional Chinese switches immediately without saving model inputs, clearing unsaved keys, writing the archive, or calling a model');
  await page.screenshot({path:join(artifact,'settings-zh-TW.png')});
  await page.locator('#language-select').selectOption('en-US');await page.waitForFunction(()=>document.documentElement.lang==='en-US' && !document.querySelector('#language-select').disabled);
  assert.equal(await page.locator('label[for=language-select] span').textContent(),'Language');
  assert.equal(await page.locator('.privacy').textContent().then(text=>/\p{Script=Han}/u.test(text)),false);
  await page.screenshot({path:join(artifact,'settings-en-US.png')});
  await floating.screenshot({path:join(artifact,'floating-en-US.png')});
  await page.reload();await page.evaluate(()=>window.ConceptPanel.init('settings',{surface:'tab'}));
  assert.equal(await page.locator('#language-select').inputValue(),'en-US');assert.equal(await page.locator('html').getAttribute('lang'),'en-US');
  pass('Saved English choice restores when a panel is reopened; settings help and floating controls are translated');
  failSave=true;await page.locator('#language-select').selectOption('zh-CN');
  await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Synthetic preference write failure') && !document.querySelector('#language-select').disabled);
  assert.equal(await page.locator('#language-select').inputValue(),'en-US');assert.equal(await page.locator('html').getAttribute('lang'),'en-US');assert.equal(config.language,'en-US');
  pass('Preference write failure keeps the saved language and restores the selector');
  hostLocale='zh-CN';await page.locator('#language-select').selectOption('auto');await page.waitForFunction(()=>document.documentElement.lang==='zh-CN' && !document.querySelector('#language-select').disabled);
  assert.equal(await floating.locator('html').getAttribute('lang'),'zh-CN');
  assert.equal(await floating.locator('#floating-slot textarea').inputValue(),'原有追问草稿');
  assert.equal((await floating.locator('.answer .summary').textContent()).trim(),'已保存的中文解释 贝叶斯推断。');
  assert.deepEqual(store.snapshot(),original);assert.equal(modelCalls,0);assert.deepEqual(errors,[]);
  pass('Returning to automatic follows Zotero Chinese and retains archived explanations, questions, drafts and both surfaces');
  await writeFile(join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks,errors,modelCalls},null,2));
  console.log(JSON.stringify({artifact,passed:checks.length,checks}));
}catch(error){await writeFile(join(artifact,'failed.json'),JSON.stringify({error:String(error),stack:error.stack,checks,errors},null,2));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
