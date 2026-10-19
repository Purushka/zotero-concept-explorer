import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeTabHost,omitOwnStartupTabs,TAB_TYPE} from '../src/native-tab-host.mjs';
function fixture(){
  const entries=new Map(),calls=[],tabHooks=Object.fromEntries(['refocus','focusFirst','restoreState','undoClose'].map(k=>[k,{}]));
  const tabs={tabHooks,selectedID:'pdf-original',
    add(options){const id='concept-'+(calls.length+1),events=new Map();const container={isConnected:true,addEventListener:(name,cb)=>events.set(name,cb)};const item={id,container,options,events};entries.set(id,item);calls.push(['add',options]);return {id,container};},
    select(id){this.selectedID=id;calls.push(['select',id]);entries.get(id)?.events.get('tab-selection-change')?.({detail:{selected:true}});},
    close(id){const item=entries.get(id);if(!item)return;item.options.onClose();item.container.isConnected=false;entries.delete(id);this.selectedID='pdf-original';calls.push(['close',id]);},
    getTabContent:id=>entries.get(id)?.container,
    rename:async(id,title)=>{calls.push(['rename',id,title]);},
  };
  return {win:{Zotero_Tabs:tabs,closed:false},tabs,calls,entries};
}
test('native tab uses host API, stays below the host deck and reuses a single tab',()=>{
  const {win,tabs,calls}=fixture();let selected=0;const host=createNativeTabHost({window:win,onSelect:()=>selected++});
  const first=host.ensure();assert.equal(tabs.selectedID,'pdf-original');assert.equal(calls[0][1].type,TAB_TYPE);assert.equal(calls[0][1].select,false);
  assert.equal(host.ensure({select:true}).id,first.id);assert.equal(calls.filter(c=>c[0]==='add').length,1);assert.ok(selected>0);assert.equal(host.selected(),true);
  tabs.select('pdf-original');assert.equal(host.selected(),false);assert.equal(host.tab.id,first.id);
});
test('close/undo reopen only the plugin UI without deleting persisted sessions',async()=>{
  const {win,tabs}=fixture();let closes=0,restores=0;const host=createNativeTabHost({window:win,onClose:()=>closes++,onRestore:()=>{restores++;host.ensure();}});
  const first=host.ensure();host.close();assert.equal(closes,1);assert.equal(host.tab,null);
  assert.equal(await tabs.tabHooks.undoClose[TAB_TYPE](),true);assert.equal(restores,1);assert.notEqual(host.tab.id,first.id);
});
test('native tab hooks are type-scoped and disposed without modifying host hooks',()=>{
  const {win,tabs}=fixture();const existing=()=>{};tabs.tabHooks.refocus.reader=existing;const previous=()=>{};tabs.tabHooks.refocus[TAB_TYPE]=previous;
  const host=createNativeTabHost({window:win});host.ensure();host.dispose();host.dispose();assert.equal(tabs.tabHooks.refocus.reader,existing);assert.equal(tabs.tabHooks.refocus[TAB_TYPE],previous);assert.equal(tabs.tabHooks.undoClose[TAB_TYPE],undefined);assert.throws(()=>host.ensure());
});
test('session startup filtering removes only this plugin’s transient tab, never PDFs or other plugins',()=>{
  const pdf={type:'reader',data:{itemID:19}},other={type:'thirdParty',data:{id:22}},library={type:'library'};
  const state={windows:[{type:'pane',tabs:[library,{type:TAB_TYPE},pdf,other]},{type:'reader',itemID:77}]};
  omitOwnStartupTabs(state);assert.deepEqual(state.windows[0].tabs,[library,pdf,other]);assert.equal(state.windows[1].itemID,77);omitOwnStartupTabs(null);
});
test('unsupported reader windows fail clearly instead of creating a fullscreen overlay',()=>{
  assert.throws(()=>createNativeTabHost({window:{}}),/主窗口/);
});
test('disposing a native tab is distinguished from the user closing it',()=>{
  const {win}=fixture();const reasons=[];const host=createNativeTabHost({window:win,onClose:(_tab,reason)=>reasons.push(reason.disposed)});
  host.ensure();host.close();host.ensure();host.dispose();assert.deepEqual(reasons,[false,true]);
});
test('undo close preserves its requested Zotero tab index',async()=>{
  const {win,tabs}=fixture();const restored=[];
  const host=createNativeTabHost({window:win,onRestore:(tab,index)=>{restored.push({tab,index});host.ensure({index});}});
  await tabs.tabHooks.undoClose[TAB_TYPE]({data:{plugin:'concept-explorer'}},2);
  assert.equal(restored[0].index,2);assert.equal(tabs.getTabContent(host.tab.id),host.tab.container);
});
test('a missing host container is recreated rather than selected as a stale tab',()=>{
  const {win,tabs,entries,calls}=fixture();const host=createNativeTabHost({window:win});const first=host.ensure();entries.delete(first.id);
  assert.equal(host.tab,null);assert.notEqual(host.ensure().id,first.id);assert.equal(calls.filter(c=>c[0]==='add').length,2);
});
