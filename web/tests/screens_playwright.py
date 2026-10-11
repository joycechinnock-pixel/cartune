"""Visual pass over the Street Kit skin: screenshots + layout checks at desktop 1440 and phone 400.

    python web/tests/screens_playwright.py --url file:///…/CarTune-App.html --out screenshots/v3 [--chrome /usr/bin/google-chrome]

For every tab and every Diagnostics sub-tab, in Night and Sun, at both widths it checks:
no console errors and no horizontal scroll (document scrollWidth <= viewport width).
It also reports buttons/chips/inputs smaller than 44 px (the skin targets 48 px).
v5 adds: tune page with the new tabs, 'Fix it with other settings', switches
(lift cover), a filed user tune, emissions switches + user agreement, flash
gates, the vehicle picker (type, make, confirm) and Home with your own tunes.
v6 adds: the street-art artwork loads (hero mural, page wall, section pieces, spray rule,
card peel, tag scribbles, footer mural) and every text run over it keeps WCAG AA
contrast (text hidden, background sampled, worst of 5th/95th percentile), written to
contrast-<width>-<theme>.json; shots 19-28 show the art in both themes at both widths.
v8: the art is the owner's own (A = CARTUNE banners as the hero: night banner in Night, sun banner
in Sun, fiery banner on the Tune page; B = the line-up mural everywhere else); shots 29-30 show the
fiery Tune-page hero and the Flash sheet strip, and the Flash sheet joins the contrast pass.
v9: art boxes have to fit. The hero banner's box matches the banner's own shape (no crop, no stretch),
section slices stay contained in their heading, the footer and the flash strip stay inside the page,
and the header is never wider than the viewport. The same checks run at 1024, 768 and 360 as well as
1440 and 400.
v10: phone Home (up to 700 px) has its own 4:3 mural, checked whole at 320-700; extra widths 320 and 700.
"""
import argparse, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from art_checks import art_loaded, contrast
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True); ap.add_argument("--out", required=True); ap.add_argument("--chrome", default=None)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
problems = []
SMALL_JS = """() => [...document.querySelectorAll('button,select,input:not([type=range]):not([type=checkbox]):not([type=radio]),summary,.chip,.navbtn')]
  .filter(e => e.offsetParent && !e.closest('[hidden]')).map(e => [e, e.getBoundingClientRect()])
  .filter(([e, r]) => r.height < 44 && !e.classList.contains('link')).map(([e, r]) => (e.id || e.className || e.tagName) + ':' + Math.round(r.height)).slice(0, 12)"""

def settle(pg, ms=250): pg.evaluate("document.getElementById('toast').classList.remove('show')"); pg.wait_for_timeout(ms)
FIT_JS = r"""() => {
  const probs = [];
  const vw = innerWidth;
  const sun = document.documentElement.getAttribute('data-theme') === 'sun';
  const shown = (id) => { const el = document.getElementById(id); return !!(el && !el.hidden); };
  const top = document.getElementById('top');
  if (top) {
    const r = top.getBoundingClientRect();
    if (r.width > vw + 1) probs.push('header wider than the page (' + Math.round(r.width) + '>' + vw + ')');
    for (const c of top.children) {
      const cr = c.getBoundingClientRect();
      if (cr.width > 8 && (cr.right > r.right + 2 || cr.left < r.left - 2)) probs.push('header control sticks out: ' + (c.id || c.className));
    }
    const b = getComputedStyle(top, '::before');
    const bw = parseFloat(b.width), bh = parseFloat(b.height);
    if (bw > r.width + 2) probs.push('header art wider than the header');
    if (shown('home') && vw <= 700 && bh > 8) {
      // v10 phone Home mural: 4:3, drawn whole (contain) in a box min(vw,600) wide
      const want = Math.min(vw, 600) * 0.75;
      if (Math.abs(bh - want) > 2) probs.push('phone mural box ' + Math.round(bh) + 'px tall, want ' + Math.round(want));
      if (!/contain/.test(b.backgroundSize)) probs.push('phone mural not drawn whole (' + b.backgroundSize + ')');
      if (!/hero|data:image/.test(b.backgroundImage)) probs.push('phone mural missing');
    } else if ((shown('home') || shown('detail')) && bh > 8) {
      const phone = vw <= 620;
      const expect = shown('detail') ? (phone ? 890/198 : 2103/198) : sun ? (phone ? 820/243 : 2103/243) : (phone ? 980/293 : 2103/293);
      const ar = bw / bh;
      if (Math.abs(ar - expect) / expect > 0.035) probs.push('banner box ' + ar.toFixed(2) + ' != art ' + expect.toFixed(2));
    }
  }
  for (const sel of ['#home>h2','#capture>h2','#diag>h2','#spec>h2','.dhead']) {
    const el = document.querySelector(sel);
    if (!el || !el.offsetParent) continue;
    const er = el.getBoundingClientRect();
    if (er.right > vw + 2 || er.left < -2) probs.push(sel + ' wider than the page');
    const a = getComputedStyle(el, '::after');
    if (a.backgroundImage.startsWith('url') && a.backgroundSize !== 'contain') probs.push(sel + ' slice not contained (' + a.backgroundSize + ')');
  }
  const foot = getComputedStyle(document.querySelector('.wrap'), '::after');
  if (parseFloat(foot.width) > vw + 2) probs.push('footer art wider than the page');
  if ((foot.backgroundSize || '').startsWith('auto')) probs.push('footer art leaves gaps (' + foot.backgroundSize + ')');
  const sheet = document.getElementById('sheet');
  if (sheet && sheet.offsetParent) {
    const sr = sheet.getBoundingClientRect();
    const b = getComputedStyle(sheet, '::before');
    const bw = parseFloat(b.width), bh = parseFloat(b.height);
    if (b.backgroundImage.startsWith('url') && bh > 8 && bw > sr.width + 16) probs.push('sheet art wider than the sheet');
    if (document.getElementById('confirm') || document.getElementById('fb') || document.getElementById('done')) {
      if (bh > 8) {
        const ar = bw / bh, expect = 890/198;
        if (Math.abs(ar - expect) / expect > 0.04) probs.push('flash strip ' + ar.toFixed(2) + ' != banner ' + expect.toFixed(2));
      }
    }
  }
  const sc = document.getElementById('scOut');
  if (sc && sc.offsetParent && sc.scrollWidth > sc.clientWidth + 3) probs.push('empty-state art overflows the scan result');
  return probs;
}"""

def overflow(pg, tag):
    sw, vw = pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    if sw > vw: problems.append(f"{tag}: horizontal scroll {sw}>{vw}")
    for msg in pg.evaluate(FIT_JS): problems.append(f"{tag}: {msg}")
    small = pg.evaluate(SMALL_JS)
    if small: print(f"  small targets @ {tag}: {small}")

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": a.chrome} if a.chrome else {}))
    for name, vp, dpr in [("desktop", {"width": 1440, "height": 900}, 1), ("phone", {"width": 400, "height": 860}, 2)]:
        ctx = b.new_context(viewport=vp, device_scale_factor=dpr, has_touch=name == "phone", is_mobile=name == "phone")
        pg = ctx.new_page(); errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None); pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(a.url)
        pg.wait_for_function("() => typeof S !== 'undefined' && S.conn === 'on' && S.backup >= 100", timeout=20000); settle(pg, 400)
        for theme in ("night", "sun"):
            pg.evaluate(f"setTheme('{theme}')"); settle(pg)
            pg.evaluate("S.view='home';S.tab='home';render();window.scrollTo(0,0)"); settle(pg)
            overflow(pg, f"{name}/{theme}/home")
            pg.screenshot(path=f"{a.out}/{name}-{theme}-01-home.png")
            # close-ups of the photo header + the Tunes feature banner
            pg.locator("#top").screenshot(path=f"{a.out}/{name}-{theme}-00-header-closeup.png")
            pg.locator("#home>h2").screenshot(path=f"{a.out}/{name}-{theme}-00-tunes-banner.png")
            if theme == "night":
                pg.click("#settingsBtn"); settle(pg, 400); overflow(pg, f"{name}/{theme}/settings")
                pg.screenshot(path=f"{a.out}/{name}-{theme}-10-settings.png"); pg.evaluate("closeSheet()"); settle(pg)
            pg.click("#pill"); settle(pg, 400); overflow(pg, f"{name}/{theme}/connect")
            if theme == "night": pg.screenshot(path=f"{a.out}/{name}-{theme}-02-connect.png")
            pg.evaluate("closeSheet()")
            pg.locator("#grid .tile").nth(2).click(); settle(pg); overflow(pg, f"{name}/{theme}/detail")
            if theme == "night": pg.screenshot(path=f"{a.out}/{name}-{theme}-03-tune-detail.png")
            pg.evaluate("S.view='home';render()")
            for t in ("capture", "spec", "diag"):
                pg.evaluate(f"S.tab='{t}';render();window.scrollTo(0,0)"); settle(pg); overflow(pg, f"{name}/{theme}/{t}")
            for s in pg.evaluate("SUBS.map(s=>s[0])"):
                pg.evaluate(f"setSub('{s}');window.scrollTo(0,0)"); settle(pg, 120); overflow(pg, f"{name}/{theme}/diag:{s}")
            # battery (auto-fill from the demo car) = diagnostics screenshot
            pg.evaluate("setSub('battery');window.scrollTo(0,0)"); pg.click("#bRead")
            pg.wait_for_function("() => /ATRV/.test(document.getElementById('bOut').textContent)", timeout=8000); settle(pg)
            pg.screenshot(path=f"{a.out}/{name}-{theme}-04-diagnostics-battery.png")
            # DTC scan
            pg.evaluate("setSub('scan');window.scrollTo(0,0)"); settle(pg)
            if theme == "night":
                pg.screenshot(path=f"{a.out}/{name}-{theme}-05-dtc-scan-before.png")
                pg.locator("#scOut").screenshot(path=f"{a.out}/{name}-{theme}-05b-scan-empty-sticker.png")
            pg.click("#scRead"); pg.wait_for_function("() => DG.scan && !document.getElementById('scRead').disabled", timeout=8000); settle(pg)
            pg.click("#scFf"); pg.wait_for_function("() => DG.ff && !document.getElementById('scFf').disabled", timeout=8000); settle(pg)
            overflow(pg, f"{name}/{theme}/scan-read")
            pg.screenshot(path=f"{a.out}/{name}-{theme}-06-dtc-scan.png")
            if theme == "night": pg.locator("#scOut").screenshot(path=f"{a.out}/{name}-{theme}-06b-scan-result.png")
            if theme == "night":
                pg.click("#scClr"); settle(pg, 400); pg.screenshot(path=f"{a.out}/{name}-{theme}-07-clear-codes-gate.png"); pg.click("#clrNo"); settle(pg)
            # live dashboard with values
            pg.evaluate("setSub('live');window.scrollTo(0,0)"); settle(pg)
            if not pg.evaluate("S.live.running"): pg.click("#lvGo")
            pg.wait_for_function("() => S.live.rows.length >= 2", timeout=15000); settle(pg, 300)
            overflow(pg, f"{name}/{theme}/live-running")
            pg.screenshot(path=f"{a.out}/{name}-{theme}-08-live-dashboard.png")
            if theme == "night": pg.locator(".panel:has(#lvGo)").screenshot(path=f"{a.out}/{name}-{theme}-08b-live-panel.png")
            pg.click("#lvGo"); settle(pg, 400)
            pg.evaluate("setSub('report');window.scrollTo(0,0)"); settle(pg)
            if theme == "night":
                pg.screenshot(path=f"{a.out}/{name}-{theme}-09-report.png")
                pg.locator(".panel:has(#rpOpen)").screenshot(path=f"{a.out}/{name}-{theme}-09b-report-panel.png")
            # ---- v5: new tabs, fix-it, switches, emissions agreement, flash gates, picker, your tunes ----
            def shot5(tag):
                overflow(pg, f"{name}/{theme}/{tag}")
                pg.screenshot(path=f"{a.out}/{name}-{theme}-{tag}.png")
            def to_detail(pid, seg=None):
                pg.evaluate(f"S.tab='home';S.skill='standard';store.set('skill','standard');closeSheet();openPreset('{pid}')"); settle(pg)
                if seg: pg.locator(f'#tabs .tab[data-seg="{seg}"]').click(); settle(pg)
            pg.evaluate("S.agreed=false;store.set('agreed',false);S.user={};saveUser();S.guard={}")
            to_detail("sport", "Throttle")
            pg.evaluate("document.getElementById('tabs').scrollIntoView({block:'start'});window.scrollBy(0,-120)"); settle(pg)
            shot5("11-tune-new-tabs")
            to_detail("race")
            for seg in pg.eval_on_selector_all("#tabs .tab", "els => els.map(e => e.dataset.seg)"):
                pg.locator(f'#tabs .tab[data-seg="{seg}"]').click(); settle(pg, 120)
                if pg.locator(".fixes.ofx .fix").count(): break
            pg.evaluate("document.querySelector('.fixes.ofx').closest('.card').scrollIntoView({block:'start'});window.scrollBy(0,-70)"); settle(pg)
            shot5("12-fix-it-suggestions")
            to_detail("factory", "Brakes & Traction")
            pg.evaluate("document.getElementById('swHead').scrollIntoView({block:'start'});window.scrollBy(0,-20)"); settle(pg)
            shot5("13-switches-lift-cover")
            pg.locator('[data-cover="t_esc"]').click(); settle(pg, 120); pg.locator('#sws [data-sw="t_esc"]').click(); settle(pg)
            pg.evaluate("window.scrollTo(0,0)"); settle(pg)
            pg.evaluate("document.getElementById('filed').scrollIntoView({block:'start'});window.scrollBy(0,-90)"); settle(pg)
            shot5("14-filed-user-tune")
            pg.evaluate("document.getElementById('swHead').scrollIntoView({block:'start'});window.scrollBy(0,-20)"); settle(pg)
            shot5("14b-switch-changed")
            pg.locator('#tabs .tab[data-seg="Emissions"]').click(); settle(pg)
            pg.evaluate("document.getElementById('swHead').scrollIntoView({block:'start'});window.scrollBy(0,-20)"); settle(pg)
            shot5("15-emissions-switches")
            pg.locator('#sws [data-sw="t_cat_mon"]').click(); settle(pg, 350)
            shot5("15b-emissions-agreement")
            pg.click("#agYes"); settle(pg)
            pg.evaluate("openFlash()"); settle(pg, 350)
            shot5("16-flash-gates")
            pg.evaluate("closeSheet();history.back()"); settle(pg, 350)
            pg.evaluate("openPicker()"); settle(pg, 300); shot5("17-vehicle-picker-type")
            pg.locator('#ptiles .ptile[data-key="car"]').click(); settle(pg, 250); shot5("17b-vehicle-picker-make")
            pg.fill("#pq", "Ford"); pg.locator('#ptiles .ptile[data-key="Ford"]').click(); settle(pg, 150)
            pg.locator('#ptiles .ptile[data-key="Ranger"]').click(); settle(pg, 150)
            pg.locator('#ptiles .ptile[data-key="PX2 / PX3"]').click(); settle(pg, 150)
            pg.locator('#ptiles .ptile[data-key="3.2 turbo diesel"]').click(); settle(pg, 150)
            pg.locator('#ptiles .ptile[data-key="6-speed auto"]').click(); settle(pg, 300); shot5("17c-vehicle-confirm")
            pg.evaluate("closeSheet();S.view='home';S.tab='home';render();window.scrollTo(0,0)"); settle(pg)
            pg.evaluate("document.getElementById('grid').scrollIntoView({block:'start'});window.scrollBy(0,-60)"); settle(pg)
            shot5("18-home-presets")
            pg.evaluate("document.getElementById('mine').scrollIntoView({block:'start'});window.scrollBy(0,-40)"); settle(pg)
            shot5("18b-home-your-tunes")
            pg.evaluate("S.skill='simple';store.set('skill','simple');S.agreed=false;store.set('agreed',false);window.scrollTo(0,0)")
            # ---- v6: street-art artwork loads, reads, and text over it keeps WCAG AA ----
            def shot6(tag):
                overflow(pg, f"{name}/{theme}/{tag}"); settle(pg, 200)
                pg.screenshot(path=f"{a.out}/{name}-{theme}-{tag}.png")
            pg.evaluate("closeSheet();S.view='home';S.tab='home';render();window.scrollTo(0,0)"); settle(pg, 300)
            art = art_loaded(pg)
            for k in ("hero", "page", "section", "rule", "card_peel", "card_tags", "footer"):
                if not (art[k]["url"] and art[k]["w"] > 0): problems.append(f"{name}/{theme}: art '{k}' missing or not decoding {art[k]}")
            shot6("19-home-hero")
            pg.locator("#top").screenshot(path=f"{a.out}/{name}-{theme}-19b-hero-mural-closeup.png")
            pg.evaluate("document.getElementById('grid').scrollIntoView({block:'start'});window.scrollBy(0,-230)"); shot6("20-art-section-header-tiles")
            pg.evaluate("window.scrollTo(0,document.body.scrollHeight)"); shot6("21-art-footer-mural")
            results = []
            def ct(tab, containers):
                results.extend((tab,) + r for r in contrast(pg, containers, dpr))
            ct("home", ["#top .brand", "#hero", ".oncar", "#home>h2", "#grid .tile:nth-child(1)", "#grid .tile:nth-child(2)", "#grid .tile:nth-child(3)", "#grid .tile:nth-child(9)", "#demoNote"])
            pg.evaluate("S.tab='capture';render();window.scrollTo(0,0)"); settle(pg); shot6("22-art-live-data")
            ct("capture", ["#top .brand", "#capture>h2", "#capture .panel"])
            pg.evaluate("S.tab='spec';render();window.scrollTo(0,0)"); settle(pg); shot6("23-art-tune-spec")
            ct("spec", ["#spec>h2", "#spec .card", "#spec .sgroup"])
            pg.evaluate("S.tab='diag';render();setSub('live');window.scrollTo(0,0)"); settle(pg); shot6("24-art-diagnostics-live")
            ct("diag", ["#diag>h2", ".panel:has(#lvGo)"])
            pg.evaluate("setSub('report');window.scrollTo(0,0)"); settle(pg)
            pg.evaluate("document.querySelector('.panel:has(#rpOpen)').scrollIntoView({block:'start'});window.scrollBy(0,-80)"); shot6("25-art-report-panel")
            ct("diag-report", [".panel:has(#rpOpen)"])
            pg.evaluate("S.tab='home';render();openPreset('sport');window.scrollTo(0,0)"); settle(pg); shot6("26-art-tune-detail")
            ct("detail", [".dhead", "#detail .card"])
            pg.evaluate("history.back()"); settle(pg)
            pg.click("#pill"); settle(pg, 400); shot6("27-art-connect-sheet"); ct("connect", ["#sheet"]); pg.evaluate("closeSheet()"); settle(pg)
            pg.click("#settingsBtn"); settle(pg, 400); shot6("28-art-settings-sheet"); ct("settings", ["#sheet"]); pg.evaluate("closeSheet()"); settle(pg)
            # v8: the Tune page carries the fiery CARTUNE banner; its Flash sheet a strip of it
            pg.evaluate("S.tab='home';render();openPreset('sport');window.scrollTo(0,0)"); settle(pg, 300)
            pg.locator("#top").screenshot(path=f"{a.out}/{name}-{theme}-29-tune-fire-hero.png")
            pg.evaluate("openFlash()"); settle(pg, 400); shot6("30-flash-fire-strip"); ct("flash", ["#sheet"]); pg.evaluate("closeSheet();history.back()"); settle(pg)
            fails = [r for r in results if r[4] < r[5]]
            worst = min(results, key=lambda r: r[4] / r[5]) if results else None
            print(f"  contrast {name}/{theme}: {len(results)} text runs over art, worst {worst}")
            for r in fails: problems.append(f"{name}/{theme}/{r[0]}: contrast {r[4]} < {r[5]} for {r[2]} '{r[3]}'")
            with open(f"{a.out}/contrast-{name}-{theme}.json", "w") as fh: json.dump(results, fh, indent=0)
            pg.evaluate("S.view='home';S.tab='home';render();window.scrollTo(0,0)")
        if errs: problems.append(f"{name}: console errors {errs[:5]}")
        ctx.close()
    # v9: the widths the full pass doesn't screenshot still have to fit (1024, 768, 360)
    for w in (1024, 768, 700, 360, 320):
        ctx = b.new_context(viewport={"width": w, "height": 900}, device_scale_factor=1, has_touch=w<=400, is_mobile=w<=400)
        pg = ctx.new_page()
        pg.goto(a.url)
        pg.wait_for_function("() => typeof S !== 'undefined' && S.conn === 'on' && S.backup >= 100", timeout=20000); settle(pg, 300)
        for theme in ("night", "sun"):
            pg.evaluate(f"setTheme('{theme}')"); settle(pg, 150)
            pg.evaluate("S.view='home';S.tab='home';render();window.scrollTo(0,0)"); settle(pg, 150)
            overflow(pg, f"{w}/{theme}/home")
            if theme == "night" or w in (360, 320, 700): pg.screenshot(path=f"{a.out}/w{w}-{theme}-home.png")
            pg.evaluate("S.tab='diag';render();window.scrollTo(0,0)"); settle(pg, 150)
            overflow(pg, f"{w}/{theme}/diag")
            if theme == "night": pg.screenshot(path=f"{a.out}/w{w}-{theme}-diag.png")
            pg.evaluate("S.tab='capture';render();window.scrollTo(0,0)"); settle(pg, 120); overflow(pg, f"{w}/{theme}/live")
            pg.evaluate("S.tab='home';render();openPreset('sport');window.scrollTo(0,0)"); settle(pg, 200)
            overflow(pg, f"{w}/{theme}/detail")
            pg.evaluate("openFlash()"); settle(pg, 250); overflow(pg, f"{w}/{theme}/flash")
            if theme == "night" and w == 768: pg.screenshot(path=f"{a.out}/w{w}-{theme}-flash.png")
            pg.evaluate("closeSheet();history.back()"); settle(pg, 120)
        ctx.close()
    b.close()
print("problems:", problems or "none")
sys.exit(1 if problems else 0)
