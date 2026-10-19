/*!
 * FormGhost - https://github.com/mahtoaman/formghost
 * Copyright 2026 Aman Mahto (@mahtoaman)
 * Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
 */
/* FormGhost: which "site" a URL belongs to (one identity per site) and blocklist matching. Pure: no chrome.* APIs. */
(function (G) {
  const S = (str) => new Set(str.split(','));
  // Hosting suffixes where every subdomain is a different owner's app
  const PRIVATE = S('vercel.app,vercel.dev,netlify.app,github.io,herokuapp.com,pages.dev,workers.dev,web.app,firebaseapp.com,onrender.com,fly.dev,railway.app,up.railway.app,azurewebsites.net,cloudfront.net,appspot.com,glitch.me,repl.co,replit.app,replit.dev,ngrok.io,ngrok-free.app,ngrok.app,loca.lt,trycloudflare.com,surge.sh,csb.app,stackblitz.io,webcontainer.io,amplifyapp.com,lovable.app');
  const MULTI = S('co.in,org.in,net.in,gov.in,ac.in,edu.in,res.in,nic.in,co.uk,org.uk,ac.uk,gov.uk,com.au,net.au,org.au,edu.au,gov.au,co.nz,com.br,com.pk,com.bd,co.za,com.sg,com.my,co.jp,ne.jp,com.mx,com.ar,com.tr,co.id,com.cn,com.hk,com.tw,co.kr,ae.org');

  // URL when the host has it; a plain parser otherwise (bare vm contexts in tests)
  function split(url) {
    if (typeof G.URL === 'function') { try { return new G.URL(url); } catch (e) { return null; } }
    const m = String(url).match(/^([a-z][a-z\d+.-]*:)\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)(?::(\d*))?([^?#]*)/i);
    if (!m) return null;
    const protocol = m[1].toLowerCase(), port = m[3] && !({ 'http:': '80', 'https:': '443' }[protocol] === String(+m[3])) ? String(+m[3]) : '';
    return { protocol, hostname: m[2].toLowerCase(), port, pathname: m[4] || '/' };
  }
  const parse = (url) => { const u = split(url); return u && /^(https?|file):$/.test(u.protocol) ? u : null; };
  const bare = (h) => h.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const isLocal = (h) => /^\[.*\]$/.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /(^|\.)(localhost|local)$/.test(h);
  const withPort = (h, u) => h + (u.port ? ':' + u.port : '');

  // example.com, shop.example.co.in → example.co.in, my-app-git-x.vercel.app, localhost:3000, file
  function siteKey(url) {
    const u = parse(url);
    if (!u) return '';
    if (u.protocol === 'file:') return 'file';
    const h = bare(u.hostname);
    if (!h) return '';
    if (isLocal(h)) return withPort(h, u);
    const p = h.split('.');
    for (let i = 1; i < p.length; i++) if (PRIVATE.has(p.slice(i).join('.'))) return p.slice(i - 1).join('.');
    return p.slice(p.length > 2 && MULTI.has(p.slice(-2).join('.')) ? -3 : -2).join('.');
  }

  const hostKey = (url) => { const u = parse(url); return u && u.protocol !== 'file:' && u.hostname ? withPort(bare(u.hostname), u) : ''; };

  /* Entries: 'host', 'host:port' or 'host/path-prefix' match that exact host only (www. ignored);
     '*.host' matches the host and all its subdomains. A scheme in front is ignored. */
  function parseEntry(e) {
    const m = typeof e === 'string' && e.trim().replace(/^[a-z]+:\/\//i, '').match(/^(\*\.)?(\[[^\]\s]+\]|[^\s:/*?#@]+)(?::(\d+))?(\/\S*)?$/);
    return m ? { wild: !!m[1], host: bare(m[2]), port: m[3] ? String(+m[3]) : '', path: m[4] && m[4] !== '/' ? m[4] : '' } : null;
  }
  // 'https://WWW.Shop.com/' → 'shop.com'; '' when it isn't an entry
  const normEntry = (e) => { const x = parseEntry(e); return x && x.host ? (x.wild ? '*.' : '') + x.host + (x.port ? ':' + x.port : '') + x.path : ''; };

  function matchEntry(url, entries) {
    const u = parse(url);
    if (!u || u.protocol === 'file:' || !Array.isArray(entries)) return null;
    const h = bare(u.hostname), port = u.port || (u.protocol === 'https:' ? '443' : '80');
    return entries.find((e) => {
      const x = parseEntry(e);
      return !!x && !!x.host && (h === x.host || (x.wild && h.endsWith('.' + x.host))) && (!x.port || x.port === port) && (!x.path || u.pathname.startsWith(x.path));
    }) || null;
  }

  // The entries that name this exact page ('Turn on here' removes only these): never a '*.' entry of a parent domain
  function exactEntries(url, entries) {
    const u = parse(url), h = u ? bare(u.hostname) : '';
    return (Array.isArray(entries) ? entries : []).filter((e) => { const x = parseEntry(e); return !!matchEntry(url, [e]) && (!x.wild || x.host === h); });
  }

  // A rule's site: '' = every site, else this page's site key ('example.com' covers shop.example.com) or a blocklist-style entry
  const inSite = (url, s) => !s || (!!parse(url) && (siteKey(url) === s || !!matchEntry(url, [s])));

  G.FG_SITE = { siteKey, hostKey, matchEntry, exactEntries, normEntry, parseEntry, inSite };
})(typeof globalThis !== 'undefined' ? globalThis : self);
