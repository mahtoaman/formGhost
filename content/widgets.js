/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: custom widgets, injected before filler.js: ARIA / library comboboxes (react-select, MUI Select / Autocomplete, Ant Design,
   Angular Material, ng-select, Headless UI, Radix / shadcn, downshift, Element Plus, Vuetify), ARIA checkboxes / switches / radios and Google Forms questions,
   driven as a user drives them (pointer, mouse, focus and key events). Never submits, never clicks 'Create …' / 'Add new' / 'Delete' options.
   window.__fgExt.widgets = { v, find(root), choose(entry, pick) → { ok, prev, label }, toggle(el, on) → { ok, prev }, restore(entry, prev) → bool }.
   pick(texts, info) → index | -1 is the filler's; pick.query, when set, is typed into a searchable box whose list is empty.
   Entries: { el, kind: 'combobox'|'toggle'|'radiogroup'|'grid', lib } + root (native controls inside belong to the widget), hidden (the
   library's own hidden <select> / inputs), label, value | checked, required, multi, free (a box that also keeps typed text), options, group, rows. */
(() => {
  const VERSION = (() => { try { return chrome.runtime.getManifest().version || 'dev'; } catch (e) { return 'dev'; } })();
  const X = (window.__fgExt = window.__fgExt || {});
  if (X.widgets && X.widgets.v === VERSION) return;

  const norm = (s) => String(s == null ? '' : s).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const low = (s) => norm(s).toLowerCase();
  const textOf = (n) => norm(n && (n.innerText || n.textContent));
  const cls = (n) => (n && n.getAttribute && n.getAttribute('class')) || '';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const ask = (f) => { try { return f(); } catch (e) { return null; } };
  async function until(f, ms) { const t0 = Date.now(); for (;;) { const v = ask(f); if (v || Date.now() - t0 >= ms) return v || null; await sleep(15); } }
  const up = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null; // crosses shadow roots
  const inside = (c, n) => { for (let x = n; x; x = up(x)) if (x === c) return true; return false; };
  const byId = (n, id) => { const r = n.getRootNode(); return (r.getElementById && r.getElementById(id)) || n.ownerDocument.getElementById(id); };
  const ids = (n, a) => ((n && n.getAttribute && n.getAttribute(a)) || '').split(/\s+/).filter(Boolean);
  function deep(root, sel, out = []) {
    root.querySelectorAll(sel).forEach((e) => out.push(e));
    root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) deep(e.shadowRoot, sel, out); });
    return out;
  }
  function shown(x) {
    if (!x || !x.isConnected || !x.getBoundingClientRect) return false;
    const s = getComputedStyle(x);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    const r = x.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }
  const DIALOG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true]';
  const hiddenTree = (el) => { for (let n = el; n; n = up(n)) if (n.nodeType === 1 && (n.inert || (n.getAttribute('aria-hidden') === 'true' && !(n.matches(DIALOG) && shown(n))))) return true; return false; };
  const OFF = ':disabled,[aria-disabled=true],[data-disabled],.Mui-disabled,.ant-select-disabled,.ng-select-disabled,.mat-mdc-select-disabled,.mat-select-disabled';
  const off = (n) => !!n && n.nodeType === 1 && (n.matches(OFF) || n.getAttribute('aria-readonly') === 'true');
  /* react-select with isSearchable={false} keeps a read-only dummy input (inputmode=none, aria-readonly) that only takes focus: not disabled */
  const dummy = (p, n) => p.lib === 'react-select' && n === p.input && n.matches('input[inputmode=none],input[readonly],[class*="dummyInput"]');
  /* left to the filler (select2 / chosen / Tom Select… drive their <select>; phone and date widgets have their own code) and page chrome */
  const NOPE = '.select2-container,.select2,.chosen-container,.bootstrap-select,.ts-wrapper,.ts-dropdown,.selectize-control,.selectize-dropdown,.choices,'
    + '.iti,.iti--container,.iti__dropdown-content,.react-tel-input,.PhoneInput,.flatpickr-calendar,.react-datepicker,.react-datepicker-popper,'
    + '.MuiPickersPopper-root,.ant-picker,.ant-picker-dropdown,.ui-datepicker,.datepicker-dropdown,[data-formghost=off i],[data-formghost=false i],[data-formghost=ignore i]';
  const AREA = 'nav,[role=navigation],[role=banner],[role=menubar],[role=menu],[role=toolbar],[role=tablist],[role=tree],[role=grid],[role=treegrid],[role=search],[role=listbox],[role=option],[role=tooltip]';
  function blocked(el) {
    for (let n = el; n; n = up(n)) {
      if (n.nodeType !== 1) continue;
      if (n.matches(NOPE) || (n !== el && n.matches(AREA))) return true;
      if (n.tagName === 'HEADER' && !n.closest('form,main,dialog,[role=dialog],[role=form],article,section')) return true;
    }
    return false;
  }
  const usable = (n) => shown(n) && !blocked(n) && !hiddenTree(n);

  /* ---------- events: what a user's mouse, keyboard and focus send ---------- */
  const view = (x) => (x.ownerDocument && x.ownerDocument.defaultView) || window;
  const deepActive = (d) => { let a = d.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  function fire(x, type) {
    const w = view(x), r = x.getBoundingClientRect(), cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const down = /down$/.test(type), edge = /enter$|leave$/.test(type);
    const o = { bubbles: !edge, cancelable: !edge, composed: true, view: w, button: 0, buttons: down ? 1 : 0, clientX: cx, clientY: cy, screenX: cx, screenY: cy, detail: /down$|up$|^click$/.test(type) ? 1 : 0 };
    if (!type.startsWith('pointer')) return x.dispatchEvent(new MouseEvent(type, o));
    const P = w.PointerEvent || PointerEvent;
    return x.dispatchEvent(new P(type, { ...o, pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: down ? 0.5 : 0 }));
  }
  const hover = (x) => ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach((t) => fire(x, t));
  /* the events focus() leaves out while the page itself isn't focused (the popup is open) */
  function moved(a0, a1) {
    const d = a1.ownerDocument, f = (n, t, b, rel) => n.dispatchEvent(new FocusEvent(t, { bubbles: b, composed: true, relatedTarget: rel }));
    if (a0 && a0 !== a1 && a0 !== d.body && a0.isConnected) { f(a0, 'blur', false, a1); f(a0, 'focusout', true, a1); }
    f(a1, 'focus', false, a0); f(a1, 'focusin', true, a0);
  }
  function focusIn(el) {
    const d = el.ownerDocument, a0 = deepActive(d);
    if (a0 === el) return;
    let got = false;
    const h = () => { got = true; };
    d.addEventListener('focusin', h, true);
    ask(() => el.focus({ preventScroll: true }));
    d.removeEventListener('focusin', h, true);
    if (!got && deepActive(d) === el) moved(a0, el);
  }
  function focusOut(el) {
    let got = false;
    const h = () => { got = true; };
    el.addEventListener('blur', h, true);
    ask(() => el.blur());
    el.removeEventListener('blur', h, true);
    if (!got && el.isConnected) { el.dispatchEvent(new FocusEvent('blur', { composed: true })); el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true })); }
  }
  /* page handlers run, but no form is submitted and no link followed by these events */
  function guarded(x, fn) {
    const w = view(x), stop = (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, nav = (e) => { if (e.target && e.target.closest && e.target.closest('a[href]')) e.preventDefault(); };
    w.addEventListener('submit', stop, true); w.addEventListener('click', nav);
    try { fn(); } finally { w.removeEventListener('submit', stop, true); w.removeEventListener('click', nav); }
  }
  const FOCUSABLE = 'input,select,textarea,button,a[href],[tabindex],[contenteditable=""],[contenteditable=true]';
  /* press and release are two tasks, as a hand makes them (Radix opens on pointerdown and only then listens for the release) */
  async function press(x, gap = 30) {
    if (!x || !x.isConnected) return;
    const d = x.ownerDocument, a0 = deepActive(d);
    let got = false;
    const h = () => { got = true; };
    d.addEventListener('focusin', h, true);
    guarded(x, () => {
      hover(x);
      fire(x, 'pointerdown');
      if (fire(x, 'mousedown')) { const f = x.closest(FOCUSABLE); if (f && deepActive(d) !== f) ask(() => f.focus({ preventScroll: true })); }
    });
    d.removeEventListener('focusin', h, true);
    const a1 = deepActive(d);
    if (a1 && a1 !== a0 && a1 !== d.body && !got) moved(a0, a1);
    await sleep(gap);
    if (x.isConnected) guarded(x, () => { fire(x, 'pointerup'); fire(x, 'mouseup'); fire(x, 'click'); });
  }
  const KEYS = { Escape: 27, ArrowDown: 40, ArrowUp: 38, Enter: 13, Backspace: 8 };
  function key(x, k, mods) {
    const c = KEYS[k] || 0, o = { key: k, code: k, keyCode: c, which: c, bubbles: true, cancelable: true, composed: true, view: view(x), ...mods };
    let ok = true;
    guarded(x, () => { ok = x.dispatchEvent(new KeyboardEvent('keydown', o)); x.dispatchEvent(new KeyboardEvent('keyup', o)); });
    return ok;
  }
  const setter = (el) => Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set;
  const inputEv = (el, t, o) => el.dispatchEvent(new InputEvent(t, { bubbles: true, cancelable: t === 'beforeinput', composed: true, ...o }));
  function setText(el, v) { focusIn(el); setter(el).call(el, v); inputEv(el, 'input', { inputType: v ? 'insertText' : 'deleteContentBackward', data: v || null }); }
  /* typed key by key with real input events (searchable lists filter on them) */
  function typeIn(el, text) {
    if (el.value) setText(el, '');
    else focusIn(el);
    const set = setter(el);
    for (const c of String(text).slice(0, 40)) {
      const k = { key: c, keyCode: c.toUpperCase().charCodeAt(0), which: c.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, composed: true };
      if (el.dispatchEvent(new KeyboardEvent('keydown', k)) && el.dispatchEvent(new KeyboardEvent('keypress', { ...k, charCode: c.charCodeAt(0) })) && inputEv(el, 'beforeinput', { inputType: 'insertText', data: c })) {
        set.call(el, el.value + c);
        inputEv(el, 'input', { inputType: 'insertText', data: c });
      }
      el.dispatchEvent(new KeyboardEvent('keyup', k));
    }
  }

  /* ---------- names and states ---------- */
  function nameOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const self = el.matches('[role=combobox],[aria-haspopup],mat-select'); // a combobox may name itself by its value: left out
    const by = ids(el, 'aria-labelledby').map((id) => byId(el, id)).filter((x) => x && x !== el && !(self && el.contains(x))).map(textOf).join(' ');
    if (norm(by)) return norm(by);
    if (norm(el.getAttribute('aria-label'))) return norm(el.getAttribute('aria-label'));
    if (el.labels && el.labels.length) return norm([...el.labels].map(textOf).join(' '));
    const l = el.id && !('labels' in el) && ask(() => el.getRootNode().querySelector(`label[for="${CSS.escape(el.id)}"]`));
    return l ? textOf(l) : '';
  }
  const CTL = 'input,select,textarea,button,[role=combobox],[role=radio],[role=checkbox],[role=switch],[role=listbox],[role=slider],[contenteditable]';
  /* the text right before a block (an unlinked label), walking up a few levels */
  function before(n) {
    for (let x = n, i = 0; x && i < 3; x = x.parentElement, i++) {
      let p = x.previousElementSibling;
      while (p && !textOf(p)) p = p.previousElementSibling;
      if (p && !p.matches(CTL) && !p.querySelector(CTL)) { const t = textOf(p); if (t && t.length < 80) return t; }
      if (!x.parentElement || x.parentElement.matches('form,body')) break;
    }
    return '';
  }
  /* a Google Forms question (the list item holding a heading), its title */
  function question(el) {
    for (let n = el.closest('[role=listitem]'); n; n = n.parentElement && n.parentElement.closest('[role=listitem]')) if (n.querySelector('[role=heading]')) return n;
    return null;
  }
  const heading = (q) => { const h = q && q.querySelector('[role=heading]'); return h ? textOf(h) : ''; };
  const gforms = (el) => !!question(el) && (/(^|\.)docs\.google\.com$/.test(location.hostname) || !!el.closest('[jsname],[jscontroller],[jsmodel]'));
  function fieldName(el, root) {
    let t = nameOf(el);
    if (!t) { // the field wrapper's label, the nearest one before the widget
      const f = root.closest('.MuiFormControl-root,.ant-form-item,mat-form-field,.mat-mdc-form-field,.el-form-item,.v-input,.form-group,.form-field,.field');
      const ls = f ? [...f.querySelectorAll('label,mat-label,.ant-form-item-label,legend')].filter((x) => !x.contains(root) && textOf(x)) : [];
      const l = ls.filter((x) => x.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || ls[0];
      if (l) t = textOf(l);
    }
    if (!t) t = heading(question(el));
    if (!t) { const fs = root.closest('fieldset'), lg = fs && [...fs.children].find((c) => c.tagName === 'LEGEND'); if (lg) t = textOf(lg); }
    return (t || before(root)).slice(0, 200);
  }
  const isReq = (...ns) => ns.some((n) => n && n.nodeType === 1 && (n.getAttribute('aria-required') === 'true' || n.hasAttribute('required')));
  const starred = (t) => /\*\s*$|\(required\)|\brequired\b\s*$/i.test(t || '');
  /* checkbox / switch / radio: on, off, or null when it shows no state */
  function isOn(x) {
    if (!x) return null;
    const a = x.getAttribute('aria-checked');
    if (a != null) return a === 'true';
    const s = x.getAttribute('data-state');
    if (s) return /^(checked|on|active)$/.test(s);
    const p = x.getAttribute('aria-pressed');
    if (p != null) return p === 'true';
    return /(^|[\s_-])(is-)?(checked|selected)\b/.test(cls(x)) ? true : null;
  }
  /* a checkbox / radio item's text: its own name, Google Forms' data-value, its text, the text right after it */
  function itemText(n) {
    let t = nameOf(n) || n.getAttribute('data-value') || n.getAttribute('data-answer-value') || textOf(n);
    if (!t) { const l = n.closest('label'); if (l) t = textOf(l); }
    if (!t) { let s = n.nextSibling; while (s && s.nodeType === 3 && !s.textContent.trim()) s = s.nextSibling; t = s ? (s.nodeType === 3 ? norm(s.textContent) : textOf(s)) : ''; }
    return (t || n.getAttribute('value') || '').slice(0, 120);
  }
  const colText = (n) => n.getAttribute('data-value') || n.getAttribute('data-answer-value') || itemText(n);
  /* the library's own hidden form controls next to a control (Radix bubble inputs / select) */
  const bubbles = (n) => [n.nextElementSibling, n.previousElementSibling].filter((s) => s && s.matches('input[aria-hidden=true],select[aria-hidden=true],input[type=hidden]'));
  const libOf = (n) => (n.hasAttribute('data-radix-collection-item') || (n.tagName === 'BUTTON' && n.hasAttribute('data-state')) ? 'radix'
    : /^headlessui-/.test(n.id || '') || n.hasAttribute('data-headlessui-state') ? 'headlessui' : n.closest('.ant-switch,.ant-radio-group,.ant-checkbox-group') ? 'antd' : gforms(n) ? 'gforms' : 'aria');

  /* ---------- comboboxes: their parts ---------- */
  const RS = /(^|\s)(css-[\w-]*-control|[\w-]+__control)(\s|$)/; // react-select's control (emotion label or classNamePrefix)
  const firstInput = (x) => x && x.querySelector('input:not([type=hidden])');
  const editable = (i) => !!i && i.tagName === 'INPUT' && !i.readOnly && !i.disabled && i.getAttribute('inputmode') !== 'none' && i.getAttribute('unselectable') !== 'on';
  /* a button next to a typing box that opens its list (MUI's popup indicator, Headless UI / downshift toggle buttons) */
  function opener(inp) {
    const lists = [...ids(inp, 'aria-controls'), ...ids(inp, 'aria-owns')];
    for (let n = inp.parentElement, i = 0; n && i < 2 && !n.matches('form,body,fieldset,[role=form],[role=dialog]'); n = n.parentElement, i++) {
      const b = [...n.querySelectorAll('button,[role=button]')].find((x) => !x.contains(inp) && !x.querySelector('input,select,textarea') && !/clear|remove|delete|reset/i.test(x.getAttribute('aria-label') + ' ' + x.title + ' ' + cls(x))
        && (/combobox-button|toggle-button/.test(x.id) || (lists.length && [...ids(x, 'aria-controls'), ...ids(x, 'aria-owns')].some((id) => lists.includes(id)))
          || (x.getAttribute('aria-haspopup') !== 'listbox' && /\b(open|toggle|show|expand)\b|dropdown|popup|indicator|caret|arrow/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.title || '') + ' ' + cls(x)))));
      if (b) return b;
    }
    return null;
  }
  function partsOf(n) {
    let r;
    if ((r = n.closest('.ant-select'))) { const t = r.querySelector('.ant-select-selector') || r, i = firstInput(r); return { lib: 'antd', el: i || n, root: r, trigger: t, input: i, valueRoot: t, multi: r.matches('.ant-select-multiple,.ant-select-tags') }; }
    if ((r = n.closest('.MuiAutocomplete-root'))) { const i = firstInput(r); return { lib: 'mui', el: i || n, root: r, trigger: i || n, input: i, toggle: r.querySelector('.MuiAutocomplete-popupIndicator'), valueRoot: r.querySelector('.MuiInputBase-root') || r, typed: true, multi: !!r.querySelector('.MuiAutocomplete-tag'), free: !r.matches('.MuiAutocomplete-hasPopupIcon') }; }
    if ((r = n.closest('mat-select,.mat-mdc-select,.mat-select'))) return { lib: 'mat', el: r, root: r, trigger: r.querySelector('.mat-mdc-select-trigger,.mat-select-trigger') || r, valueRoot: r.querySelector('.mat-mdc-select-value,.mat-select-value') || r, multi: r.matches('.mat-mdc-select-multiple,.mat-select-multiple') || r.getAttribute('aria-multiselectable') === 'true' };
    if ((r = n.closest('.el-select'))) { const i = firstInput(r); return { lib: 'element', el: i || n, root: r, trigger: r.querySelector('.el-select__wrapper,.select-trigger') || r, input: i, valueRoot: r.querySelector('.el-select__selection,.el-select__tags') || r, multi: !!r.querySelector('.el-tag') }; }
    if ((r = n.closest('.v-input')) && r.matches('.v-select,.v-autocomplete,.v-combobox')) { const i = firstInput(r), f = r.querySelector('[role=combobox]') || n; return { lib: 'vuetify', el: f, root: r, trigger: f, input: i, valueRoot: r.querySelector('.v-field__input') || f, typed: editable(i), multi: !!r.querySelector('.v-chip'), free: r.matches('.v-combobox') }; }
    if ((r = n.closest('ng-select,.ng-select'))) { const i = firstInput(r); return { lib: 'ng-select', el: i || r, root: r, trigger: r.querySelector('.ng-select-container') || r, input: i, valueRoot: r.querySelector('.ng-value-container') || r, multi: r.matches('.ng-select-multiple') }; }
    if (n.matches('.MuiSelect-select,.MuiSelect-root,.MuiSelect-button')) { r = n.closest('.MuiInputBase-root') || n; return { lib: 'mui', el: n, root: r, trigger: n, valueRoot: n, hidden: [...r.querySelectorAll('input[aria-hidden=true],input.MuiSelect-nativeInput')] }; }
    for (let x = n, i = 0; x && i < 6 && x.parentElement; x = x.parentElement, i++) if (RS.test(cls(x)) && x.querySelector('input') && (x.querySelector('[class*="ndicator"],[class*="alue-container"],[class*="alueContainer"]') || /react-select/.test(cls(x) + n.id))) {
      const inp = firstInput(x);
      return { lib: 'react-select', el: inp || n, root: x.parentElement, trigger: x, input: inp, valueRoot: x.firstElementChild || x, multi: !!x.querySelector('[class*="multiValue"],[class*="multi-value"],[class*="value-container--is-multi"]') };
    }
    const typed = editable(n), lib = n.matches('[role=listbox]') ? (gforms(n) ? 'gforms' : 'aria') : /^headlessui-/.test(n.id) || n.hasAttribute('data-headlessui-state') ? 'headlessui'
      : /^downshift-/.test(n.id) ? 'downshift' : n.matches('button[role=combobox]') && (n.hasAttribute('data-state') || /^radix-/.test(n.getAttribute('aria-controls') || '')) ? 'radix' : 'aria';
    const hidden = n.parentElement ? [...n.parentElement.children].filter((c) => c !== n && c.matches('select[aria-hidden=true],input[type=hidden]')) : [];
    return { lib, own: n.matches('[role=listbox]'), el: n, root: n, trigger: n, input: n.tagName === 'INPUT' ? n : null, toggle: n.tagName === 'INPUT' ? opener(n) : null, valueRoot: n, typed, hidden,
      multi: n.getAttribute('aria-multiselectable') === 'true', free: typed && (lib === 'aria' || lib === 'downshift') };
  }
  const SEARCHY = /\bsearch\b|^\s*q\s*$/i;
  function comboEntry(n) {
    if (n.matches('select,textarea,option,[role=checkbox],[role=switch],[role=radio]') || (n.tagName === 'INPUT' && (/^(hidden|checkbox|radio|submit|button|file|image|reset)$/.test(n.type) || n.list))) return null;
    const p = partsOf(n);
    if (!p || blocked(p.root) || hiddenTree(p.trigger) || !shown(p.trigger) || (off(p.el) && !(dummy(p, p.el) && !p.el.matches(OFF))) || off(p.root) || off(p.trigger)) return null;
    if (p.lib === 'aria' && !n.matches('[role=combobox],[aria-haspopup=listbox]') && !(n.matches('[role=listbox]') && (n.hasAttribute('aria-expanded') || question(n)))) return null; // a plain autocomplete box, an inline list
    if (p.lib === 'aria' && (n.type === 'search' || [p.el.name, p.el.id, p.el.getAttribute('aria-label'), p.el.getAttribute('placeholder')].some((s) => s && SEARCHY.test(s)))) return null; // a site search box
    const label = fieldName(p.el, p.root);
    const req = isReq(p.el, p.input, p.root, ...(p.hidden || [])) || (p.root !== p.el && !!p.root.querySelector('input[required],select[required]')) || starred(label);
    return { el: p.el, kind: 'combobox', lib: p.lib, root: p.root, hidden: p.hidden || [], label, value: valueText(p), required: req, multi: !!p.multi, free: !!p.free };
  }

  /* ---------- comboboxes: the shown value ---------- */
  const NOTXT = 'input,select,option,textarea,script,style,svg,template,[aria-hidden=true],[role=listbox],[role=menu],[role=option],[role=tooltip]';
  function walk(r) {
    const out = [], w = r.ownerDocument.createTreeWalker(r, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 3 ? NodeFilter.FILTER_ACCEPT
      : n !== r && (n.matches(NOTXT) || /placeholder|sr-only|visually-?hidden|screen-?reader/i.test(cls(n)) || n.hasAttribute('data-placeholder')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) });
    for (let t; (t = w.nextNode());) { const s = norm(t.nodeValue); if (s && t.parentElement && shown(t.parentElement)) out.push(s); }
    return norm(out.join(' '));
  }
  function valueText(p) {
    const el = p.el;
    if (p.lib === 'element' && !p.multi) { const v = p.root.querySelector('.el-select__placeholder,.el-select__selected-item:not(.el-select__input-wrapper)'); return v && !v.matches('.is-transparent') ? textOf(v) : ''; }
    if (p.own) { const o = el.querySelector('[role=option][aria-selected=true]'), t = o ? optText(o) : ''; return !o || o.getAttribute('data-value') === '' || PH.test(t) ? '' : t; } // a list that is its own box (Google Forms)
    if (el.matches('[role=combobox]') && el.hasAttribute('data-placeholder')) return ''; // Radix shows its placeholder
    if (p.typed && !p.multi && p.input) return norm(p.input.value);
    const t = walk(p.valueRoot || el);
    return PH.test(t) ? '' : t; // "Select a person", "Choose…": a placeholder in the button's text
  }
  /* multi-select chips (react-select multiValue, MUI Chip, Ant selection items, ng-select values) and their text */
  const CHIP = /^(css-\w+-multiValue|[\w-]+__multi-value|MuiChip-root|ant-select-selection-item|ng-value|el-tag|v-chip)$/;
  const chips = (p) => [...(p.valueRoot || p.root).querySelectorAll('[class*="ultiValue"],[class*="multi-value"],.MuiChip-root,.ant-select-selection-item,.ng-value,.el-tag,.v-chip')]
    .filter((x) => [...x.classList].some((c) => CHIP.test(c)) && shown(x) && !(x.matches('.ant-select-selection-item,.ng-value') && !x.closest('.ant-select-multiple,.ant-select-tags,.ng-select-multiple')));
  const chipText = (c) => textOf(c.querySelector('.MuiChip-label,.ant-select-selection-item-content,.ng-value-label,[class*="multi-value__label"],.el-select__tags-text,.el-tag__content,.v-chip__content') || (c.matches('.ant-select-selection-item') ? c : c.firstElementChild) || c);
  function values(p) {
    const c = chips(p).map(chipText).filter(Boolean);
    if (c.length) return c;
    const t = valueText(p);
    return t ? (p.multi ? t.split(/\s*,\s*/) : [t]) : [];
  }
  const state = (p) => ({ text: valueText(p), values: values(p) });
  const same = (a, b) => { a = low(a); b = low(b); return !!a && !!b && (a === b || a.includes(b) || b.includes(a)); };

  /* ---------- comboboxes: the list ---------- */
  const LISTS = '[role=listbox],[role=menu],[role=tree],.ant-select-dropdown,.ng-dropdown-panel,.mat-mdc-select-panel,.mat-select-panel';
  const OPT = '[role=option],[role=menuitem],[role=menuitemradio],[role=menuitemcheckbox],[role=treeitem],.ant-select-item-option,mat-option,.ng-option';
  const OPT_OFF = '[aria-disabled=true],[data-disabled],.Mui-disabled,.ant-select-item-option-disabled,.ng-option-disabled,.mdc-list-item--disabled,.mat-option-disabled,.is-disabled,[disabled]';
  const SELECTED = '[aria-selected=true],[aria-checked=true],[data-state=checked],.Mui-selected,.ant-select-item-option-selected,.ng-option-selected,.mdc-list-item--selected,.mat-selected,.is-selected';
  const DANGER = /^\s*[+\uff0b]?\s*(create|add)\b|^\s*(delete|remove)\b|\b(create|add) new\b/i;
  const NOTICE = /^(no (options?|results?|matches?|data|items?|records?)( found)?|nothing found|loading|searching|type (to|for|a few|at least)|start typing|enter \d+ or more)/i;
  const PH = /^\s*(-+(\s|$)|-{2,}|—|select\b|choose\b|please (select|choose)\b|pick (a|an|one)\b)/i;
  const box = (x) => x && ((x.closest && x.closest('.ant-select-dropdown')) || x);
  const popups = (d) => deep(d, LISTS).filter(shown);
  function optNodes(list) {
    let xs = [...list.querySelectorAll(OPT)];
    if (list.matches('.ant-select-dropdown')) xs = xs.filter((x) => x.matches('.ant-select-item-option'));
    if (!xs.length) xs = [...list.querySelectorAll('[class*="__option"],[class*="-option"],li')];
    xs = xs.filter((x) => shown(x) && !(x.parentElement && x.parentElement.closest(OPT)));
    // a list that is its own box shows its choice in place and every option again in its popup: the popup's copy (the later one) counts
    return list.matches('[role=listbox][aria-expanded]') ? xs.filter((x, i) => !xs.slice(i + 1).some((y) => textOf(y) === textOf(x))) : xs;
  }
  const optText = (n) => textOf(n) || norm(n.getAttribute('aria-label') || n.getAttribute('title') || n.getAttribute('data-value'));
  const okList = (x) => x && x.isConnected && shown(x) && optNodes(x).length > 0;
  /* the list the widget names (aria-controls / aria-owns) */
  function namedList(p) {
    for (const n of [p.input, p.el, p.trigger, p.toggle]) for (const a of ['aria-controls', 'aria-owns']) for (const id of ids(n, a)) { const x = box(byId(n, id)); if (okList(x) && !x.contains(p.el)) return x; }
    return null;
  }
  function listOf(p, was) {
    if (p.own) return optNodes(p.el).length > 1 ? p.el : null; // its own options, more than the one it shows closed
    const named = namedList(p);
    if (named) return named;
    const fresh = popups(p.el.ownerDocument).filter((x) => !was.has(x) && !x.contains(p.el)).map(box).filter(okList);
    if (fresh.length) return fresh[fresh.length - 1];
    const m = p.lib === 'react-select' && [...p.root.querySelectorAll('[class*="-menu"],[class*="__menu"]')].find(okList);
    return m || null;
  }
  const expanded = (p) => { for (const n of [p.input, p.el, p.trigger]) { const a = n && n.getAttribute('aria-expanded'); if (a != null) return a === 'true'; } return null; };
  /* a list re-rendered while open (an option chosen leaves a multi-select's list) is looked up again */
  const isOpen = (p) => {
    const e = expanded(p);
    if (e === false) return false;
    if (p.list && !p.list.isConnected && !p.own) { const l = namedList(p); if (l) p.list = l; }
    return p.list ? shown(p.list) && (!p.own || optNodes(p.list).length > 1) : !!e;
  };
  async function open(p, was) {
    const now = () => listOf(p, was);
    let l = expanded(p) && now();
    if (l) return l;
    const tries = [p.toggle && (() => press(p.toggle)), () => press(p.trigger), () => { const t = p.input || p.el; focusIn(t); key(t, 'ArrowDown'); }].filter(Boolean);
    for (let i = 0; i < tries.length && !l; i++) {
      if (i && expanded(p)) break; // open, but its list is nowhere to be found
      await tries[i]();
      l = await until(now, i ? 400 : 600);
    }
    return l;
  }
  /* inside a dialog an Escape reaches the dialog too (React hands it to every handler up its tree, and MUI / antd dialogs close on it):
     there the list is closed by its own button, then by leaving it, and an Escape goes only to a list rendered outside the dialog */
  const DLG = 'dialog,[role=dialog],[role=alertdialog],[aria-modal=true],.MuiDialog-root,.MuiModal-root,.modal,.ant-modal-wrap,.ReactModal__Content';
  async function closeIn(p, dlg) {
    const d = p.el.ownerDocument, still = () => isOpen(p), t = p.toggle || (p.trigger !== p.input ? p.trigger : null);
    if (t && t.isConnected) { await press(t); if (await until(() => !still(), 250)) return true; }
    const f = deepActive(d);
    if (f && f !== d.body && (inside(p.root, f) || (p.list && inside(p.list, f)))) { focusOut(f); if (await until(() => !still(), 250)) return true; }
    if (p.list && p.list.isConnected && !inside(dlg, p.list)) { key(p.list, 'Escape'); if (await until(() => !still(), 200)) return true; }
    return !still();
  }
  async function close(p) {
    const d = p.el.ownerDocument, still = () => isOpen(p);
    if (!still()) return true;
    const dlg = p.root.closest(DLG);
    if (dlg) return closeIn(p, dlg);
    const a = deepActive(d), mine = a && (inside(p.root, a) || (p.list && inside(p.list, a))) ? a : null;
    for (const t of new Set([mine, p.list, p.input, p.el])) {
      if (!t || !t.isConnected) continue;
      key(t, 'Escape');
      if (await until(() => !still(), 200)) return true;
    }
    const f = deepActive(d);
    if (f && f !== d.body && (inside(p.root, f) || (p.list && inside(p.list, f)))) { focusOut(f); if (await until(() => !still(), 200)) return true; }
    if (expanded(p) !== true) return false;
    await press(p.toggle || p.trigger); // a list that takes no Escape: its own button again
    return !!(await until(() => !still(), 250));
  }
  /* a list that renders only the rows in view (Ant's rc-virtual-list, react-window): scrolled through once to read every option */
  function scroller(list, nodes) {
    for (let n = nodes[0] && nodes[0].parentElement; n && inside(list, n); n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if (n.scrollHeight > n.clientHeight + 4 && o !== 'visible') return n; // rc-virtual-list keeps overflow hidden and scrolls itself
      if (n === list) break;
    }
    return null;
  }
  async function readAll(p) {
    const read = () => optNodes(p.list).map((node) => ({ node, text: optText(node), dis: node.matches(OPT_OFF), sel: node.matches(SELECTED) }));
    let cur = read();
    const h = scroller(p.list, cur.map((o) => o.node)), sum = cur.reduce((s, o) => s + o.node.offsetHeight, 0);
    p.scroller = h;
    if (!h || !(p.list.querySelector('.rc-virtual-list') || h.scrollHeight > sum * 1.2 + 48)) return cur;
    const seen = new Map(), top0 = h.scrollTop, t0 = Date.now(), add = (xs) => xs.forEach((o) => { if (!seen.has(o.text)) seen.set(o.text, { ...o, at: h.scrollTop }); });
    const rows = () => optNodes(p.list).map(optText).join('\n');
    const to = async (y) => { const r0 = rows(), y0 = h.scrollTop; h.scrollTop = y; h.dispatchEvent(new Event('scroll')); if (h.scrollTop !== y0) await until(() => rows() !== r0, 200); };
    await to(0);
    add(read());
    for (let i = 0; i < 80 && Date.now() - t0 < 1500 && h.scrollTop + h.clientHeight < h.scrollHeight - 2; i++) {
      const was = h.scrollTop, n0 = seen.size;
      await to(was + Math.max(h.clientHeight * 0.9, 20));
      if (h.scrollTop === was) break;
      add(read());
      if (!i && seen.size === n0) break; // every row is rendered: not a virtual list
    }
    h.scrollTop = top0; h.dispatchEvent(new Event('scroll'));
    return [...seen.values()];
  }
  function keepOpt(o, i, raw, multi) {
    if (o.dis || DANGER.test(o.text) || NOTICE.test(o.text)) return false;
    if (raw) return true;
    return !!o.text && !PH.test(o.text) && o.node.getAttribute('data-value') !== '' && !(i === 0 && /^\s*none\s*$/i.test(o.text)) && !(multi && o.sel);
  }
  /* the option's node on screen now: scrolled to where it was seen, else searched for by typing its text */
  async function reach(p, want) {
    const find = () => optNodes(p.list).find((n) => optText(n) === want.text) || null;
    if (want.node.isConnected && optText(want.node) === want.text && shown(want.node)) return want.node;
    let n = find();
    if (n) return n;
    if (p.scroller && want.at != null) { p.scroller.scrollTop = want.at; p.scroller.dispatchEvent(new Event('scroll')); n = await until(find, 400); if (n) return n; }
    if (editable(p.input)) { typeIn(p.input, want.text); p.searched = true; n = await until(find, 600); }
    return n;
  }
  async function pickAt(pick, texts, info) {
    let i = -1;
    try { i = await pick(texts.slice(), info); } catch (e) { i = -1; }
    i = Number(i);
    return Number.isInteger(i) && i >= 0 && i < texts.length ? i : -1;
  }
  /* keyboard: ArrowDown until the option is the active descendant, then Enter */
  async function byKeys(p, node) {
    const t = p.input || p.el;
    if (!node.id) return;
    focusIn(t);
    for (let i = 0; i < 80 && t.getAttribute('aria-activedescendant') !== node.id; i++) { key(t, 'ArrowDown'); if (i % 10 === 9) await sleep(0); }
    if (t.getAttribute('aria-activedescendant') === node.id) key(t, 'Enter');
  }
  async function chooseCombo(entry, pick, o = {}) {
    const p = partsOf(entry.el), b = state(p), prev = { text: b.text, values: b.values, multi: !!p.multi }, v0 = p.input ? p.input.value : null;
    const fail = async (label) => { await close(p); if (p.input && p.input.value !== v0 && editable(p.input)) setText(p.input, v0); return { ok: false, prev, label: label || '' }; };
    const was = new Set(popups(p.el.ownerDocument)), q = pick.query ? String(pick.query) : '';
    p.list = await open(p, was);
    if (!p.list && !(q && editable(p.input) && expanded(p))) return fail();
    let all = p.list ? await readAll(p) : [];
    if (!all.some((x, i) => keepOpt(x, i, false, p.multi)) && q && editable(p.input)) { // nothing to choose until something is typed (async / search-only lists)
      typeIn(p.input, q);
      p.searched = true;
      const real = (x) => x && x.isConnected && optNodes(x).some((n) => !NOTICE.test(optText(n)));
      p.list = await until(() => (real(p.list) ? p.list : ((x) => (real(x) ? x : null))(listOf(p, was))), 1500);
      if (!p.list) return fail();
      all = await readAll(p);
    }
    if (!q && p.typed && editable(p.input) && p.input.value && all.length <= 1) { // a box that filters its list by the text it shows: emptied to see them all
      setText(p.input, '');
      p.searched = true;
      await until(() => { const x = p.list.isConnected ? p.list : listOf(p, was); return x && optNodes(x).length > 1 && (p.list = x); }, 400);
      all = await readAll(p);
    }
    if (p.list.closest('[aria-multiselectable=true],.is-multiple') || p.list.querySelector('[role=listbox][aria-multiselectable=true]')) p.multi = prev.multi = true;
    const opts = all.filter((x, i) => keepOpt(x, i, o.raw, p.multi && !o.raw));
    if (!opts.length) return fail();
    const i = await pickAt(pick, opts.map((x) => x.text), { label: entry.label, multi: p.multi });
    if (i < 0) return fail();
    const want = opts[i];
    if (!p.multi && want.sel && same(b.text, want.text)) { await close(p); return { ok: true, prev, label: want.text }; }
    const node = await reach(p, want);
    if (!node) return fail(want.text);
    const n0 = chips(p).length, done = () => {
      const s = state(p);
      if (o.empty) return !s.text;
      if (o.remove) return !s.values.some((v) => same(v, o.remove));
      return s.values.some((v) => same(v, want.text)) || same(s.text, want.text) || (!p.multi && !o.raw && !!s.text && s.text !== b.text);
    };
    await press(node);
    let ok = !!(await until(() => done() && (p.multi || !isOpen(p)), 600)) || done();
    if (!ok && !p.multi && node.isConnected && isOpen(p) && !node.matches(SELECTED)) { await byKeys(p, node); ok = !!(await until(done, 400)); }
    if (chips(p).length > n0) p.multi = prev.multi = true; // a chip appeared: a multi-select that didn't say so
    await close(p);
    if (p.searched && /^(react-select|antd|ng-select|element)$/.test(p.lib) && p.input.value && editable(p.input)) setText(p.input, ''); // a search text left behind
    return { ok: ok || done(), prev: { ...prev, added: want.text }, label: want.text };
  }

  /* ---------- radios, grids, toggles ---------- */
  const near = (n, sel) => { for (let x = n.parentElement, i = 0; x && i < 3; x = x.parentElement, i++) if (x.querySelectorAll(sel).length >= 2) return x; return n.parentElement; };
  const radiosIn = (g) => [...g.querySelectorAll('[role=radio]')].filter((x) => x.tagName !== 'INPUT' && shown(x));
  const rowLabel = (g) => nameOf(g) || textOf([...g.children].find((c) => !c.querySelector('[role=radio],[role=checkbox]') && !c.matches('[role=radio],[role=checkbox]'))) || '';
  function gridRows(el) {
    return [...el.querySelectorAll('[role=radiogroup],[role=group]')].filter((g) => !g.querySelector('[role=radiogroup],[role=group]')).map((g) => {
      const multi = !g.matches('[role=radiogroup]'), items = [...g.querySelectorAll(multi ? '[role=checkbox]' : '[role=radio]')].filter((x) => x.tagName !== 'INPUT' && shown(x));
      return { el: g, label: rowLabel(g), items, multi };
    }).filter((r) => r.items.length >= 2);
  }
  async function chooseRadio(entry, pick) {
    const all = radiosIn(entry.el), items = all.filter((x) => !off(x)), texts = items.map(itemText), was = all.findIndex((x) => isOn(x)), prev = { i: was, text: was >= 0 ? itemText(all[was]) : '' };
    const i = await pickAt(pick, texts, { label: entry.label });
    if (i < 0) return { ok: false, prev, label: '' };
    const t = items[i];
    if (!isOn(t)) await press(t);
    return { ok: !!(await until(() => isOn(t), 600)), prev, label: texts[i] };
  }
  async function chooseGrid(entry, pick) {
    const rows = gridRows(entry.el), prev = rows.map((r) => r.items.map((x) => !!isOn(x))), got = [];
    let tried = 0, ok = 0;
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k], texts = r.items.map(colText), i = await pickAt(pick, texts, { label: entry.label, row: r.label, index: k, multi: r.multi });
      if (i < 0) continue;
      const t = r.items[i];
      tried++;
      if (!isOn(t)) await press(t);
      if (await until(() => isOn(t), 600)) { ok++; got.push(`${r.label}: ${texts[i]}`); }
    }
    return { ok: tried > 0 && ok === tried, prev, label: got.join('; ') };
  }
  /* "Clear selection" (Google Forms, optional questions), in the languages forms are commonly made in */
  const CLEAR_TXT = /clear (selection|choice|response)|auswahl (löschen|entfernen|aufheben)|effacer (la )?sélection|borrar (la )?selección|limpar (a )?seleção|cancella (la )?selezione|wis selectie|seçimi temizle|清除所选|清除选择|選択を解除|선택 해제|очистить/i;
  const clearIn = (el) => { const q = question(el) || el.parentElement; return q ? [...q.querySelectorAll('[role=button],button')].find((b) => CLEAR_TXT.test(textOf(b) || b.getAttribute('aria-label'))) : null; };
  async function toggleIt(el, on) {
    const prev = isOn(el);
    if (prev === null || off(el)) return { ok: false, prev: !!prev };
    if (prev === !!on) return { ok: true, prev };
    await press(el);
    return { ok: !!(await until(() => isOn(el) === !!on, 600)), prev };
  }

  /* ---------- find ---------- */
  const CAND = '[role=combobox],[aria-haspopup=listbox],mat-select,ng-select,[role=listbox],[id^="react-select-"][id$="-input"],[class*="select__input"] input,input[class*="select__input"],input[aria-autocomplete],[role=checkbox],[role=switch],[role=radio]';
  function find(root) {
    root = root || document;
    const nodes = deep(root, CAND), pos = new Map(nodes.map((n, i) => [n, i])), out = [], taken = new Set();
    const lab = (n) => { const l = n.closest('label'), c = l && l.control; return !!c && /^(checkbox|radio)$/.test(c.type); }; // a native box does the work
    const ok = (n) => n.tagName !== 'INPUT' && !n.querySelector('input[type=checkbox],input[type=radio]') && !lab(n) && usable(n);
    // radios by group; checkbox rows (a Google Forms checkbox grid row is a role=group named after its row)
    const radios = new Map(), rows = new Map();
    for (const n of nodes) {
      if (!n.matches('[role=radio],[role=checkbox]') || !ok(n)) continue;
      if (n.matches('[role=radio]')) { const g = n.closest('[role=radiogroup]') || near(n, '[role=radio]'); if (!radios.has(g)) radios.set(g, []); radios.get(g).push(n); continue; }
      const g = n.closest('[role=group]');
      if (g && nameOf(g)) { if (!rows.has(g)) rows.set(g, []); rows.get(g).push(n); }
    }
    // grids: two or more rows with the same columns in one Google Forms question, or side by side under one parent, each row named
    const sig = (xs) => xs.map(colText).join('\u0001'), byBox = new Map();
    for (const [g, xs] of [...radios, ...rows]) {
      if (xs.length < 2) continue;
      const b = question(g) || (xs.every((x) => x.hasAttribute('data-value') || x.hasAttribute('data-answer-value')) ? g.parentElement : null);
      if (!b) continue;
      if (!byBox.has(b)) byBox.set(b, []);
      byBox.get(b).push({ g, xs });
    }
    for (const [b, rs] of byBox) {
      if (rs.length < 2 || !rs.every((r) => sig(r.xs) === sig(rs[0].xs) && rowLabel(r.g))) continue;
      if (rs.some((r) => r.g.matches('[role=radiogroup]')) && rs.some((r) => !r.g.matches('[role=radiogroup]'))) continue;
      rs.forEach((r) => { taken.add(r.g); r.xs.forEach((x) => taken.add(x)); });
      const label = heading(question(b)) || nameOf(b) || before(b), first = rs[0].xs[0];
      out.push({ at: pos.get(first), e: { el: b, kind: 'grid', lib: gforms(first) ? 'gforms' : libOf(first), root: b, label, required: isReq(b, ...rs.map((r) => r.g)) || starred(label),
        rows: rs.map((r) => ({ el: r.g, label: rowLabel(r.g), options: r.xs.map(colText), multi: !r.g.matches('[role=radiogroup]') })), hidden: [] } });
    }
    for (const [g, xs] of radios) {
      if (taken.has(g) || off(g) || xs.every(off)) continue;
      xs.forEach((x) => taken.add(x));
      const label = (nameOf(g) || (g.matches('[role=radiogroup]') && rowLabel(g)) || heading(question(g)) || fieldName(g, g)).slice(0, 200), on = xs.find((x) => isOn(x));
      out.push({ at: pos.get(xs[0]), e: { el: g, kind: 'radiogroup', lib: libOf(xs[0]), root: g, label, options: xs.map(itemText), value: on ? itemText(on) : '',
        required: isReq(g, ...xs) || starred(label), hidden: xs.flatMap(bubbles) } });
    }
    for (const n of nodes) {
      if (taken.has(n) || !n.matches('[role=checkbox],[role=switch]') || !ok(n) || off(n)) continue;
      taken.add(n);
      const sel = '[role=checkbox]', g = n.matches(sel) ? n.closest('[role=list],[role=group]') || near(n, sel) : null, group = g && g.querySelectorAll(sel).length >= 2 ? g : null;
      const glabel = group ? nameOf(group) || heading(question(group)) || '' : '', label = itemText(n);
      out.push({ at: pos.get(n), e: { el: n, kind: 'toggle', lib: libOf(n), root: n, label, checked: !!isOn(n), group, groupLabel: glabel,
        required: isReq(n, group) || starred(label) || starred(glabel) || (!!group && starred(heading(question(group)))), hidden: bubbles(n) } });
    }
    // comboboxes, typing boxes first: the button that opens a box's list is part of it (Headless UI ComboboxButton, downshift)
    const roots = [], combos = nodes.filter((n) => !taken.has(n) && !n.matches('[role=checkbox],[role=switch],[role=radio]'));
    for (const n of combos.filter((x) => x.tagName === 'INPUT').concat(combos.filter((x) => x.tagName !== 'INPUT'))) {
      if (taken.has(n) || roots.some((r) => inside(r, n))) continue;
      const e = ask(() => comboEntry(n));
      if (!e || roots.some((r) => inside(r, e.root) || inside(e.root, r))) continue;
      roots.push(e.root);
      if (e.el.tagName === 'INPUT') { const b = opener(e.el); if (b) taken.add(b); }
      out.push({ at: pos.get(n), e });
    }
    return out.sort((a, b) => a.at - b.at).map((x) => x.e);
  }

  /* ---------- the API: one widget at a time ---------- */
  let chain = Promise.resolve();
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  function choose(entry, pick) {
    return serial(async () => {
      if (!entry || !entry.el || !entry.el.isConnected || typeof pick !== 'function') return { ok: false, prev: null, label: '' };
      if (entry.kind === 'radiogroup') return chooseRadio(entry, pick);
      if (entry.kind === 'grid') return chooseGrid(entry, pick);
      if (entry.kind === 'toggle') { const r = await toggleIt(entry.el, true); return { ok: r.ok, prev: r.prev, label: itemText(entry.el) }; }
      return chooseCombo(entry, pick);
    });
  }
  const toggle = (el, on) => serial(() => (el && el.isConnected ? toggleIt(el, on) : { ok: false, prev: null }));
  async function restoreCombo(entry, prev) {
    const p = partsOf(entry.el), now = state(p), has = (v) => state(p).values.some((x) => same(x, v));
    if (p.multi || prev.multi) {
      if (!prev.added || !has(prev.added)) return true;
      const chip = chips(p).find((x) => low(chipText(x)) === low(prev.added)) || chips(p).find((x) => same(chipText(x), prev.added));
      const x = chip && chip.querySelector('[aria-label*="remove" i],[class*="multi-value__remove"],.MuiChip-deleteIcon,.ant-select-selection-item-remove,.ng-value-icon,.el-tag__close,.v-chip__close,[aria-label*="delete" i],[class*="remove" i],[class*="delete" i]');
      if (x) { await press(x); if (await until(() => !has(prev.added), 600)) { await close(p); return true; } }
      await chooseCombo(entry, (t) => t.findIndex((s) => low(s) === low(prev.added)), { raw: true, remove: prev.added });
      return !has(prev.added);
    }
    if (low(now.text) === low(prev.text)) return true;
    if (p.free && p.input) { // an option of that text, else the text typed back
      if (prev.text) await chooseCombo(entry, (t) => t.findIndex((s) => low(s) === low(prev.text)), { raw: true });
      if (low(valueText(p)) !== low(prev.text)) { setText(p.input, prev.text); await close(p); }
      return low(valueText(p)) === low(prev.text);
    }
    if (!prev.text) {
      const c = p.root.querySelector('.ant-select-clear,.MuiAutocomplete-clearIndicator,.ng-clear-wrapper,[class*="__clear-indicator"],[class*="clearIndicator"],[aria-label^="clear" i],[title^="clear" i]')
        || (p.lib === 'react-select' && ((xs) => (xs.length >= 2 ? xs[0] : null))([...p.trigger.querySelectorAll('[class*="-indicatorContainer"]')]));
      if (c) { await press(c); if (await until(() => !valueText(p), 600)) { await close(p); return true; } }
      if (p.typed && p.input) { setText(p.input, ''); await close(p); focusOut(p.input); await sleep(60); return !valueText(p); } // the box cleared (Headless UI sets null)
      if (/^(antd|react-select|ng-select|element|vuetify)$/.test(p.lib)) return false; // their placeholder is no option
      await chooseCombo(entry, (t) => t.findIndex((s, i) => !s || PH.test(s) || (i === 0 && /^\s*none\s*$/i.test(s))), { raw: true, empty: true });
      return !valueText(p);
    }
    await chooseCombo(entry, (t) => { const i = t.findIndex((s) => low(s) === low(prev.text)); return i >= 0 ? i : t.findIndex((s) => same(s, prev.text)); }, { raw: true });
    return same(valueText(p), prev.text);
  }
  function restore(entry, prev) {
    return serial(async () => {
      try {
        if (!entry || !entry.el || !entry.el.isConnected || prev == null) return false;
        if (entry.kind === 'toggle') return (await toggleIt(entry.el, typeof prev === 'object' ? !!prev.prev : !!prev)).ok;
        if (entry.kind === 'radiogroup') {
          const items = radiosIn(entry.el), now = items.findIndex((x) => isOn(x));
          let i = prev.text ? items.findIndex((x) => itemText(x) === prev.text) : -1;
          if (i < 0) i = prev.i;
          if (now === i) return true;
          if (i >= 0 && items[i]) { await press(items[i]); return !!(await until(() => isOn(items[i]), 600)); }
          const c = clearIn(entry.el);
          if (c) { await press(c); return !!(await until(() => !radiosIn(entry.el).some((x) => isOn(x)), 600)); }
          return false;
        }
        if (entry.kind === 'grid') {
          const rows = gridRows(entry.el);
          let ok = true, clear = false;
          for (let k = 0; k < rows.length; k++) {
            const r = rows[k], want = prev[k] || [];
            if (r.multi) { for (let j = 0; j < r.items.length; j++) if (!!isOn(r.items[j]) !== !!want[j]) ok = (await toggleIt(r.items[j], !!want[j])).ok && ok; continue; }
            const j = want.indexOf(true);
            if (j >= 0) { if (!isOn(r.items[j])) { await press(r.items[j]); ok = !!(await until(() => isOn(r.items[j]), 600)) && ok; } } else if (r.items.some((x) => isOn(x))) clear = true;
          }
          if (clear) {
            const c = clearIn(entry.el);
            if (!c) return false;
            await press(c);
            await until(() => gridRows(entry.el).every((r, k) => r.multi || r.items.every((x, j) => !!isOn(x) === !!(prev[k] || [])[j])), 600);
            for (let k = 0; k < rows.length; k++) { const r = gridRows(entry.el)[k], j = (prev[k] || []).indexOf(true); if (r && !r.multi && j >= 0 && !isOn(r.items[j])) await press(r.items[j]); }
            ok = gridRows(entry.el).every((r, k) => r.items.every((x, j) => !!isOn(x) === !!(prev[k] || [])[j])) && ok;
          }
          return ok;
        }
        return await restoreCombo(entry, prev);
      } catch (e) { return false; }
    });
  }

  X.widgets = { v: VERSION, find, choose, toggle, restore };
})();
