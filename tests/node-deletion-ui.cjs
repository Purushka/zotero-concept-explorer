const {chromium,launchOptions}=require('./helpers/browser.cjs');
const {createServer}=require('node:http');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
  const root=path.resolve(__dirname,'..'),{KnowledgeTreeStore,validateArchive}=await import('../src/knowledge-tree-store.mjs');
  const {createNodeStorage}=await import('./helpers/node-storage.mjs');
  const {deleteSessionWithConfirmation,confirmSessionDeletion}=await import('../src/session-deletion.mjs');
  const artifact=await fs.mkdtemp(path.join(root,'.test-artifacts','ui-deletion-')),disk=createNodeStorage(artifact);
  let failNext=false,choice=2;const prompts=[],errors=[],checks=[],pages=[],jobs=new Map();
  const storage={...disk,write:async(...args)=>{if(failNext){failNext=false;throw Error('Synthetic disk full');}return disk.write(...args);}};
  let store=await KnowledgeTreeStore.open(storage);
  const doc=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'删除功能合成测试论文'});
  const add=(concept,parentId=null)=>store.createSession({documentId:doc.id,parentId,concept,explanation:{summary:'合成解释，保留公式 $x^2$。',detail:'## 详细解释\n\n子节点解释与追问应独立保留。'}});
  const parent=await add('根概念'),branch=await add('可删除分支',parent.id),child=await add('保留子概念',branch.id),grandchild=await add('多级后代',child.id),sibling=await add('独立兄弟概念',parent.id);
  await store.saveSessionView(child.id,{draft:'不丢失的子节点草稿',scrollTop:0});
  await store.appendMessage(child.id,{role:'assistant',content:'独立子节点回答'});
  await store.openSession(branch.id,'page');await store.openSession(grandchild.id,'floating');await store.showKnowledgeTree(branch.id);
  const state=()=>({archive:store.snapshot(),jobs:[...jobs].map(([nodeId,job])=>({nodeId,...job,cancel:undefined})),startupError:''});
  const publish=async()=>{const value=state();await Promise.all(pages.map(page=>page.evaluate(value=>window.ConceptPanel.update(value),value)));};
  const server=createServer(async(req,res)=>{const relative=decodeURIComponent(req.url.split('?')[0]),base=path.join(root,'dist','addon','content'),file=path.join(base,relative==='/'?'panel.html':relative);
    if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
    try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':/\.woff2?$/.test(file)?'font/woff2':'application/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('Timed out: '+label);};
  const pass=name=>checks.push(name);
  try{
    browser=await chromium.launch(launchOptions);
    async function surface(name,viewport){
      const page=await browser.newPage({viewport});pages.push(page);page.on('pageerror',error=>errors.push(error.message));
      await page.exposeFunction('rpc',async(action,args)=>{
        if(action==='state')return state();
        if(action==='deleteSession'){
          const result=await deleteSessionWithConfirmation({store,nodeId:args[0],jobs,confirm:plan=>confirmSessionDeletion({Prompt:{BUTTON_TITLE_CANCEL:2,confirm:options=>{prompts.push(options);return choice;}}},null,plan)});
          if(result)await publish();return result;
        }
        if(action==='mutate'){
          try{await store[args[0]](...(args[1]??[]));}catch(error){if(args[0]!=='saveSessionView' || store.snapshot().nodes.some(n=>n.id===args[1][0]))throw error;}
          await publish();return state();
        }
        throw Error('Unexpected RPC: '+action);
      });
      await page.addInitScript(()=>{window.ConceptBridge={state:()=>window.rpc('state',[]),mutate:(...args)=>window.rpc('mutate',args),deleteSession:id=>window.rpc('deleteSession',[id]),presentation:()=>{},isVisible:()=>true};});
      await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.evaluate(surface=>window.ConceptPanel.init('reading',{surface}),name);return page;
    }
    const page=await surface('tab',{width:1200,height:850}),floating=await surface('floating',{width:440,height:610});
    assert.equal(await page.locator('#tree .tree-delete').count(),5);assert.equal(await page.locator('#tree .tree-node').count(),5);
    assert.equal(await page.locator('#tree .tree-delete').first().getAttribute('aria-label'),'删除节点：根概念');pass('每个知识树节点有独立、可键盘访问的删除按钮');
    assert.equal(await floating.locator('#floating-slot [data-action=delete-node]').isVisible(),true);assert.equal(await page.locator('#page-slot [data-action=delete-node]').isVisible(),true);pass('标签页和浮窗均提供删除入口，关闭与删除保持区分');
    await page.waitForTimeout(450);await Promise.all(pages.map(p=>p.evaluate(()=>window.ConceptPanel.flushViews())));
    const before=store.snapshot(),promptCount=prompts.length;
    await page.locator(`#tree .tree-delete[data-id="${branch.id}"]`).click();await wait(()=>prompts.length===promptCount+1,'cancel prompt');
    await wait(()=>page.locator(`#tree .tree-delete[data-id="${branch.id}"]`).isEnabled(),'cancel re-enable');
    assert.deepEqual(store.snapshot(),before);assert.equal(prompts.at(-1).defaultButton,2);assert(prompts.at(-1).text.includes('共删除 3 个节点'));pass('取消删除不改变节点、页面、浮窗和持久化存档');
    // A failed disk transaction must leave the branch and visible surfaces intact.
    failNext=true;choice=1;await page.locator(`#tree .tree-delete[data-id="${branch.id}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Synthetic disk full'));
    assert.deepEqual(store.snapshot(),before);assert.equal(await floating.locator('#floating-slot h1').textContent(),'多级后代');pass('删除写入失败显示提示，不丢失树或大小窗');
    choice=0;const preserved=store.getSession(child.id);
    await page.locator(`#tree .tree-delete[data-id="${branch.id}"]`).click();await wait(()=>!store.snapshot().nodes.some(n=>n.id===branch.id),'node-only deletion');
    await page.waitForFunction(()=>!document.querySelector('#tree .tree-delete[title="删除节点：可删除分支"]'));
    const promoted=store.getSession(child.id);assert.deepEqual({...promoted,parentId:preserved.parentId,updatedAt:preserved.updatedAt},preserved);assert.equal(promoted.parentId,parent.id);
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'多级后代');assert.equal(await page.locator('#retained button').count(),4);pass('仅删除节点将子节点上移，保留子解释、草稿、追问和浮窗');
    assert.equal(await page.locator(`[data-node-id="${branch.id}"]`).count(),0);pass('所有已打开页面和树选择均移除被删除节点');
    await store.resumeReading();await store.openSession(child.id,'page');await store.openSession(grandchild.id,'floating');await publish();
    await floating.locator('textarea').fill('即将删除节点的未保存草稿');
    // Remote deletion arrives before the other surface flushes its queued draft.
    choice=1;await page.locator('#page-slot [data-action=delete-node]').click();await wait(()=>!store.snapshot().nodes.some(n=>n.id===child.id),'subtree deletion');
    await page.waitForFunction(()=>document.querySelector('#page-slot h1')?.textContent==='根概念');await floating.waitForFunction(()=>!document.querySelector('#floating-slot article'));
    await floating.waitForTimeout(450);await floating.evaluate(()=>window.ConceptPanel.flushViews());
    assert.equal(await page.locator('#retained button').count(),2);assert.equal(await page.locator(`[data-node-id="${child.id}"]`).count(),0);assert.equal(await floating.locator(`[data-node-id="${grandchild.id}"]`).count(),0);
    assert.equal(await floating.locator('#notice').isVisible(),false);validateArchive(store.snapshot());pass('删除整条分支同步清理双表面，延迟草稿保存不会复活节点或报错');
    assert.equal(store.getSession(sibling.id).concept,'独立兄弟概念');pass('兄弟分支不受其他分支删除影响');
    await page.screenshot({path:path.join(artifact,'01-tree-after-deletion.png')});
    const after=store.snapshot();store=await KnowledgeTreeStore.open(storage);await page.reload();await page.evaluate(()=>window.ConceptPanel.init('reading',{surface:'tab'}));
    assert.deepEqual(store.snapshot(),after);assert.equal(await page.locator('#tree .tree-delete').count(),2);pass('重新打开后从磁盘恢复删除结果，不恢复已删除页面');
    // Leaf deletion from the persistent floating surface.
    await store.openSession(sibling.id,'floating');await publish();choice=0;
    await floating.locator('#floating-slot [data-action=delete-node]').click();await wait(()=>!store.snapshot().nodes.some(n=>n.id===sibling.id),'leaf deletion');
    assert.equal(prompts.at(-1).defaultButton,1);await floating.waitForFunction(()=>!document.querySelector('#floating-slot article'));pass('浮窗直接删除叶节点使用取消默认的确认并同步清理');
    await store.showKnowledgeTree(parent.id);await publish();await page.locator(`#tree .tree-delete[data-id="${parent.id}"]`).focus();await page.keyboard.press('Enter');await wait(()=>store.snapshot().nodes.length===0,'keyboard leaf delete');
    await page.waitForFunction(()=>!document.querySelector('#empty').hidden);assert.equal(await page.locator('#tree .tree-doc').count(),1);pass('键盘可删除节点，空知识树保留论文分组和可用页面');
    assert.deepEqual(errors,[]);pass('删除交互无浏览器脚本异常');
    await fs.writeFile(path.join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks,artifact,model:'no network/model calls'},null,2));console.log(JSON.stringify({passed:checks.length,checks,artifact}));
  }catch(error){await fs.writeFile(path.join(artifact,'failed.json'),JSON.stringify({message:error.message,stack:error.stack,checks,errors},null,2));throw error;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
