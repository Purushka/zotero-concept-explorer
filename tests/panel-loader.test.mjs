import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForPanelFrame} from '../src/panel-loader.mjs';
const uri='chrome://concept-explorer/content/panel.html';
function fixture() {
  const frame=new EventTarget();
  frame.contentWindow={}; frame.contentDocument={URL:'about:blank',readyState:'complete'};
  const timers=new Set();
  const window={closed:false,setTimeout(fn,ms) {const id=setTimeout(() => {timers.delete(id);fn();},ms);timers.add(id);return id;},clearTimeout(id){clearTimeout(id);timers.delete(id);}};
  return {frame,window,timers,ready(){frame.contentDocument={URL:uri,readyState:'complete'};frame.contentWindow.ConceptPanel={};}};
}
test('Gecko panel initializes when its load event is absent',async () => {
  const f=fixture();let calls=0;
  const pending=waitForPanelFrame({...f,uri,pollMs:1,timeoutMs:100,initialize:content=>{assert.equal(content,f.frame.contentWindow);calls++;return 'ready';}});
  f.ready(); assert.equal(await pending,'ready');assert.equal(calls,1);assert.equal(f.timers.size,0);
});
test('load and polling cannot initialize the same panel twice',async () => {
  const f=fixture();let calls=0;
  const pending=waitForPanelFrame({...f,uri,pollMs:1,timeoutMs:100,initialize:async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,3));}});
  f.frame.dispatchEvent(new Event('load'));f.ready();f.frame.dispatchEvent(new Event('load'));f.frame.dispatchEvent(new Event('load'));
  await pending;assert.equal(calls,1);assert.equal(f.timers.size,0);
});
test('panel initialization rejection reaches the caller and cleans listeners/timers',async () => {
  const f=fixture();f.ready();let calls=0;
  await assert.rejects(waitForPanelFrame({...f,uri,timeoutMs:100,initialize:()=>{calls++;throw new Error('init failed');}}),/init failed/);
  f.frame.dispatchEvent(new Event('load'));assert.equal(calls,1);assert.equal(f.timers.size,0);
});
test('wrong URL or missing scripts time out instead of hanging',async () => {
  const f=fixture();f.frame.contentWindow.ConceptPanel={};
  await assert.rejects(waitForPanelFrame({...f,uri,pollMs:1,timeoutMs:10,initialize:()=>{throw new Error('must not run');}}),/加载超时/);
  assert.equal(f.timers.size,0);
});
test('closing the Zotero window aborts pending panel loading',async () => {
  const f=fixture();f.window.closed=true;
  await assert.rejects(waitForPanelFrame({...f,uri,initialize:()=>{}}),/窗口已关闭/);assert.equal(f.timers.size,0);
});test('closing a connected tab aborts its pending frame initialization',async()=>{
  const f=fixture();f.frame.isConnected=true;
  const pending=waitForPanelFrame({...f,uri,pollMs:1,timeoutMs:100,initialize:()=>{}});
  f.frame.isConnected=false;await assert.rejects(pending,/标签页已关闭/);assert.equal(f.timers.size,0);
});
