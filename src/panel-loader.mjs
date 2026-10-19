// Gecko chrome iframes may finish loading without a bubbling iframe load event.
// Check readiness as well as capture events, and never leave callers pending forever.
export function waitForPanelFrame({frame,window:win,uri,initialize,timeoutMs=15000,pollMs=50}) {
  return new Promise((resolve,reject) => {
    let poll,deadline,initializing=false,settled=false,wasConnected=false;
    const cleanup=() => {
      win.clearTimeout(poll); win.clearTimeout(deadline);
      frame.removeEventListener('load',check,true);
    };
    const finish=(error,value) => {
      if (settled) return;
      settled=true; cleanup();
      if (error) reject(error); else resolve(value);
    };
    function check() {
      if (settled || initializing) return;
      win.clearTimeout(poll);
      if (win.closed) { finish(new Error('阅读窗口已关闭。')); return; }
      if (frame.isConnected === true) wasConnected=true;
      else if (wasConnected && frame.isConnected === false) { finish(new Error('概念探索标签页已关闭。')); return; }
      try {
        const content=frame.contentWindow,doc=frame.contentDocument;
        if (doc?.URL === uri && doc.readyState === 'complete' && content?.ConceptPanel) {
          initializing=true;
          Promise.resolve().then(() => initialize(content)).then(value => finish(null,value),finish);
          return;
        }
      } catch (error) { finish(error); return; }
      poll=win.setTimeout(check,pollMs);
    }
    frame.addEventListener('load',check,true);
    deadline=win.setTimeout(() => finish(new Error('概念探索界面加载超时，请关闭面板后重新打开。')),timeoutMs);
    check();
  });
}