/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: inspect overlay: small monochrome tags beside fields, drawn in one fixed host with a closed shadow root that
   takes no clicks (except its close chip) and never moves the page. window.__fgExt.overlay = { v, show(items: [{ el, label }]), hide(), active }.
   Esc / the chip close it here and ask the service worker ({ type: 'inspect', on: false }) to close it in the tab's other frames. */
(() => {
  const VERSION = (() => { try { return chrome.runtime.getManifest().version || 'dev'; } catch (e) { return 'dev'; } })();
  const X = (window.__fgExt = window.__fgExt || {});
  if (X.overlay && X.overlay.v === VERSION) return;
  if (X.overlay && typeof X.overlay.hide === 'function') { try { X.overlay.hide(); } catch (e) { /* ignore */ } } // an older copy's tags

  const imp = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}!important`).join(';');
  const HOST = imp({
    all: 'initial', display: 'block', position: 'fixed', top: '0', left: '0', right: 'auto', bottom: 'auto', width: '0', height: '0', margin: '0', padding: '0',
    border: '0', background: 'transparent', overflow: 'visible', 'z-index': '2147483647', 'pointer-events': 'none', transform: 'none', opacity: '1', visibility: 'visible',
  });
  const CSS = `
    .b, .t { position: fixed; top: 0; left: 0; pointer-events: none; box-sizing: border-box; will-change: transform; }
    .b { border-radius: 3px; box-shadow: 0 0 0 1px rgba(24,24,27,.6), 0 0 0 2px rgba(250,250,250,.7); }
    .b.s { box-shadow: none; outline: 1px dashed rgba(113,113,122,.85); }
    .t { font: 500 10px/14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: .01em; padding: 0 5px; border-radius: 4px;
      background: #18181b; color: #fafafa; box-shadow: 0 0 0 1px rgba(250,250,250,.85); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
    .t.s { background: #fafafa; color: #52525b; box-shadow: 0 0 0 1px #a1a1aa; }
    .c { position: fixed; right: 12px; bottom: 12px; pointer-events: auto; display: flex; align-items: center; gap: 8px; margin: 0; border: 0; cursor: pointer;
      font: 500 12px/16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 6px 10px; border-radius: 999px;
      background: #18181b; color: #fafafa; box-shadow: 0 0 0 1px rgba(250,250,250,.85), 0 4px 16px rgba(0,0,0,.25); }
    .c:hover { background: #27272a; } .c:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; }
    .c b { font-weight: 400; opacity: .7; }`;
  const MAX = 2000;

  let host = null, root = null, list = [], raf = 0, timer = 0, modal = null;

  /* the top layer, above a page's <dialog>; raised again when a later modal dialog covers it */
  function raise() {
    try {
      if (!host.showPopover) return;
      if (!host.hasAttribute('popover')) host.setAttribute('popover', 'manual');
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch (e) { /* a plain fixed layer */ }
  }
  function tick() {
    let m = null;
    try { m = document.querySelector(':modal'); } catch (e) { /* ignore */ }
    if (m && m !== modal) raise();
    modal = m;
    queue();
  }

  function place() {
    raf = 0;
    if (!host) return;
    const vw = innerWidth, vh = innerHeight;
    const rects = list.map(({ el }) => { try { return el.isConnected ? el.getBoundingClientRect() : null; } catch (e) { return null; } });
    list.forEach((it) => { if (!it.w) it.w = it.tag.offsetWidth; }); // all reads before any write
    list.forEach((it, i) => {
      const r = rects[i], on = !!r && (r.width > 0 || r.height > 0) && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      it.tag.style.display = it.box.style.display = on ? '' : 'none';
      if (!on) return;
      const w = it.w, wide = r.width >= w + 12; // on the top-right corner, clear of a label above; beside a small control
      const x = Math.round(Math.max(0, Math.min(wide ? r.right - w - 6 : r.right + 4, vw - w))), y = Math.round(Math.max(0, wide ? r.top - 7 : r.top + r.height / 2 - 7));
      it.tag.style.transform = `translate(${x}px,${y}px)`;
      it.box.style.transform = `translate(${Math.round(r.left)}px,${Math.round(r.top)}px)`;
      it.box.style.width = Math.round(r.width) + 'px';
      it.box.style.height = Math.round(r.height) + 'px';
    });
  }
  const queue = () => { if (host && !raf) raf = requestAnimationFrame(place); };
  /* closed by the user (Esc, the chip): the service worker turns Inspect off in every frame of the tab, not just this one */
  function close() {
    hide();
    try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id && chrome.runtime.sendMessage) chrome.runtime.sendMessage({ type: 'inspect', on: false }, () => void chrome.runtime.lastError); } catch (e) { /* the extension was reloaded */ }
  }
  const onKey = (e) => { if (e.key === 'Escape' && !e.isComposing) close(); };
  const stop = (e) => e.stopPropagation();

  function show(items) {
    const doc = document.documentElement;
    if (!doc) return;
    if (!host) {
      host = document.createElement('formghost-overlay');
      host.setAttribute('style', HOST);
      root = host.attachShadow({ mode: 'closed' });
      doc.appendChild(host);
      addEventListener('scroll', queue, { capture: true, passive: true });
      addEventListener('resize', queue, { passive: true });
      addEventListener('keydown', onKey, true);
      timer = setInterval(tick, 500); // fields that move without a scroll (a section opens, a message appears), a dialog opening
    }
    raise();
    try { modal = document.querySelector(':modal'); } catch (e) { modal = null; }
    root.textContent = '';
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    list = (Array.isArray(items) ? items : []).filter((it) => it && it.el && it.el.nodeType === 1).slice(0, MAX).map(({ el, label }) => {
      const text = String(label == null ? '' : label), skip = /^skip\b/i.test(text);
      const box = document.createElement('div'), tag = document.createElement('div');
      box.className = skip ? 'b s' : 'b';
      tag.className = skip ? 't s' : 't';
      tag.textContent = text;
      root.append(box, tag);
      return { el, box, tag, w: 0 };
    });
    if (window.top === window) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'c';
      chip.setAttribute('aria-label', 'Close FormGhost inspect');
      chip.title = 'Close (Esc)';
      const n = list.length, b = document.createElement('b');
      b.textContent = '✕';
      chip.append(`Inspect · ${n} field${n === 1 ? '' : 's'}`, b);
      ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => chip.addEventListener(t, stop));
      chip.addEventListener('click', close);
      root.appendChild(chip);
    }
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    place();
  }

  function hide() {
    if (raf) cancelAnimationFrame(raf);
    clearInterval(timer);
    raf = timer = 0;
    removeEventListener('scroll', queue, { capture: true });
    removeEventListener('resize', queue);
    removeEventListener('keydown', onKey, true);
    if (host) { try { if (host.hidePopover && host.matches(':popover-open')) host.hidePopover(); } catch (e) { /* ignore */ } host.remove(); }
    host = root = modal = null;
    list = [];
  }

  X.overlay = { v: VERSION, show, hide, get active() { return !!host; } };
})();
