"""Headless smoke test of the CarTune web app in DEMO mode.

    python3 -m http.server 8765 --bind 127.0.0.1   (from the repo root)
    python web/tests/smoke_playwright.py [--url URL] [--shots DIR] [--chrome /usr/bin/google-chrome]

Checks: every tab and diagnostics sub-tab renders, calculators give the expected
verdicts for sample inputs, demo scan/clear/live logging/export work, no console
errors. v5: preset order, new tabs, switches (lift cover), filing (permission
first), emissions user agreement, flash gates, 'Fix it with other settings',
your own tunes on Home, packages and the make/model picker. v6: the street-art
artwork (hero + background art) is inlined and decodes in both themes. v8: the hero is
the owner's CARTUNE banner (night banner in Night, sun banner in Sun, phone crop on phones,
fiery banner on the Tune page) and mural B heads the other tabs. Needs `pip install playwright` (+ `playwright install chromium`, or --chrome).
"""
import argparse, json, os, sys
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://127.0.0.1:8765/web/dist/index.html")
ap.add_argument("--shots", default=None)
ap.add_argument("--chrome", default=None)
a = ap.parse_args()

fails, checks = [], 0
def check(cond, msg):
    global checks
    checks += 1
    if not cond:
        fails.append(msg); print("FAIL:", msg)

def shot(page, name):
    if a.shots:
        os.makedirs(a.shots, exist_ok=True)
        page.evaluate("document.getElementById('toast').classList.remove('show')"); page.wait_for_timeout(250)
        page.screenshot(path=os.path.join(a.shots, name), full_page=False)

with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": a.chrome} if a.chrome else {}))
    ctx = b.new_context(viewport={"width": 400, "height": 860}, device_scale_factor=2, accept_downloads=True)
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(a.url)
    page.wait_for_function("() => typeof S !== 'undefined' && S.conn === 'on'", timeout=15000)
    page.wait_for_function("() => S.backup >= 100", timeout=15000)
    page.wait_for_timeout(300)
    check(page.locator("#grid .tile").count() == 11, "home shows 11 tune tiles")
    check("DEMO" in page.locator("#pill").inner_text(), "pill shows DEMO")
    check("6G1EK5EU18L000123" in page.locator("#hero").inner_text(), "demo VIN read through emulator")
    shot(page, "01-home-phone.png")

    # connection sheet: demo / USB (Web Serial) / BLE (Web Bluetooth) options + adapter log
    page.click("#pill"); page.wait_for_timeout(200)
    sheet = page.locator("#sheet").inner_text()
    check("Demo car" in sheet and "Web Serial" in sheet and "Web Bluetooth" in sheet, "connect sheet lists demo/serial/BLE")
    check("ATZ" in (page.locator("#alog").text_content() or ""), "adapter log shows ELM327 traffic")
    page.evaluate("closeSheet()")

    # tune detail + flash sheet (gates intact)
    page.locator("#grid .tile").nth(1).click(); page.wait_for_timeout(300)
    check(page.locator("#detail").is_visible(), "tune detail opens")
    page.evaluate("openFlash()"); page.wait_for_timeout(200)
    txt = page.locator("#sheet").inner_text()
    check("FLASH" in txt, "flash sheet asks to type FLASH")
    page.evaluate("closeSheet()"); page.evaluate("S.view='home';render()")

    def tab(t):
        page.evaluate(f"S.tab='{t}';render()"); page.wait_for_timeout(150)
        check(page.locator("#" + t).is_visible() and len(page.locator("#" + t).inner_text()) > 50, f"tab {t} renders")

    tab("capture")
    page.click("#capVin"); page.wait_for_function("() => CAP.vin", timeout=5000)
    page.click("#capDtc"); page.wait_for_function("() => CAP.dtcs.length > 0", timeout=5000)
    check("P0171" in page.locator("#capture").inner_text(), "capture reads P0171")
    page.click("#capPid"); page.wait_for_function("() => Object.keys(CAP.live).length > 0", timeout=8000)
    with page.expect_download() as dl:
        page.click("#capExp")
    cap = json.load(open(dl.value.path()))
    check(cap.get("vin") == "6G1EK5EU18L000123" and "P0171" in cap.get("dtcs", []), "mobile_capture.json exported")

    tab("spec")
    with page.expect_download() as dl:
        page.click("#specExp")
    spec = json.load(open(dl.value.path()))
    check("profile" in json.dumps(spec) or "changes" in spec, "tune_spec.json exported")

    tab("diag")
    subs = page.evaluate("SUBS.map(s=>s[0])")
    for s in subs:
        page.evaluate(f"setSub('{s}')"); page.wait_for_timeout(120)
        check(len(page.locator("#dbody").inner_text()) > 80, f"diag sub-tab {s} renders")

    def calc(sub, cid, values, expect_status, expect_text=None):
        page.evaluate(f"setSub('{sub}')")
        for k, v in values.items():
            el = page.locator(f"#f-{cid}-{k}")
            if isinstance(v, bool):
                el.set_checked(v)
            elif el.evaluate("e=>e.tagName") == "SELECT":
                el.select_option(str(v))
            else:
                el.fill(str(v))
        out = page.locator(f"#calc-{cid} .out").inner_text()
        check(expect_status.upper() in out, f"{cid} {values} -> {expect_status} (got: {out[:90]})")
        if expect_text:
            check(expect_text in out, f"{cid} output contains {expect_text!r} (got: {out[:120]})")
        return out

    calc("vdrop", "vdrop", {"circuit": "ground", "reading": 0.35, "loaded": True}, "fail")
    calc("vdrop", "vdrop", {"circuit": "ground", "reading": 0.12}, "pass")
    calc("vdrop", "vdrop", {"circuit": "feed_high_current", "reading": 0.6}, "warn")
    page.locator("#calc-vdrop .save").click()
    calc("vdrop", "vwiz", {"source": 12.4, "power": 0.3, "ground": 0.1}, "pass")
    calc("battery", "soc", {"volts": 12.65, "type": "flooded"}, "pass", "100%")
    calc("battery", "soc", {"volts": 12.2}, "warn", "50%")
    calc("battery", "crank", {"minVolts": 9.2, "tempC": ""}, "fail")
    calc("battery", "chg", {"volts": 14.1, "smart": False}, "pass")
    calc("battery", "chg", {"volts": 15.2}, "fail")
    calc("battery", "ripple", {"acVolts": 0.8}, "fail")
    # auto-fill from the (demo) car: ATRV + PID 0x42
    page.evaluate("setSub('battery')"); page.click("#bRead")
    page.wait_for_function("() => /ATRV/.test(document.getElementById('bOut').textContent)", timeout=8000)
    bout = page.locator("#bOut").inner_text()
    check("PID 0x42" in bout and "V" in bout, "battery voltage read via ATRV + PID42: " + bout[:100])
    shot(page, "03-diag-battery-phone.png")

    calc("draw", "draw", {"milliamps": 35, "ah": 60}, "pass")
    calc("draw", "draw", {"milliamps": 120}, "fail")
    page.evaluate("setSub('draw')")
    page.locator("#f-fuse-type").select_option("mini"); page.wait_for_timeout(100)
    page.locator("#f-fuse-rating").select_option("10"); page.locator("#f-fuse-millivolts").fill("1.0")
    fout = page.locator("#calc-fuse .out").inner_text()
    check("134.8" in fout or "135" in fout, "fuse drop 1.0 mV across mini 10 A ≈ 134.8 mA (got: %s)" % fout[:100])
    page.evaluate("setSub('can')")
    page.locator("#f-canr-ohms").fill("120")
    cout = page.locator("#calc-canr .out").inner_text()
    check("terminator" in cout.lower(), "120 ohm -> one terminator missing (got: %s)" % cout[:100])
    page.locator("#f-canr-ohms").fill("60")
    check("PASS" in page.locator("#calc-canr .out").inner_text(), "60 ohm -> pass")
    page.locator("#f-canr-ohms").fill("0.5")
    check("FAIL" in page.locator("#calc-canr .out").inner_text() and "short" in page.locator("#calc-canr .out").inner_text().lower(), "0.5 ohm -> short")
    calc("can", "canv", {"canH": 2.7, "canL": 2.3}, "pass")
    calc("sensors", "s3w", {"ref": 5.0, "signal": 1.2, "groundDrop": 0.03}, "pass")
    calc("sensors", "s3w", {"ref": 0.2, "signal": 0.0, "groundDrop": 0.03}, "fail")
    shot(page, "04-diag-sensors-phone.png")

    # fault tree walk
    page.evaluate("setSub('faults')")
    page.click("#ftYes"); page.wait_for_timeout(80)
    check(page.locator("#dbody .crumbs").inner_text().count("yes") == 1, "fault tree advances")

    # scan: read, freeze frame, clear behind confirmation
    page.evaluate("setSub('scan')"); page.click("#scRead")
    page.wait_for_function("() => DG.scan", timeout=8000); page.wait_for_timeout(100)
    body = page.locator("#dbody").inner_text()
    check("P0171" in body and "P0300" in body, "scan shows stored P0171 + pending P0300")
    check("lean" in body.lower(), "P0171 description shown")
    page.click("#scFf"); page.wait_for_function("() => DG.ff", timeout=8000)
    check("Freeze frame" in page.locator("#dbody").inner_text(), "freeze frame shown")
    shot(page, "02-diag-scan-phone.png")
    page.click("#scClr"); page.wait_for_timeout(100)
    check(page.locator("#clrGo").is_disabled(), "clear button disabled until confirmed")
    page.locator("#clrAck").check(); page.locator("#clrTxt").fill("CLEAR")
    check(not page.locator("#clrGo").is_disabled(), "clear enabled after checkbox + CLEAR")
    page.click("#clrGo"); page.wait_for_timeout(1200)
    page.wait_for_function("() => DG.scan && DG.scan.stored.length === 0", timeout=8000)
    check(page.evaluate("DG.scan.permanent.length") == 1, "permanent code survives clear")

    # live dashboard + CSV
    page.evaluate("setSub('live')"); page.click("#lvGo")
    page.wait_for_function("() => S.live.rows.length >= 3", timeout=15000)
    page.click("#lvGo"); page.wait_for_timeout(400)
    with page.expect_download() as dl:
        page.click("#lvCsv")
    csv = open(dl.value.path()).read().splitlines()
    check(csv[0].startswith("time,rpm") and len(csv) >= 4, "live CSV has header + rows")

    # workflow notes persist
    page.evaluate("setSub('workflow')")
    page.locator("[data-step]").first.check(); page.wait_for_timeout(100)
    page.locator("#wfComplaint").fill("Battery flat after 2 days")
    check("Battery flat" in json.dumps(page.evaluate("getSession()")), "workflow complaint saved")

    # report
    page.evaluate("setSub('report')")
    rtxt = page.locator("#dbody").inner_text()
    check("Voltage drop" in rtxt, "report lists saved test")
    with page.expect_download() as dl:
        page.click("#rpJson")
    rep = json.load(open(dl.value.path()))
    check(len(rep.get("tests", rep.get("session", {}).get("tests", []))) >= 1 or "tests" in json.dumps(rep), "report JSON has tests")
    with page.expect_download() as dl:
        page.click("#rpHtml")
    rh = open(dl.value.path()).read()
    check("<html" in rh.lower() and "DEMO" in rh.upper(), "report HTML has demo banner")

    # ---------------- v5: new tabs, switches, fix-it, filing, agreement, picker ----------------
    page.evaluate("S.view='home';S.tab='home';render();window.scrollTo(0,0)"); page.wait_for_timeout(200)
    names = page.eval_on_selector_all("#grid .tile h3", "els => els.map(e => e.textContent)")
    order = page.evaluate("FL.PRESET_ORDER.map(id => presetById(id).name)")
    check(names == order and names[0] == "Factory", f"home tiles follow the new preset order (got {names[:4]}…)")
    check(page.evaluate("CAT_ALL.length") == 635, "vehicle catalogue has 635 models")
    page.locator("#grid .tile").first.click(); page.wait_for_timeout(250)
    page.locator("#levels .level").nth(1).click(); page.wait_for_timeout(250)
    tabs = page.eval_on_selector_all("#tabs .tab", "els => els.map(e => e.dataset.seg)")
    for t in ("Throttle", "Brakes & Traction", "Emissions"):
        check(t in tabs, f"new tab {t} shown (With detail)")
    check("Boost" not in tabs, "no Boost tab on the NA V8 demo car")
    check("preset as shipped" in page.locator("#filed").inner_text().lower(), "preset shows 'as shipped' card")
    # red switch sits under a lift cover; lifting it and turning ESC off files the tune at Competition level
    page.locator('#tabs .tab[data-seg="Brakes & Traction"]').click(); page.wait_for_timeout(200)
    check(page.locator('#sws [data-sw="t_esc"]').is_disabled(), "stability control switch is behind a lift cover")
    page.locator('[data-cover="t_esc"]').click(); page.wait_for_timeout(150)
    page.locator('#sws [data-sw="t_esc"]').click(); page.wait_for_timeout(250)
    u = page.evaluate("(() => { const t = curTune(); return {user: t.isUser, folder: t.folder, level: t.isUser ? t.u.level : -1, name: t.name, esc: tuneValues().t_esc, preset: tuneValues('factory').t_esc}; })()")
    check(u["user"] and u["name"].startswith("My Factory"), f"first change saves a user tune ({u['name']})")
    check(u["esc"] == 0 and u["preset"] == 1, "switch applied to the user tune; Factory preset stays as shipped")
    check(u["level"] == 3 and u["folder"] != "factory", f"ESC off files at Competition level, not Factory (folder {u['folder']})")
    check("stability control off" in page.locator("#filed").inner_text().lower(), "filed card says why (Stability control off)")
    page.locator('#c-t_esc .afx .fix').first.click(); page.wait_for_timeout(250)
    u2 = page.evaluate("(() => { const t = curTune(); return {folder: t.folder, level: t.u.level, esc: tuneValues().t_esc}; })()")
    check(u2["esc"] == 1 and u2["folder"] == "factory" and u2["level"] == 0, f"'Or undo it' restores ESC and re-files under Factory ({u2})")
    # emissions switch: agreement first; Cancel keeps it at stock; I accept applies it
    page.evaluate("S.agreed=false;store.set('agreed',false)")
    page.locator('#tabs .tab[data-seg="Emissions"]').click(); page.wait_for_timeout(200)
    check(page.locator("#sws .lvtag.agr").count() >= 1, "emissions switches are marked 'Agreement'")
    page.locator('#sws [data-sw="t_cat_mon"]').click(); page.wait_for_timeout(200)
    check(page.locator("#agYes").count() == 1 and "user agreement" in page.locator("#sheet").inner_text().lower(), "emissions switch opens the user agreement")
    page.locator("#agNo").click(); page.wait_for_timeout(200)
    check(page.evaluate("tuneValues().t_cat_mon") == 1 and not page.evaluate("S.agreed"), "Cancel leaves the emissions switch at stock")
    page.locator('#sws [data-sw="t_cat_mon"]').click(); page.wait_for_timeout(200)
    page.locator("#agYes").click(); page.wait_for_timeout(250)
    u3 = page.evaluate("(() => { const t = curTune(); return {cat: tuneValues().t_cat_mon, level: t.u.level, agreed: S.agreed, why: t.u.reasons.map(r => r.label)}; })()")
    check(u3["cat"] == 0 and u3["agreed"] and u3["level"] == 3 and "Emissions system changed" in u3["why"], f"I accept applies it and files at Competition ({u3})")
    # flash gates: competition acknowledgement + agreement row; withdrawing the agreement blocks the flash
    page.evaluate("openFlash()"); page.wait_for_timeout(200)
    check(page.locator("#agRow").count() == 1 and "accepted" in page.locator("#agRow").inner_text().lower(), "flash lists the user agreement gate")
    check(page.locator("#ack3").count() == 1 and page.locator("#confirm").is_disabled(), "Competition tune: FLASH box locked until acknowledged")
    page.locator("#ack3").check(); page.wait_for_timeout(100)
    check(not page.locator("#confirm").is_disabled() and page.locator("#go").is_disabled(), "after acknowledging, FLASH still has to be typed")
    page.evaluate("closeSheet();S.agreed=false;store.set('agreed',false);openFlash()"); page.wait_for_timeout(200)
    page.locator("#ack3").check(); page.wait_for_timeout(100)
    check(page.locator("#confirm").is_disabled() and page.locator("#agBtn").count() == 1, "agreement withdrawn: flash stays locked")
    page.evaluate("closeSheet();S.agreed=true;store.set('agreed',true)")
    # 'Fix it with other settings' on the Race preset
    page.evaluate("S.preset='race';S.seg=null;builtKey=null;render()"); page.wait_for_timeout(200)
    found = False
    for seg in page.eval_on_selector_all("#tabs .tab", "els => els.map(e => e.dataset.seg)"):
        page.locator(f'#tabs .tab[data-seg="{seg}"]').click(); page.wait_for_timeout(150)
        if page.locator(".fixes.ofx .fix").count():
            found = True; break
    check(found, "Race shows 'Fix it with other settings' suggestions")
    if found:
        check("fix it with other settings" in page.locator(".fixes.ofx").first.inner_text().lower(), "fix list is labelled 'Fix it with other settings'")
        before = page.evaluate("JSON.stringify([tuneValues(), S.fuel, S.upgrades])")
        n_user = page.evaluate("userTunes().length")
        page.locator(".fixes.ofx .fix").first.click(); page.wait_for_timeout(250)
        check(page.evaluate("JSON.stringify([tuneValues(), S.fuel, S.upgrades])") != before, "a fix-it suggestion applies")
        check(page.evaluate("userTunes().length") == n_user + 1 and page.evaluate("curTune().isUser"), "fix on a preset creates a filed user tune")
    page.evaluate("history.back()"); page.wait_for_timeout(300)
    check(page.locator("#mine .mtile").count() == page.evaluate("userTunes().length") >= 2, "home lists your own tunes with their folders")
    check("of yours" in page.locator("#grid").inner_text().lower(), "preset tiles count the user tunes filed in them")
    # vehicle picker: package decides the types; pick a Ford Ranger
    page.evaluate("S.pkg='standard';openPicker()"); page.wait_for_timeout(150)
    check(page.locator("#ptiles .ptile").count() == 1, "Standard package: cars only (no trucks)")
    page.evaluate("S.pkg='commercial';openPicker()"); page.wait_for_timeout(150)
    check(page.locator("#ptiles .ptile").count() == 2, "Commercial package adds trucks")
    page.evaluate("S.pkg='heavy';openPicker()"); page.wait_for_timeout(150)
    check(page.locator("#ptiles .ptile").count() == 4, "Heavy package adds ag and earthmoving")
    page.evaluate("S.pkg='standard';store.set('pkg','standard');closeSheet()")
    page.click("#editCar"); page.wait_for_timeout(200); page.click("#ecPick"); page.wait_for_timeout(200)
    page.locator('#ptiles .ptile[data-key="car"]').click(); page.wait_for_timeout(150)
    page.fill("#pq", "Tesla"); page.locator('#ptiles .ptile[data-key="Tesla"]').click(); page.wait_for_timeout(150)
    check(page.locator('#ptiles .ptile[aria-disabled="true"]').count() >= 1, "electric models are shown but can't be tuned")
    page.locator("#pBack").click(); page.wait_for_timeout(150)
    page.fill("#pq", "Ford"); page.locator('#ptiles .ptile[data-key="Ford"]').click(); page.wait_for_timeout(150)
    page.fill("#pq", "Ranger"); page.locator('#ptiles .ptile[data-key="Ranger"]').click(); page.wait_for_timeout(150)
    page.locator('#ptiles .ptile[data-key="PX2 / PX3"]').click(); page.wait_for_timeout(150)
    page.locator('#ptiles .ptile[data-key="3.2 turbo diesel"]').click(); page.wait_for_timeout(150)
    page.locator('#ptiles .ptile[data-key="6-speed auto"]').click(); page.wait_for_timeout(150)
    check("is this your vehicle?" in page.locator("#sheet").inner_text().lower() and "bosch" in page.locator("#sheet").inner_text().lower(), "picker reaches the confirm card with the ECU")
    page.click("#pYes")
    page.wait_for_function("() => S.conn === 'on' && S.car.key.indexOf('pick:') === 0", timeout=15000); page.wait_for_timeout(300)
    check("ford ranger" in page.locator("#hero").inner_text().lower() and page.evaluate("S.car.vin").startswith("CTDEMO"), "picked car becomes the demo car (CTDEMO VIN)")
    check(page.evaluate("S.car.engine") == "turbo_diesel" and page.locator("#grid .tile").count() == 11, "picked diesel gets the 11 presets")
    page.evaluate("S.carKey='ve';store.set('car','ve');connectDemo()")
    page.wait_for_function("() => S.conn === 'on' && S.car.key === 've' && S.backup >= 100", timeout=15000); page.wait_for_timeout(200)

    # v10: phone Home has its own purpose-composed 4:3 mural (Night / Sun), shown whole.
    # v6/v8: the artwork is inlined and decodes (hero banner, page wall, section piece, spray rule, card peel,
    # tag scribble, footer) in Night and Sun. v8: the hero is the owner's CARTUNE banner (A), whole: the night banner
    # in Night, the sun banner in Sun, the phone crop on phones; the fiery banner on the Tune page; mural B elsewhere.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from art_checks import art_loaded
    page.evaluate("closeSheet();S.view='home';S.tab='home';render();window.scrollTo(0,0)"); page.wait_for_timeout(300)
    ids = {}
    for theme in ("night", "sun"):
        page.evaluate(f"setTheme('{theme}')"); page.wait_for_timeout(150)
        art = art_loaded(page); ids[theme] = art["hero"]["id"]
        for k in ("hero", "page", "section", "rule", "card_peel", "card_tags", "footer"):
            check(art[k]["url"] and art[k]["w"] > 0, f"{theme}: art '{k}' is an inlined image that decodes ({art[k]})")
        aw, ah = art["heroArt"]
        check(art["hero"]["w"] == 1200 and abs(aw / ah - 4 / 3) < 0.03,
              f"phone Home ({theme}) shows its own 4:3 mural, whole ({art['hero']}, box {art['heroArt']})")
    check(ids["night"] != ids["sun"], "Night and Sun show different phone Home murals")
    page.evaluate("S.tab='capture';render()"); page.wait_for_timeout(200)
    art = art_loaded(page)
    check(art["hero"]["w"] == 1600 and art["hero"]["id"] not in ids.values(), f"other tabs show mural B in the header ({art['hero']})")
    page.evaluate("S.tab='home';render();openPreset('sport')"); page.wait_for_timeout(250)
    art = art_loaded(page)
    check(art["hero"]["w"] == 890 and art["hero"]["id"] not in ids.values(), f"the Tune page shows the fiery banner ({art['hero']})")
    page.evaluate("history.back()"); page.wait_for_timeout(200)
    page.evaluate("setTheme('auto');S.view='home';S.tab='home';render()"); page.wait_for_timeout(150)

    # desktop screenshot
    page.set_viewport_size({"width": 1366, "height": 900})
    page.wait_for_timeout(200); art = art_loaded(page)
    aw, ah = art["heroArt"]
    check(art["hero"]["w"] == 2103 and aw >= 1366, f"desktop Home shows the whole CARTUNE banner, full width ({art['hero']}, art {art['heroArt']})")
    check(any(abs(aw / ah - r) < 0.05 for r in (2103 / 293, 2103 / 243)), f"desktop banner keeps its own aspect ratio (art {art['heroArt']})")
    page.evaluate("setSub('draw')"); page.wait_for_timeout(200)
    shot(page, "05-diag-desktop.png")
    page.evaluate("S.tab='home';render()"); page.wait_for_timeout(200)

    check(not errors, "no console errors: %s" % errors[:5])
    b.close()

print(f"{checks - len(fails)}/{checks} checks passed")
sys.exit(1 if fails else 0)
