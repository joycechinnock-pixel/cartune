"""Browser checks for CarTune Admin + the customer support flow (v11), local demo store.

    python3 web/tests/admin_playwright.py [--admin URL] [--app URL] [--shots DIR] [--chrome /usr/bin/google-chrome]

Admin and app are opened in the same browser context (same origin), so they share the
local demo store, like a helper's desk and a customer's phone talking through the API.
Checks: one-time owner setup, sign-in, dashboard stats, Users with live presence
(online/offline filters, opening an offline account, comp grant), customer Redeem
(showcase demo pass), Get help code -> admin joins and sees the read-only snapshot,
chat, suggestion accepted on the customer's device (saved as a tune, NOT flashed),
discount and demo codes, the Tune Library Vault review (competition/emissions can't be
road-legal, reject needs a note), the public vault download, and the audit log.
Screenshots: Night, 1440 and 400 px.
"""
import argparse, os, re
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(os.path.dirname(HERE))
ap = argparse.ArgumentParser()
ap.add_argument("--admin", default="file://" + os.path.join(REPO, "CarTune-Admin.html"))
ap.add_argument("--app", default="file://" + os.path.join(REPO, "CarTune-App.html"))
ap.add_argument("--shots", default=None)
ap.add_argument("--chrome", default=None)
a = ap.parse_args()
fails, checks = [], 0
def check(c, m):
    global checks
    checks += 1
    if not c: fails.append(m); print("FAIL:", m)
def shot(page, name, full=False):
    if not a.shots: return
    os.makedirs(a.shots, exist_ok=True)
    page.evaluate("()=>{var t=document.getElementById('toast');t&&t.classList.remove('show')}"); page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(a.shots, name), full_page=full)

OWNER, PW = "owner@cartune.example", "demo-owner-pass-123"
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, **({"executable_path": a.chrome} if a.chrome else {}))
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    adm = ctx.new_page(); adm.on("pageerror", lambda e: errors.append("admin: " + str(e)))
    adm.on("dialog", lambda d: d.accept())
    adm.goto(a.admin); adm.wait_for_selector("#suGo", timeout=15000)
    check("DEMO DATA" in adm.locator("#demoFlag").inner_text(), "admin flags DEMO DATA")
    check(adm.evaluate("getComputedStyle(document.body).backgroundImage").count("url(") >= 1, "brick wall behind admin")
    adm.fill("#suName", "Olive Owner"); adm.fill("#suEmail", OWNER); adm.fill("#suPw", PW); adm.click("#suGo")
    adm.wait_for_selector("#liGo"); adm.fill("#liPw", PW); adm.click("#liGo")
    adm.wait_for_selector(".kpi"); adm.wait_for_timeout(300)
    check("owner" in adm.locator("#who").inner_text(), "signed in as owner")
    check(adm.locator(".kpi").count() >= 8 and adm.locator(".bars").count() >= 4, "dashboard KPIs + charts")
    check(adm.evaluate("CarTuneAPI.create().kind") == "local", "admin defaults to the local demo store")
    shot(adm, "admin-1440-01-dashboard.png")
    # setup is one-time
    r = adm.evaluate("api.setupOwner({email:'x@example.com',password:'another-long-pass'}).then(()=>'ok',e=>e.code)")
    check(r == "forbidden", "setup refused once the owner exists")

    # users + presence
    adm.click("#nav-users"); adm.wait_for_selector("#uTable tr[data-id]")
    online = adm.locator("#uTable .dot.on").count(); offline = adm.locator("#uTable .dot.off").count()
    check(online >= 4 and offline >= 4, f"users list shows online ({online}) and offline ({offline})")
    check(re.search(r"\d+ online · \d+ offline", adm.locator("#uCount").inner_text()) is not None, "online/offline count")
    shot(adm, "admin-1440-02-users.png")
    adm.click("#uF button[data-f=online]"); adm.wait_for_timeout(200)
    check(adm.locator("#uTable .dot.off").count() == 0 and adm.locator("#uTable .dot.on").count() >= 4, "Online filter")
    adm.click("#uF button[data-f=offline]"); adm.wait_for_timeout(200)
    check(adm.locator("#uTable .dot.on").count() == 0, "Offline filter")
    adm.locator("#uTable tr", has_text="Dazza").click(); adm.wait_for_selector("#drawer")
    check("Offline" in adm.locator("#drawer").inner_text() and adm.locator("#gGo").count() == 1, "offline user's account opens with actions")
    adm.select_option("#gTier", "pro"); adm.fill("#gDays", "14"); adm.fill("#gNote", "Ambassador trial"); adm.click("#gGo"); adm.wait_for_timeout(500)
    check("comp" in adm.locator("#drawer").inner_text() and "Pro" in adm.locator("#drawer").inner_text(), "comp granted to offline user")
    shot(adm, "admin-1440-03-user-account.png")
    adm.click("#dClose")
    adm.click("#uF button[data-f=all]")

    # customer app
    app = ctx.new_page(); app.set_viewport_size({"width": 400, "height": 860}); app.on("pageerror", lambda e: errors.append("app: " + str(e)))
    app.goto(a.app); app.wait_for_function("() => typeof S !== 'undefined' && S.conn === 'on'", timeout=15000)
    app.wait_for_selector("#getHelpBtn"); app.evaluate("document.documentElement.setAttribute('data-theme','night')")
    check(app.locator("#redeemBtn").count() == 1 and app.locator("#vaultBtn").count() == 1, "customer Home has Get help / Redeem / Vault")
    app.click("#redeemBtn"); app.fill("#rdCode", "showroom"); app.click("#rdGo"); app.wait_for_timeout(600)
    check("Showcase pass on" in app.locator("#rdOut").inner_text(), "demo code unlocks showcase pass")
    check(app.evaluate("S.pkg") == "heavy" and app.evaluate("S.mode") == "demo", "showcase = every package, demo mode")
    shot(app, "app-400-01-redeem.png")
    app.fill("#rdCode", "MATE25"); app.click("#rdGo"); app.wait_for_timeout(500)
    check("25% off" in app.locator("#rdOut").inner_text(), "discount code saved")
    app.fill("#rdCode", "NOT-A-CODE"); app.click("#rdGo"); app.wait_for_timeout(400)
    check("isn't valid" in app.locator("#rdOut").inner_text(), "bad code refused")
    app.evaluate("closeSheet()"); app.wait_for_timeout(200)
    app.evaluate("render()"); app.wait_for_timeout(200)
    check(app.locator(".banner.showcase").count() == 1, "showcase banner on Home")
    oncar = app.evaluate("S.onCar")
    app.click("#getHelpBtn")
    check("can’t change or flash your car" in app.locator("#sheet").inner_text(), "customer told helper can't flash")
    app.fill("#hpName", "Shazza Nguyen"); app.fill("#hpEmail", "shazza@example.com"); app.click("#hpGo")
    app.wait_for_selector("#hpCode"); code = re.sub(r"\D", "", app.locator("#hpCode").inner_text())
    check(len(code) == 6, "customer gets a 6-digit help code")
    app.wait_for_timeout(1200)
    shot(app, "app-400-02-help-code.png")

    # admin joins
    adm.click("#nav-help"); adm.wait_for_selector("#hCode"); adm.fill("#hCode", code); adm.click("#hJoin")
    adm.wait_for_selector("#hChat"); adm.wait_for_timeout(5500)
    main = adm.locator("#main").inner_text()
    check("P0171" in main and "Read-only" in main.replace("READ-ONLY", "Read-only"), "admin sees fault codes, read-only")
    check(adm.locator(".panel.ro").count() == 6, "admin sees vehicle, live, codes, diagnostics, settings, tune")
    check(adm.evaluate("Object.keys(CarTuneAPI.ROUTES).filter(k=>/flash|write|ecu/i.test(k)).length") == 0, "no flash/write in the API")
    adm.fill("#hMsg", "G'day Shazza, I can see a lean code. Sending a smoother tune."); adm.click("#hSend"); adm.wait_for_timeout(400)
    adm.select_option("#sBase", "comfort"); adm.fill("#sName", "Smoother idle (from help)"); adm.select_option("#sSet", "idle_rpm"); adm.fill("#sVal", "50"); adm.fill("#sNote", "Comfort base, idle up 50 rpm for the cam"); adm.click("#sGo"); adm.wait_for_timeout(600)
    adm.wait_for_timeout(4500)
    check("pending" in adm.locator("#main").inner_text(), "suggestion pending")
    adm.evaluate("document.activeElement&&document.activeElement.blur();window.scrollTo(0,0)"); adm.wait_for_timeout(200)
    shot(adm, "admin-1440-04-remote-help.png")
    # customer accepts
    app.wait_for_selector(".sgYes", timeout=12000); app.wait_for_timeout(300)
    check("Smoother idle" in app.locator("#sheet").inner_text() and "G'day Shazza" in app.locator("#sheet").inner_text(), "customer sees chat + suggestion")
    shot(app, "app-400-03-suggestion.png")
    n0 = app.evaluate("userTunes().length"); app.click(".sgYes"); app.wait_for_timeout(800)
    check(app.evaluate("userTunes().length") == n0 + 1, "accepted tune saved as the customer's tune")
    check(app.evaluate("S.onCar") == oncar, "accepting did NOT flash anything")
    adm.wait_for_timeout(4500)
    check("accepted" in adm.locator("#main").inner_text(), "admin sees accepted")

    # packages & codes, demo
    adm.click("#nav-packages"); adm.wait_for_selector("#cGo"); adm.fill("#cCode", "TRADIE15"); adm.fill("#cVal", "15"); adm.fill("#cUses", "40"); adm.click("#cGo"); adm.wait_for_timeout(500)
    check("TRADIE15" in adm.locator("#main").inner_text(), "discount code created")
    shot(adm, "admin-1440-05-packages-codes.png")
    adm.click("#nav-demo"); adm.wait_for_selector("#dGo"); adm.fill("#dLabel", "Motorvation stand"); adm.fill("#dCode", "DEMO-MOTO"); adm.click("#dGo"); adm.wait_for_selector("#dLink")
    check("?demo=DEMO-MOTO" in adm.locator("#dLink").inner_text(), "demo link created")
    shot(adm, "admin-1440-06-demo-links.png")

    # vault review
    adm.click("#nav-vault"); adm.wait_for_selector(".vault-card")
    dpf = adm.locator(".vault-card", has_text="Patrol DPF delete")
    check(dpf.locator("input[type=checkbox]").is_disabled() and "can’t be published as road-legal" not in dpf.inner_text(), "emissions/competition: road-legal box disabled")
    check("Emissions changes" in dpf.inner_text() and "Competition" in dpf.inner_text(), "gates + warnings shown")
    check(adm.locator(".vault-card .dot").count() >= 2, "submitter presence shown")
    shot(adm, "admin-1440-07-vault-review.png")
    hil = adm.locator(".vault-card", has_text="HiLux towing"); hid = hil.get_attribute("data-id")
    adm.fill(f"#vn-{hid}", "Checked shift points. Fine for towing."); adm.check(f"#vr-{hid}"); adm.click(f".vAcc[data-id='{hid}']"); adm.wait_for_timeout(500)
    did = dpf.get_attribute("data-id") if dpf.count() else None
    adm.click(f".vRej[data-id='{did}']"); adm.wait_for_timeout(400)
    check(adm.locator(f".vault-card[data-id='{did}']").count() == 1, "reject without a note is refused")
    adm.fill(f"#vn-{did}", "Off-road only; needs proof the DPF is removed."); adm.click(f".vNote[data-id='{did}']"); adm.wait_for_timeout(400)
    adm.click(f".vAcc[data-id='{did}']"); adm.wait_for_timeout(500)
    adm.locator("#vF button", has_text="Public").click(); adm.wait_for_timeout(300)
    pub = adm.locator("#vList").inner_text().lower()
    check("hilux towing" in pub and "road-legal" in pub and "patrol dpf delete" in pub and "not for public roads" in pub, "accepted tunes public; DPF not road-legal")
    adm.locator("#vF button", has_text="To review").click(); adm.wait_for_timeout(300)
    t4 = adm.locator(".vault-card", has_text="T610"); tid = t4.get_attribute("data-id") if t4.count() else None
    if tid: adm.fill(f"#vn-{tid}", "Limiter must stay on for a fleet truck."); adm.click(f".vRej[data-id='{tid}']"); adm.wait_for_timeout(400)
    # customer browses + downloads
    app.evaluate("closeSheet()"); app.click("#vaultBtn"); app.wait_for_selector(".vault-item")
    vt = app.locator("#sheet").inner_text()
    check("Not for public roads" in vt and "off-road acknowledgement" in vt, "customer vault shows gates and warnings")
    shot(app, "app-400-04-vault.png")
    n1 = app.evaluate("userTunes().length"); app.locator(".vault-item", has_text="VE SS smooth daily").locator(".vDl").click(); app.wait_for_timeout(600)
    check(app.evaluate("userTunes().length") == n1 + 1 and app.evaluate("S.onCar") == oncar, "vault download saved, not flashed")
    # submit to vault
    app.click("#vaultBtn"); app.wait_for_selector("#vsGo"); app.fill("#vsNote", "Bit more throttle"); app.click("#vsGo"); app.wait_for_timeout(500)
    sub = adm.evaluate("api.listSubmissions(A.token,'pending').then(l=>l.length)")
    check(sub >= 1, "customer submission reaches the review queue")

    # audit
    adm.click("#nav-audit"); adm.wait_for_selector("#aQ"); at = adm.locator("#main").inner_text()
    for act in ["setup.owner", "package.comp", "help.join", "help.suggest", "help.suggestion_accepted", "code.create", "demo.create", "vault.accepted", "vault.rejected", "vault.note", "code.redeem"]:
        check(act in at, "audit shows " + act)
    shot(adm, "admin-1440-08-audit.png")
    adm.click("#nav-orders"); adm.wait_for_selector("tr[data-id]"); shot(adm, "admin-1440-09-orders.png")
    adm.click("#nav-catalog"); adm.wait_for_timeout(300); check(adm.locator("#main table").count() >= 2, "presets + ECU list"); shot(adm, "admin-1440-10-catalogue.png")

    # phone 400 px admin
    adm.set_viewport_size({"width": 400, "height": 860}); adm.wait_for_timeout(300)
    for v, name in [("dash", "01-dashboard"), ("users", "02-users"), ("packages", "05-packages-codes"), ("demo", "06-demo-links"), ("vault", "07-vault-review")]:
        adm.evaluate(f"show('{v}')"); adm.wait_for_timeout(500)
        sw = adm.evaluate("document.documentElement.scrollWidth")
        check(sw <= 402, f"admin {v} fits 400 px (scrollWidth {sw})")
        shot(adm, f"admin-400-{name}.png")
    # live help at 400: start a fresh session from the app
    app.evaluate("closeSheet()"); app.evaluate("stopHelp()"); app.click("#getHelpBtn"); app.click("#hpGo"); app.wait_for_selector("#hpCode")
    code2 = re.sub(r"\D", "", app.locator("#hpCode").inner_text())
    adm.evaluate("show('help')"); adm.wait_for_selector("#hCode"); adm.fill("#hCode", code2); adm.click("#hJoin"); adm.wait_for_selector("#hChat"); adm.wait_for_timeout(5500)
    adm.evaluate("window.scrollTo(0,0)"); shot(adm, "admin-400-04-remote-help.png")
    adm.evaluate("setTheme('sun')"); adm.evaluate("show('dash')"); adm.wait_for_timeout(500); shot(adm, "admin-400-11-dashboard-sun.png")
    adm.set_viewport_size({"width": 1440, "height": 900}); adm.wait_for_timeout(300); shot(adm, "admin-1440-11-dashboard-sun.png")
    check(not errors, "no page errors: " + "; ".join(errors[:3]))
    b.close()

print(f"admin browser checks: {checks - len(fails)}/{checks} passed")
if fails: print("problems:", fails); raise SystemExit(1)
print("problems: none")
