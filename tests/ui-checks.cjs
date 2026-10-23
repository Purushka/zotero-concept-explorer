const {chromium,launchOptions}=require('./helpers/browser.cjs');
const {createServer}=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
(async () => {
  const root=path.resolve(__dirname,'..');
  const {KnowledgeTreeStore}=await import('../src/knowledge-tree-store.mjs');
  const {createNodeStorage}=await import('./helpers/node-storage.mjs');
  const artifact=await fs.mkdtemp(path.join(root,'.test-artifacts','ui-'));
  let store=await KnowledgeTreeStore.open(createNodeStorage(artifact));
  const doc=await store.registerDocument({libraryId:1,itemKey:'PAPER001',attachmentKey:'PDF00001',title:'测试论文 · 递归概念阅读'});
  const long='## 详细解释\n\n'+Array.from({length:35},(_,i) => `第 ${i+1} 段：结合论文讨论这个概念的原理和适用条件。`).join('\n\n');
  const parent=await store.createSession({documentId:doc.id,concept:'后验分布',explanation:{summary:'它是看到数据后，对未知量的更新认识。可继续理解 [[贝叶斯推断]]。',detail:long+'\n\n先理解 [[贝叶斯推断]]。'}});
  let config={protocol:'chat',baseURL:'https://relay.example/v1',model:'example-model',hasKey:false,archivePath:path.join(artifact,'knowledge-tree.json'),version:'test'};
  let jobs=[];
  const state=() => ({archive:store.snapshot(),jobs, startupError:''});
  const server=createServer(async(req,res) => {
    const rel=decodeURIComponent(req.url.split('?')[0]);
    const file=path.join(root,'dist','addon','content',rel === '/' ? 'panel.html' : rel);
    if (!file.startsWith(path.join(root,'dist','addon','content')+path.sep)) { res.writeHead(403).end();return; }
    try { res.setHeader('Content-Type',file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : /\.woff2?$/.test(file) ? 'font/'+(file.endsWith('.woff2')?'woff2':'woff') : 'application/javascript');res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;const pages=[];
  const checks=[];
  const wait=async(condition,label)=>{for(let i=0;i<200;i++){if(await condition())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+label);};
  try {
    browser=await chromium.launch(launchOptions);
    const page=await browser.newPage({viewport:{width:1200,height:860}}),errors=[];
    page.on('pageerror',error => errors.push(error.message));
    await page.exposeFunction('rpc',async(action,args) => {
      if (action === 'state') return state();
      if (action === 'settings') return config;
      if (action === 'saveSettings') { config={...config,...args[0],hasKey:args[0].clearKey ? false : (!!args[0].key || config.hasKey)};delete config.key;return config; }
      if (action === 'mutate') await store[args[0]](...(args[1] ?? []));
      if (action === 'child') {
        const existing=store.snapshot().nodes.find(n => n.parentId === args[0] && n.concept === args[1]);
        if (existing) await store.openSession(existing.id,'floating');
        else await store.createSession({documentId:doc.id,parentId:args[0],concept:args[1],source:{context:args[2]},explanation:{summary:'这是子概念的简述，可以理解 [[条件概率]]。',detail:long+'\n\n关联 [[条件概率]]。'}});
      }
      if (action === 'ask') { await store.appendMessage(args[0],{role:'user',content:args[1]});await store.saveSessionView(args[0],{draft:''});await store.appendMessage(args[0],{role:'assistant',content:'已结合该概念解释。'}); }
      if (action === 'probe') return '连接成功（模拟响应）';
      return state();
    });
    await page.addInitScript(() => {
      const call=async(name,...args) => { const value=await window.rpc(name,args); if (value?.archive && name !== 'state') await window.ConceptPanel.update(value);return value; };
      window.ConceptBridge={state:() => call('state'),settings:() => call('settings'),saveSettings:v => call('saveSettings',v),mutate:(...v) => call('mutate',...v),child:(...v) => call('child',...v),ask:(...v) => call('ask',...v),retry:(...v) => call('retry',...v),probe:() => call('probe'),navigateOriginal:async()=>{window.navigatedOriginal=true;},presentation:m => {window.presentation=m;},dismiss:async()=>{window.dismissed=true;}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => window.ConceptPanel.init('reading'));
    const pass=(name) => checks.push(name);
    assert.equal(await page.locator('#floating-slot h1').textContent(),'后验分布');assert.equal(await page.locator('#floating-slot .detail').isVisible(),false);pass('初始简述浮窗');
    await page.screenshot({path:path.join(artifact,'01-floating.png')});
    await page.locator('#floating-slot [data-action=expand]').click();await page.waitForFunction(() => document.querySelector('#page-slot h1')?.textContent === '后验分布');
    assert.equal(await page.locator('#page-slot .detail').isVisible(),true);pass('展开成详细页面');
    await page.locator('#page-slot .summary [data-concept]').click();await page.waitForFunction(() => document.querySelector('#floating-slot h1')?.textContent === '贝叶斯推断');
    const child=store.snapshot().nodes.find(n => n.parentId === parent.id);
    assert.equal(store.snapshot().workspace.pageNodeId,parent.id);pass('子浮窗自动保留展开的父页面');
    const childInput=page.locator('#floating-slot textarea');await childInput.fill('子节点独立草稿');
    await page.locator('#floating-slot [data-action=parent]').click();await wait(()=>store.getSession(child.id).view.draft==='子节点独立草稿','parent navigation flushes child draft');
    assert.equal(store.getSession(child.id).view.draft,'子节点独立草稿');assert.equal(store.snapshot().nodes.length,2);assert.equal(await page.locator('#floating-slot h1').textContent(),'贝叶斯推断');pass('返回父页同时保留子浮窗、页面和草稿');
    await page.locator(`#retained [data-id="${child.id}"]`).click();await page.waitForFunction(() => document.querySelector('#page-slot h1')?.textContent === '贝叶斯推断');
    assert.equal(await page.locator('#page-slot textarea').inputValue(),'子节点独立草稿');pass('恢复保留页和独立草稿');
    await page.locator('#page-slot textarea').fill('');
    // An in-flight refresh must not resurrect a cleared draft.
    await page.evaluate(async()=>window.ConceptPanel.update(await window.ConceptBridge.state()));assert.equal(await page.locator('#page-slot textarea').inputValue(),'');
    await page.locator('#page-slot textarea').fill('追问这个概念');await page.locator('#page-slot textarea').press('Control+Enter');await page.waitForFunction(() => document.querySelector('.message.assistant'));
    assert.equal(await page.locator('#page-slot textarea').inputValue(),'');assert.equal(store.getSession(child.id).view.draft,'');
    assert.equal(store.getSession(child.id).messages.length,2);pass('追问独立保存且清空草稿');
    await page.locator('#page-slot .summary [data-concept]').click();await page.waitForFunction(() => document.querySelector('#floating-slot h1')?.textContent === '条件概率');
    const grandchild=store.snapshot().nodes.find(n => n.parentId === child.id);assert.ok(grandchild);pass('第三级解释与层级');
    await page.screenshot({path:path.join(artifact,'02-nested.png')});
    const reading=store.snapshot().workspace;
    await page.locator('.app-header [data-action=knowledge]').click();await page.waitForFunction(() => !document.body.classList.contains('standalone') && !document.querySelector('#floating-slot article'));
    await page.locator(`#tree .tree-node[data-id="${parent.id}"]`).click();await page.waitForFunction(() => document.querySelector('#page-slot h1')?.textContent === '后验分布');assert.equal(store.snapshot().nodes.length,3);pass('知识树回看父层保留全部子分支');
    await page.locator('.app-header [data-action=reading]').click();await page.waitForFunction(() => document.querySelector('#floating-slot h1')?.textContent === '条件概率');
    assert.equal(store.snapshot().workspace.pageNodeId,reading.pageNodeId);pass('回看知识树后恢复原阅读现场');
    await page.locator('#floating-slot textarea').fill('重启后仍在');await page.evaluate(() => window.ConceptPanel.flushViews());
    store=await KnowledgeTreeStore.open(createNodeStorage(artifact));await page.reload();await page.evaluate(() => window.ConceptPanel.init('reading'));
    assert.equal(await page.locator('#floating-slot textarea').inputValue(),'重启后仍在');assert.equal(store.snapshot().nodes.length,3);pass('重新打开从磁盘恢复多级树、页面、草稿和追问');
    await page.locator('.app-header [data-action=settings]').click();await page.waitForSelector('#settings:not([hidden])');
    await page.locator('[name=key]').fill('test-key-not-real');await page.locator('#settings-form [type=submit]').click();await page.waitForFunction(() => document.querySelector('[name=key]').value === '');assert.equal(config.hasKey,true);pass('凭据表单保存后不回显 Key');
    await page.locator('[name=protocol]').selectOption('responses');await page.waitForFunction(() => document.querySelector('#endpoint-preview').textContent.includes('/v1/responses'));pass('中转路径预览跟随协议');
    assert.deepEqual(errors,[]);pass('无浏览器脚本异常');

    // Two real documents emulate Zotero's independent tab and floating frames.
    await store.openSession(child.id,'floating');await store.openSession(child.id,'page');
    await page.reload();await page.evaluate(() => window.ConceptPanel.init('reading',{surface:'tab'}));pages.push(page);
    const floating=await browser.newPage({viewport:{width:440,height:610}});pages.push(floating);
    floating.on('pageerror',error=>errors.push(error.message));
    const publish=async()=>{const value=state();await Promise.all(pages.map(p=>p.evaluate(v=>window.ConceptPanel.update(v),value)));};
    await floating.exposeFunction('rpc',async(action,args)=>{
      if(action==='state')return state();
      if(action==='mutate')await store[args[0]](...(args[1]??[]));
      if(action==='child'){
        const found=store.snapshot().nodes.find(n=>n.parentId===args[0]&&n.concept===args[1]);
        if(found)await store.openSession(found.id,'floating');
        else await store.createSession({documentId:doc.id,parentId:args[0],concept:args[1],explanation:{summary:'简述',detail:long}});
      }
      if(action==='cancel'){jobs=jobs.map(j=>j.nodeId===args[0]?{...j,status:'cancelled',error:'已停止；未保存。'}:j);}
      await publish();return state();
    });
    await floating.addInitScript(()=>{
      const call=(name,...args)=>window.rpc(name,args);
      window.ConceptBridge={state:()=>call('state'),mutate:(...v)=>call('mutate',...v),child:(...v)=>call('child',...v),cancel:id=>call('cancel',id),presentation:()=>{},isVisible:()=>true,dismiss:async()=>{window.dismissed=true;}};
    });
    await floating.goto(`http://127.0.0.1:${server.address().port}/`);
    await floating.evaluate(()=>window.ConceptPanel.init('reading',{surface:'floating'}));
    assert.equal(await page.locator('body').getAttribute('class'),'native-tab');
    assert.equal(await page.locator('#page-slot h1').textContent(),'贝叶斯推断');
    assert.equal(await page.locator('#floating-slot article').count(),0);
    assert.equal(await floating.locator('#page-slot article').count(),0);
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'贝叶斯推断');pass('同一会话原生标签与独立浮窗共存，无标签内重复浮窗');
    await page.locator('#page-slot .session-actions [data-action=original]').click();await page.waitForFunction(()=>window.navigatedOriginal);
    assert.equal(await page.evaluate(()=>window.dismissed),undefined);pass('回到论文不关闭标签页或浮窗');
    await page.locator('#page-slot textarea').fill('大小窗保留的草稿');
    await page.evaluate(()=>window.ConceptPanel.flushViews());await publish();
    assert.equal(await floating.locator('textarea').inputValue(),'大小窗保留的草稿');pass('同会话草稿保存后同步到另一个表面');
    // Streaming only changes its own preview; saved body/scroll/draft stay intact.
    await page.locator('#page-slot .session-body').evaluate(el=>el.scrollTop=140);
    await page.evaluate(()=>window.ConceptPanel.flushViews());
    await page.evaluate(()=>window.savedAnswer=document.querySelector('#page-slot .answer').firstElementChild);
    const oldDetail=store.getSession(child.id).explanation.detail;
    jobs=[{nodeId:child.id,status:'loading',kind:'explanation',preview:{summary:'逐段简述 [[条件概率]]。',detail:'## 流式公式\n\n\\[x=\\frac{1}{2}\\]\n\n- 正在生成'},error:''}];
    await publish();
    for(const p of pages){assert.ok(await p.locator('.stream-preview .katex').count()>0);assert.equal(await p.locator('.job-state').textContent(),'');const stop=p.locator('.composer-send[data-state=stop]');assert.equal(await stop.count(),1);assert.equal(await stop.isEnabled(),true);assert.equal(await stop.locator('.stop-square').isVisible(),true);assert.equal(await stop.locator('.send-arrow').isVisible(),false);}
    assert.equal(await page.evaluate(()=>window.savedAnswer===document.querySelector('#page-slot .answer').firstElementChild),true);
    assert.equal(await page.locator('textarea').inputValue(),'大小窗保留的草稿');
    assert.equal(store.getSession(child.id).explanation.detail,oldDetail);pass('两表面同步渲染临时流式 Markdown/公式，旧解释及草稿未覆盖');
    await floating.locator('.composer-send[data-state=stop]').click();await wait(()=>jobs[0].status==='cancelled','cancel update');
    assert.ok(await page.locator('.stream-preview').textContent().then(t=>t.includes('未保存')));
    assert.equal(store.getSession(child.id).explanation.detail,oldDetail);pass('任一表面停止生成，另一表面同步未保存状态');
    // Screenshot-style persisted malformed JSON is recovered without archive writes.
    const bad=String.raw`{"summary":""50 步"是计划，可继续 [[条件概率]]。","detail":"### 它是什么意思\n\n> a joint-space sequence\n\n\[a_t=[a_1,\ldots,a_n]\]\n\n- 继续 [[条件概率]]。"}`;
    await store.setExplanation(child.id,{summary:bad,detail:bad});jobs=[];await publish();
    assert.equal(await page.locator('#page-slot .answer h3').textContent(),'它是什么意思');
    assert.ok(await page.locator('#page-slot .answer blockquote').count()>0);
    assert.ok(await page.locator('#page-slot .answer .katex').count()>0);
    assert.doesNotMatch(await page.locator('#page-slot .answer').textContent(),/"summary"|"detail"/);
    assert.equal(store.getSession(child.id).explanation.detail,bad);pass('截图式旧 JSON 正确显示标题、引用、列表、公式和概念按钮，原存档不改写');
    await page.screenshot({path:path.join(artifact,'03-markdown-math.png')});
    await floating.screenshot({path:path.join(artifact,'04-companion.png')});
    const formula=await page.locator('.katex').first().evaluate(el=>({width:el.getBoundingClientRect().width,font:document.fonts.check('16px KaTeX_Main')}));
    assert.ok(formula.width>30 && formula.font);pass('本地 KaTeX 字体已加载，公式具有实际布局');
    // Child selection from either surface preserves the expanded parent in tab.
    await floating.locator('.summary [data-concept]').click();await floating.waitForFunction(()=>document.querySelector('#floating-slot h1')?.textContent==='条件概率');
    assert.equal(await page.locator('#page-slot h1').textContent(),'贝叶斯推断');
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'条件概率');pass('独立浮窗点击子概念，父标签页保留并同步多级子浮窗');
    await floating.locator('[data-action=expand]').click();await page.waitForFunction(()=>document.querySelector('#page-slot h1')?.textContent==='条件概率');
    assert.equal(await page.locator('#page-slot h1').textContent(),'条件概率');
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'条件概率');pass('子浮窗展开为标签页后，小窗依然存在');
    await floating.locator('[data-action=parent]').click();await page.waitForFunction(()=>document.querySelector('#page-slot h1')?.textContent==='贝叶斯推断');
    assert.equal(await page.locator('#page-slot h1').textContent(),'贝叶斯推断');
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'条件概率');pass('点击父层仍保留子浮窗与子会话');
    await page.evaluate(()=>window.ConceptPanel.visibilityChanged(false));await page.evaluate(()=>window.ConceptPanel.visibilityChanged(true));await publish();
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'条件概率');pass('切出切回保留大小窗阅读现场');
    await store.saveSessionView(child.id,{scrollTop:9876});await publish();await page.waitForTimeout(450);
    await page.evaluate(()=>window.ConceptPanel.flushViews());assert.equal(store.getSession(child.id).view.scrollTop,9876);pass('短页面的滚动钳制不会覆盖持久化位置');
    await page.locator('#page-slot [data-action=shrink]').click();await wait(()=>store.snapshot().workspace.pageNodeId===parent.id,'shrink route');await publish();
    assert.equal(await page.locator('#page-slot h1').textContent(),'后验分布');
    assert.equal(await floating.locator('#floating-slot h1').textContent(),'贝叶斯推断');pass('原生子页缩小后恢复父页和独立子浮窗');
    const selectGenerated=async(p,selector,text)=>{
      await p.evaluate(({selector,text})=>{
        const el=document.querySelector(selector),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node;
        while(node=walker.nextNode()){const start=node.textContent.indexOf(text);if(start<0)continue;const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+text.length);const selected=window.getSelection();selected.removeAllRanges();selected.addRange(range);document.dispatchEvent(new Event('selectionchange'));return;}
        throw Error('Selection text missing: '+text);
      },{selector,text});
      await p.waitForSelector('#explanation-selection:not([hidden])');
    };
    await selectGenerated(page,'#page-slot .answer .detail','原理和适用条件');
    await page.locator('#explanation-selection').click();
    await wait(()=>store.snapshot().nodes.some(n=>n.concept==='原理和适用条件'),'AI text selection child');await publish();
    const selectedChild=store.snapshot().nodes.find(n=>n.concept==='原理和适用条件');
    assert.equal(selectedChild.parentId,parent.id);assert.ok(selectedChild.source.context.includes('原理和适用条件'));pass('AI解释任意划词一键创建当前会话子节点并保存原文上下文');
    await store.appendMessage(selectedChild.id,{role:'assistant',content:'进一步回答：条件独立是另一个需要理解的概念。'});await publish();
    await selectGenerated(floating,'.messages .assistant','条件独立');await floating.locator('#explanation-selection').click();
    await wait(()=>store.snapshot().nodes.some(n=>n.concept==='条件独立'),'assistant followup selection');
    assert.equal(store.snapshot().nodes.find(n=>n.concept==='条件独立').parentId,selectedChild.id);pass('小浮窗中的AI追问回答划词自动形成下一级子节点');
    await page.evaluate(()=>{const input=document.querySelector('textarea');input.focus();input.value='不能把草稿当AI正文';input.select();document.dispatchEvent(new Event('selectionchange'));});
    assert.equal(await page.locator('#explanation-selection').isVisible(),false);pass('草稿输入和非AI工具栏文字不会误触子节点划词');
    await store.openSession(parent.id,'page');
    await store.appendMessage(parent.id,{role:'assistant',content:'第一段AI回答'});
    await store.appendMessage(parent.id,{role:'user',content:'用户追问不是AI正文'});
    await store.appendMessage(parent.id,{role:'assistant',content:'第二段AI回答'});await publish();
    await page.evaluate(()=>{const replies=document.querySelectorAll('#page-slot .message.assistant');const range=document.createRange();range.setStart(replies[0].querySelector('p').firstChild,0);range.setEnd(replies[1].querySelector('p').firstChild,2);const s=window.getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
    assert.equal(await page.locator('#explanation-selection').isVisible(),false);pass('禁止跨多个AI回复夹带用户问题的划词范围');
    await selectGenerated(page,'#page-slot .answer .detail','适用条件');await page.locator('#page-slot [data-action=selection-child]').click();
    await wait(()=>store.snapshot().nodes.some(n=>n.parentId===parent.id && n.concept==='适用条件'),'header AI selection entry');pass('工具栏划词入口同样保留选区并按AI正文规则创建子节点');
    assert.deepEqual(errors,[]);pass('原生标签、流式 Markdown 与双表面无脚本异常');
    await fs.writeFile(path.join(artifact,'result.json'),JSON.stringify({passed:checks.length,checks},null,2));console.log(JSON.stringify({passed:checks.length,checks,artifact}));
  } catch(error) {await fs.writeFile(path.join(artifact,'failed.json'),JSON.stringify({error:String(error),checks,archive:store.snapshot(),surfaces:await Promise.all(pages.map(p=>p.evaluate(()=>({title:document.querySelector('h1')?.textContent,notice:document.querySelector('#notice')?.textContent,body:document.body.textContent?.slice(0,2500)}))))},null,2));console.log('Failed UI artifacts: '+artifact);throw error;} finally { await browser?.close();await new Promise(resolve => server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});

