# CarTune web app

Browser version of the CarTune companion: the App Preview screens (Home, tune
detail, Pro tables, Pro settings, Flash sheet, Edit vehicle, Settings, and
from v5 the tune tabs with on/off switches, "Fix it with other settings",
auto-filed user tunes, packages and the make/model picker) plus
**Live data**, **Diagnostics** and **Tune spec** tabs. There is a real OBD-II
connection through **Web Serial** (USB ELM327 / OBDLink) or **Web Bluetooth**
(BLE ELM327-type dongles), and a clearly labelled **Demo adapter** (simulated
ELM327, made-up data) so every screen works with no car.

## Run it

| Way | How | Notes |
|---|---|---|
| Single file | open `CarTune-App.html` (repo root) in Chrome or Edge | Works offline. Web Serial works from `file://` in desktop Chrome/Edge. Web Bluetooth can be restricted on `file://` in some Chrome versions/platforms. If the BLE option is greyed out or fails, use the served version. |
| Served (PWA) | `python3 -m http.server 8000` in the repo root → <http://localhost:8000/web/dist/> | `localhost` counts as a secure context, so both Web Serial and Web Bluetooth are allowed. This mode also gets the manifest and offline cache (`sw.js`). To use it on a phone, host `web/dist/` over **https**. |

Browser support: Web Serial works in desktop Chrome/Edge/Opera. Web Bluetooth
works in Chrome/Edge on Android, Windows, macOS and ChromeOS. Neither API
exists in Firefox or Safari, or in **any browser on iPhone/iPad**; those
browsers get Demo mode and the manual calculators only.
On Linux desktops Chrome's Web Bluetooth support is partial and may need
`chrome://flags/#enable-experimental-web-platform-features`. Headless Chrome
on the build box exposed `navigator.serial` on both `file://` and
`localhost`, but no `navigator.bluetooth` on either, so the BLE path has not
been exercised at all yet.
Classic-Bluetooth (SPP) ELM327 dongles are **not** reachable from a browser:
use a USB adapter or a BLE one.

## Build

The app is `web/app.template.html` + `web/src/*.js` + the shared TypeScript
logic in `mobile/src` (tune rules, presets, filing, tables, ECU profiles, ELM327
parser, emulator, OBD session, `diag/*`, tune spec). This is the same code
the React Native app and the node tests use. The make/model list is
`prototype/makes.js` (shared with the prototype, inlined first); the detailed
engine rows for the picker are in `web/src/22-catalog.js`.

| File | What |
|---|---|
| `web/src/22-catalog.js` | vehicle catalogue (CATALOG rows from the prototype + `CAT_ALL`, 635 models), package → vehicle type, `profOf()` |
| `web/src/25-tunes.js` | presets vs user tunes, auto-filing (`FL.fileTune`), `doAction()` with the emissions agreement |
| `web/src/30-detail.js` | tune page: tabs, sliders, switches (lift cover on red ones), fix lists, filed card |
| `web/src/40-flash.js` | flash gates, Edit vehicle (package ECU list), Settings (package, agreement) |
| `web/src/45-picker.js` | Type → Make → Model → Generation → Engine → Transmission picker |

```bash
cd mobile && npm install        # or: npm i -g typescript (TypeScript is the only build dependency)
node ../web/build.js            # -> web/dist/index.html (+ manifest, sw.js, icon) and ../CarTune-App.html
```

## Look and feel (Street Kit skin)

The app uses the CarTune Street Style Guide ("WA underground": graffiti and
tattoo framing, realistic vehicles, wet-asphalt night palette). Everything is
inlined into the single file, so it stays offline and self-contained (about 2.3 MB).

- `web/assets/street-kit/tokens.css` is copied from `style-guide/tokens.css`.
  `build.js` inlines only the token layer (colours, type, spacing, Night/Sun
  themes). The app's own classes live in `web/app.template.html`.
- `web/assets/street-kit/fonts/` holds 12 subset woff2 files: Barlow, Barlow
  Condensed, Big Shoulders Stencil, JetBrains Mono, Permanent Marker and
  Sedgwick Ave Display. Licences are OFL and Apache-2.0 (included). They are
  inlined as base64.
- **Artwork (v8, the owner's own art):** `web/assets/street-kit/mural/` holds
  crops of the owner's two artworks (`style-guide/owner-art/`): A, three CARTUNE
  banners (night, sun, fire), and B, the Aussie line-up mural. They are only
  cropped, scaled and compressed to WebP (`style-guide/src/mural/build_v8.py`),
  never repainted or filtered. Every image there becomes a CSS variable:
  `<name>.webp` → `--ph-<name>`, `tex-<name>.webp` → `--art-<name>` (file table
  in `mural/README.md`).
  - `hero-night` / `hero-sun` (2103×293 / 2103×243): the Home hero, full-bleed
    at its own aspect with nothing over it. Night shows the night banner, Sun the
    sun banner. The art's CARTUNE lettering replaces the text wordmark there (the
    wordmark stays for screen readers). The controls sit in a dark strip below.
  - `hero-fire` (2103×198): the Tune page (detail view) hero, and a strip at the
    top of the Flash sheet (confirm, competition gate, done).
  - `hero-home-m-night` / `hero-home-m-sun` (1200×900, v10): the phone Home
    mural (≤700 px), one whole 4:3 picture recomposed from the owner's art
    (cut out and placed, not repainted) with a brick wall; shown whole.
  - `hero-fire-m`: the phone Tune page crop (CARTUNE + RESURECTED).
  - `app-header` (B, 1600×569): the inner-page header on Live data, Diagnostics
    and Tune spec (per-tab position), and faded again as the page foot.
  - `bn-*`: slices of B (feathered edge) faded in on the right of section
    headings and panel/sheet tops.
  - `st-cocky`, `st-swan`, `st-kooka`: B's natives as empty-state art.
  - `tex-peel` (B's splash corner) for card/panel corners; `tex-mural` is a
    running-bond brick wall (CarTune is the sister app to MintWall, so the
    brick stays behind the page, veiled in both themes) and `tex-rule` is the
    spray rule, both procedural in the art palette; `tex-tags` tag scribbles.
  The palette is sampled from the art (tokens v2.0). Section headings get a
  wattle drip bar (sunset-deep in Sun) and big headings the CARTUNE piece's
  blue keyline. The vehicle line icons (`--i-car` and the others) are kept.
  Veils are the theme's own surface colour so text over art keeps WCAG AA in
  Night and Sun (`screens_playwright.py` measures it). To swap a piece, re-run
  `build_v8.py` (or drop a WebP with the same name into `mural/`) and rebuild.
- `web/assets/street-kit/photos/` (optional): the v5 photo slots. The owner's
  treated photos are kept in `style-guide/assets/photos/`; anything placed here
  is used only for slots `mural/` doesn't fill.
- `web/assets/street-kit/art/`: the drawn fallback (`tex-brick.webp` for the
  page when there's no `mural/tex-mural.webp`, `hero.webp` and `sticker-*`
  when a slot above is missing).
- **Header override:** drop an image in as
  `web/assets/street-kit/art/hero-photo.webp` (or `.jpg`/`.png`, landscape,
  about 1600×570) and rebuild. It replaces the inner-page header (mural B);
  the Home and Tune heroes stay the owner's banners. Keep it under about 300 KB.
- **Night / Sun:** use the header button (or Settings → Auto / Night / Sun).
  Auto follows the OS. The choice is stored per browser (`theme` key).
- Rules kept on data screens:
  - JetBrains Mono readouts on flat, high-contrast wells (7:1 or better)
  - 48 px touch targets
  - status is always colour plus text plus icon (✓ PASS, ▲ WARN, ⬣ FAIL, i INFO)
  - full-strength art only on the heroes, the inner header, section-heading pieces, panel/sheet tops and empty states; elsewhere it's faded behind a veil (corners of cards and panels, page wall, footer). Readouts, result wells and inputs keep their solid fills; where a table or line of text crosses a faded corner the art is at most about 12 % and the contrast check covers it
  - honours reduced motion, high contrast, forced colours and print

## Tests

`web/tests/smoke_playwright.py` drives the built app headless in Demo mode
(114 checks). It covers:
- every tab and every diagnostics sub-tab
- calculator verdicts for sample inputs
- the scan, freeze-frame and clear-codes flow, including the confirmation gate
- live logging to CSV
- the capture, tune-spec and report exports
- v5: preset order, the new tabs, switches and the lift cover, filing (ESC off
  files at Competition level, never Factory; undo re-files under Factory), the
  emissions agreement (Cancel keeps stock, I accept applies), the flash gates
  for Competition tunes and a withdrawn agreement, "Fix it with other settings",
  your own tunes on Home, packages in the picker and picking a Ford Ranger
- no console errors

```bash
pip install playwright && playwright install chromium   # or pass --chrome /usr/bin/google-chrome
python3 -m http.server 8765 --bind 127.0.0.1 &
python web/tests/smoke_playwright.py                      # add --url file:///…/CarTune-App.html to test the single file
```

`web/tests/screens_playwright.py --url … --out DIR` is a visual pass. It
screenshots every tab and sub-tab in Night and Sun at 1440 px and 400 px,
then fails on console errors or horizontal scroll. v5 adds the tune tabs,
fix-it, switches, filed tune, emissions agreement, flash gates, picker and
Home with your own tunes. v6 adds the artwork checks (`web/tests/art_checks.py`):
every art layer must be an inlined image that decodes, and every text run over
art on Home, Live data, Tune spec, Diagnostics, the tune page and the connect /
settings sheets must meet WCAG AA (text hidden, background sampled, worst of the
5th/95th percentile; results in `contrast-<width>-<theme>.json`). v8 checks the
owner's banners: Night and Sun show different banners at their own aspect, the
phone crops on phones, mural B on the inner tabs, the fire banner on the tune
page, and the Flash sheet strip (screens 29 and 30). Text inside a closed
`<details>` is skipped by the contrast pass.
`mobile/scripts/test-catalog-filing.js` (node)
checks the catalogue counts, ECU ids, packages and filing invariants.

## Safety

- The browser app is **read-only towards the ECU**. It reads VIN, Cal ID, DTCs, freeze frame, live PIDs and battery voltage.
- The only write-type command it sends is OBD-II **Mode 04 (clear codes)**. That command sits behind a sheet that requires a checkbox and typing `CLEAR`, and `ObdSession.clearDtcs()` refuses to run without `{confirmed: true}`.
- The Flash sheet keeps its existing gates: type FLASH, a pull log for tunes beyond Day Use, and a stock backup. It only "flashes" in Demo mode, as a simulation. With a real adapter it explains that flashing needs the wired CarTune receiver and the orchestrator.
- v5 adds gates, it removes none: the tune's permission level and reasons are shown; a Competition and off-road tune needs an extra acknowledgement before FLASH can be typed; a tune with emissions changes needs the user agreement accepted (withdrawing it in Settings locks the flash again); a pull log only counts for the exact values it was logged with.
- Emissions switches never leave their factory setting without the user agreement (Cancel keeps them at stock). Red switches (stability control, ABS, knock sensors, overboost cut, …) sit under a "Lift cover" guard while at the factory setting.
- Picking a vehicle does not add any flash capability: in Demo mode it becomes the simulated car; with a real adapter it only fills in details and keeps what the car reports.

## Hardware status (honest)

| Piece | Status |
|---|---|
| ELM327 reply parsing (headers on/off, 11/29-bit CAN, ISO-TP multi-frame, legacy protocols, NO DATA/errors) | Tested against documented formats and the built-in emulator (`mobile/scripts/test-elm327.js`). Real-adapter replies may contain quirks the tests don't cover. |
| Web Serial transport (`web/src/10-transports.js`) | Code complete; **not yet run against a real USB adapter**. Default 38400 baud (common ELM327 clones); OBDLink SX/EX usually 115200. The baud rate can be changed in the connect sheet. |
| Web Bluetooth transport | Code complete; **not run against real hardware**. The service/characteristic UUIDs are the common ones used by ELM327 BLE clones and OBDLink (FFF0/FFF1/FFF2, FFE0/FFE1, Nordic UART 6E400001…, 18F0, E7810A71…). They are not confirmed for any specific dongle. The adapter log shows what the device actually exposed. |
| Battery voltage (ATRV + PID 0x42), cranking capture | Logic tested with the emulator. ATRV accuracy depends on the adapter (often ±0.1–0.2 V), and the sample rate limits how well a short cranking dip is caught. Confirm with a meter. |
| Freeze frame, permanent codes (Mode 0A) | Support varies by vehicle and year (Mode 0A: 2010+ in the US). An empty result can be normal. |
| Stock-file backup / flashing | **Not possible from a browser or an OBD-II adapter.** Simulated in Demo only. Real flashing stays with the wired receiver and `cartune_orchestrator.py`. |

## Admin (v11)

`node web/build.js` also builds `CarTune-Admin.html` (single file) and `web/dist/admin/index.html`. It uses the local
demo store by default (DEMO DATA, this browser; open the app and admin from the same place and they share it). Add
`?api=https://your-server` to use `server/server.js` (see `server/README.md` and `server/API.md`).
Browser checks: `python3 web/tests/admin_playwright.py --shots <dir> [--chrome /usr/bin/google-chrome]`.
