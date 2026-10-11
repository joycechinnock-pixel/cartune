"""Art checks (v6, updated v8) shared by the browser tests (no extra Python packages: pixels are read back in the page).

art_loaded(page)            -> {slot: {url: bool, w: naturalWidth, id: fingerprint}} for the hero banner, page wall,
                               section piece, spray rule, card peel, card tag scribble and footer mural (each must be
                               a data: URL that decodes), plus heroBox (the header) and heroArt (the art area, ::before).
contrast(page, containers)  -> [(label, text, ratio, need)] for every visible text run inside the containers:
                               text is made transparent, the area behind it is screenshotted, and the text colour is
                               compared with the 5th and 95th percentile of the background (worst case).
                               need = 3.0 for large text (>= 24 px, or >= 18.66 px bold), else 4.5 (WCAG AA).
"""
import base64

ART_LOAD_JS = r"""async () => {
  const pick = (el, ps, props) => { if (!el) return null; const cs = getComputedStyle(el, ps);
    for (const p of props) { const m = (cs[p] || '').match(/url\("?(data:image\/[a-z]+;base64,[^")]+)"?\)/); if (m) return m[1]; } return null; };
  const decode = (u) => new Promise(r => { if (!u) return r(0); const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(-1); i.src = u; });
  const q = (s) => document.querySelector(s), bg = ['backgroundImage'], mk = ['maskImage', 'webkitMaskImage'];
  const items = { hero: [q('#top'), '::before', bg], page: [document.body, null, bg], section: [q('#home>h2'), '::after', bg],
    rule: [q('#home>h2'), '::before', bg], card_peel: [q('#hero'), null, bg], card_tags: [q('#grid .tile'), '::after', mk], footer: [q('.wrap'), '::after', bg] };
  const out = {};
  for (const [k, [el, ps, props]] of Object.entries(items)) { const u = pick(el, ps, props); out[k] = { url: !!u, w: await decode(u), id: u ? u.length + ':' + u.slice(-24) : null }; }
  const r = q('#top').getBoundingClientRect(); out.heroBox = [Math.round(r.width), Math.round(r.height)];
  const b = getComputedStyle(q('#top'), '::before'); out.heroArt = [Math.round(parseFloat(b.width)), Math.round(parseFloat(b.height))];
  return out;
}"""

RUNS_JS = r"""(sel) => {
  const box = document.querySelector(sel); if (!box || !box.offsetParent) return null;
  box.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90);
  const runs = [], vh = innerHeight, vw = innerWidth;
  const walk = (el) => {
    if (el.closest('[hidden]') || getComputedStyle(el).visibility === 'hidden') return;
    // content of a closed <details> isn't painted (Chrome still reports layout boxes for it), so it isn't measured
    const dt = el.closest('details'); if (dt && !dt.open && !el.closest('summary')) return;
    const texts = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    // clip to the viewport and to every scrolling / overflow-hidden ancestor (lines scrolled out of a log aren't on screen)
    let cl = { l: 0, t: 0, r: vw, b: vh };
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const q = a.getBoundingClientRect();
        cl = { l: Math.max(cl.l, q.left), t: Math.max(cl.t, q.top), r: Math.min(cl.r, q.right), b: Math.min(cl.b, q.bottom) }; }
    }
    if (texts.length) {
      const rg = document.createRange(); rg.setStartBefore(texts[0]); rg.setEndAfter(texts[texts.length - 1]);
      for (const r of rg.getClientRects()) {
        if (r.width < 4 || r.height < 6 || r.top < cl.t - 0.5 || r.bottom > Math.min(cl.b + 0.5, vh) || r.left < cl.l - 0.5 || r.right > Math.min(cl.r + 0.5, vw)) continue;
        const cs = getComputedStyle(el), fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight) || 400;
        runs.push({ x: r.left, y: r.top, w: r.width, h: r.height, color: cs.color, large: fs >= 24 || (fs >= 18.66 && fw >= 700),
                    label: (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '')),
                    text: texts.map(t => t.textContent.trim()).join(' ').slice(0, 40) });
      }
    }
    for (const c of el.children) walk(c);
  };
  walk(box);
  box.classList.add('__ct');
  if (!document.getElementById('__ctcss')) { const st = document.createElement('style'); st.id = '__ctcss';
    st.textContent = '.__ct,.__ct *{color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;caret-color:transparent!important}'; document.head.appendChild(st); }
  return runs;
}"""

MEASURE_JS = r"""async ([png, runs, dpr, sel]) => {
  document.querySelector(sel).classList.remove('__ct');
  const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + png; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const cr = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return runs.map(u => {
    const m = u.color.match(/[\d.]+/g).map(Number); const tl = L(m[0], m[1], m[2]);
    const x = Math.max(0, Math.round(u.x * dpr)), y = Math.max(0, Math.round(u.y * dpr));
    const w = Math.max(1, Math.min(img.width - x, Math.round(u.w * dpr))), h = Math.max(1, Math.min(img.height - y, Math.round(u.h * dpr)));
    const d = cx.getImageData(x, y, w, h).data, ls = [];
    for (let i = 0; i < d.length; i += 4) ls.push(L(d[i], d[i + 1], d[i + 2]));
    ls.sort((a, b) => a - b);
    const p5 = ls[Math.floor(ls.length * 0.05)], p95 = ls[Math.floor(ls.length * 0.95)];
    return [u.label, u.text, Math.round(Math.min(cr(tl, p5), cr(tl, p95)) * 100) / 100, u.large ? 3 : 4.5];
  });
}"""

def art_loaded(page):
    return page.evaluate(ART_LOAD_JS)

def contrast(page, containers, dpr=1):
    out = []
    for sel in containers:
        runs = page.evaluate(RUNS_JS, sel)
        if not runs:
            continue
        page.wait_for_timeout(60)
        png = base64.b64encode(page.screenshot()).decode()
        for r in page.evaluate(MEASURE_JS, [png, runs, dpr, sel]):
            out.append((sel,) + tuple(r))
    return out
