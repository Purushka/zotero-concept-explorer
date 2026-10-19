import {createLocalizer} from './localization.mjs';
import {EDGE_GAP, readFloatingPosition, floatingBounds, fitFloatingPosition,
  encodeFloatingPosition, restoreFloatingPosition} from './floating-geometry.mjs';

// The transparent handle lives in the host document, above the iframe's brand.
// Keeping pointer coordinates in that stationary document avoids iframe drag
// feedback/jitter. Header navigation and explanation text are not intercepted.
export function createFloatingWindow({window:win, frame, interact, initialPosition, locale='zh-CN', onSave = () => {}, onError = () => {}}) {
  const l10n=createLocalizer(locale),t=(key,values)=>l10n.t(key,values);
  if (typeof interact !== 'function') throw new Error(t("dragMissing"));
  const doc = win.document, header = frame.contentDocument.querySelector('.app-header');
  const nav = header.querySelector('nav');
  const handle = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  handle.id = 'concept-explorer-drag-handle';
  handle.setAttribute('role', 'button');
  handle.setAttribute('tabindex', '0');
  handle.setAttribute('aria-label', t("dragLabel"));
  handle.setAttribute('title', t("dragTitle"));
  handle.style.cssText = 'position:fixed;z-index:2147483601;display:none;background:transparent;cursor:grab;touch-action:none;user-select:none;border-radius:14px 0 0 0;';
  doc.documentElement.append(handle);
  header.querySelector('.brand small').dataset.i18n='dragHint';
  header.querySelector('.brand small').textContent = t("dragHint");
  let saved = readFloatingPosition(initialPosition), visible = false, disposed = false, drag = null, captured = null;
  const current = () => {const rect = frame.getBoundingClientRect(); return {left:rect.left, top:rect.top};};
  function bounds() {
    const width = doc.documentElement.clientWidth || win.innerWidth;
    const height = doc.documentElement.clientHeight || win.innerHeight;
    const bar = doc.getElementById('tab-bar-container')?.getBoundingClientRect();
    const top = bar && bar.height > 0 ? Math.max(0, bar.bottom) : 0;
    // A smaller host window must never strand the title bar offscreen.
    frame.style.maxWidth = Math.max(1, width - EDGE_GAP * 2) + 'px';
    frame.style.maxHeight = Math.max(1, height - top - EDGE_GAP * 2) + 'px';
    return floatingBounds({width, height, top}, frame.getBoundingClientRect());
  }
  function alignHandle() {
    if (!visible || disposed) return;
    const rect = frame.getBoundingClientRect(), title = header.getBoundingClientRect();
    // Leave every navigation button, including close, directly clickable.
    const width = Math.max(0, Math.min(nav.getBoundingClientRect().left - 4, rect.width - 2));
    Object.assign(handle.style, {left:rect.left + 1 + 'px', top:rect.top + 1 + 'px',
      width:width + 'px', height:Math.max(0, title.bottom - 1) + 'px'});
  }
  function place(position) {
    Object.assign(frame.style, {left:position.left + 'px', top:position.top + 'px', right:'auto', bottom:'auto'});
    alignHandle();
  }
  function release() {
    if (captured !== null) {try {handle.releasePointerCapture(captured);} catch {} captured = null;}
    handle.style.cursor = 'grab';
  }
  function persist() {
    saved = encodeFloatingPosition(current(), bounds());
    try {onSave(saved);} catch (error) {onError(error);}
  }
  function finish() {
    if (!drag) return;
    drag = null;
    place(fitFloatingPosition(current(), bounds(), {snap:true}));
    release();persist();
  }
  function cancel() {
    if (!drag) return;
    const previous = drag.start;
    const interaction = drag.interaction;
    drag = null;interaction.stop();
    place(fitFloatingPosition(previous, bounds()));release();
  }
  const draggable = interact(handle, {context:doc}).draggable({
    inertia:false, autoScroll:false,
    listeners:{
      start(event) {
        const position = current();
        drag = {start:position, left:position.left, top:position.top, interaction:event.interaction};
        handle.style.cursor = 'grabbing';
      },
      move(event) {
        if (!drag) return;
        drag.left += event.dx;drag.top += event.dy;
        place(fitFloatingPosition(drag, bounds()));
      },
      end:finish,
    },
  });
  function capture(event) {
    if (event.button !== 0) return;
    captured = event.pointerId;
    try {handle.setPointerCapture(captured);} catch {captured = null;}
  }
  function keydown(event) {
    if (event.key === 'Escape' && drag) {event.preventDefault();cancel();return;}
    if (event.target !== handle) return;
    const delta = {ArrowLeft:[-32,0], ArrowRight:[32,0], ArrowUp:[0,-32], ArrowDown:[0,32]}[event.key];
    if (!delta) return;
    event.preventDefault();
    const point = current();
    place(fitFloatingPosition({left:point.left + delta[0], top:point.top + delta[1]}, bounds(), {snap:true}));
    persist();
  }
  function refresh() {
    if (disposed || !visible || drag) return;
    place(restoreFloatingPosition(saved, bounds()));
  }
  handle.addEventListener('pointerdown', capture);
  win.addEventListener('keydown', keydown, true);
  win.addEventListener('resize', refresh);
  win.addEventListener('blur', finish);
  const observer = new win.ResizeObserver(refresh);
  observer.observe(frame);observer.observe(header);
  return {
    setLocale(value) {l10n.setLocale(value);handle.setAttribute('aria-label',t('dragLabel'));handle.title=t('dragTitle');header.querySelector('.brand small').textContent=t('dragHint');refresh();},
    refresh,
    setVisible(value) {
      if (disposed) return;
      if (!value) cancel();
      visible = value;handle.style.display = value ? 'block' : 'none';
      refresh();
    },
    dispose() {
      if (disposed) return;
      cancel();disposed = true;observer.disconnect();draggable.unset();
      interact.removeDocument(doc);
      handle.removeEventListener('pointerdown', capture);
      win.removeEventListener('keydown', keydown, true);
      win.removeEventListener('resize', refresh);win.removeEventListener('blur', finish);
      handle.remove();
    },
  };
}
