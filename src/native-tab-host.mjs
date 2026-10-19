// Adapter over Zotero's own tab API. No duplicate tab bar, deck or window manager.
// API reference: zotero/zotero, chrome/content/zotero/tabs.js (AGPL-3.0+).
// Checked against 9.0.6 and 10.0 branch commit 536244c2771f590abab9c09a3c27e615e0b318ff.
export const TAB_TYPE = 'conceptExplorer';
export function createNativeTabHost({window:win,onSelect=()=>{},onClose=()=>{},onRestore=()=>{},onError=()=>{}}) {
  const tabs=win.Zotero_Tabs;
  if (!tabs?.add || !tabs?.select || !tabs?.close) throw new Error('此窗口不支持 Zotero 标签页，请在主窗口打开概念探索。');
  let current=null,disposed=false;
  const hooks=[];
  function live() {
    const container=current && tabs.getTabContent(current.id);
    return container && container.isConnected !== false ? current : null;
  }
  function ensure({select=false,title='概念探索',index}={}) {
    if (disposed || win.closed) throw new Error('概念探索窗口已关闭。');
    if (!live()) {
      const added=tabs.add({type:TAB_TYPE,title,data:{plugin:'concept-explorer',icon:'note'},index,select:false,onClose:() => {
        const previous=current;current=null;onClose(previous,{disposed});
      }});
      current=added;
      added.container.addEventListener('tab-selection-change',event => { if(event.detail?.selected) onSelect(added); });
    }
    if (select) { tabs.select(current.id);onSelect(current); }
    return current;
  }
  function close() { if(live()) tabs.close(current.id); }
  // These hooks are scoped to our own type; do not replace any Zotero methods.
  for (const [action,callback] of Object.entries({
    refocus:() => { if(live() && tabs.selectedID===current.id) onSelect(current); },
    focusFirst:() => { if(live()) onSelect(current); },
    undoClose:async (tab,index) => { await onRestore(tab,index);return true; },
    restoreState:async () => ({itemID:null}),
  })) {
    if(!tabs.tabHooks?.[action]) continue;
    const map=tabs.tabHooks[action],previous=map[TAB_TYPE];
    map[TAB_TYPE]=callback;hooks.push({map,previous,callback});
  }
  return {
    get tab() { return live(); },ensure,close,
    async rename(title) { if(live()) await tabs.rename(current.id,title); },
    dispose() {
      if(disposed) return;
      disposed=true;close();
      for(const {map,previous,callback} of hooks) if(map[TAB_TYPE]===callback) {
        if(previous===undefined) delete map[TAB_TYPE];else map[TAB_TYPE]=previous;
      }
    },
    selected() { return !!live() && tabs.selectedID===current.id; },
    report(error) { onError(error); },
  };
}

// Zotero's session loader cannot restore third-party content before plugins start.
// Remove only our transient tab descriptors from the in-memory startup snapshot.
// Our archive and plugin preference restore the workbench, without touching PDFs.
export function omitOwnStartupTabs(sessionState) {
  for(const win of sessionState?.windows ?? []) if(Array.isArray(win.tabs)) {
    win.tabs=win.tabs.filter(tab => tab.type!==TAB_TYPE);
  }
}
