# Changelog

## 2026-10-11 (p) — v11: CarTune Admin, remote help, comps/codes/demo passes, Tune Library Vault

- **Admin app** (`web/admin/` → `CarTune-Admin.html`, served at `/admin/` from `web/dist/admin/`): Street Kit skin (brick wall, CARTUNE banner header, Night/Sun), one-time owner setup, role sign-in (owner / admin / support). Sections: Dashboard (stats + 14-day charts), Users (search, live presence online/offline + last seen, filters, edit, suspend, reset password, vehicle, package; offline accounts open too), Remote help, Packages & codes (comps with expiry or lifetime, percent/fixed discount codes with uses, expiry, package scope), Demo access (time-limited showcase codes/links), Pre-orders & shop (status + notes only, no payments), Tune vault review, Tunes & catalogue (preset overrides, makes, ECU list), Audit log, Staff.
- **API layer** (`web/shared/api.js` + `web/shared/cartune-core.js`): one interface, two backends. Local demo store (IndexedDB under a Web Lock, seed data, marked DEMO DATA, default) and a REST + WebSocket client. Accounts, licences and prices reuse the 30 Sept site (Street/Pro/Commercial/Heavy, packs, promos).
- **Server** (`server/`): Node built-ins only, JSON file store, PBKDF2 passwords, bearer sessions, role checks, per-IP rate limits, WebSocket relay for remote help, one-time setup token, serves the app and `/admin/`. Spec in `server/API.md`.
- **Customer app**: Home row + Settings entries for Get help (6-digit code, chat, accept/decline suggestions), Redeem a code (discount or showcase pass), Tune Vault (browse, download, submit). Presence heartbeat once a minute.
- **Safety unchanged**: remote help is read-only on the car; no route writes to an ECU; an accepted suggestion or vault download is saved as the customer's own tune and re-filed; every flash gate still applies. Showcase passes are demo mode only. Competition and emissions-off vault tunes keep their gates and warnings and can't be published as road-legal.
- Tests: `mobile/scripts/test-admin-api.js` (175 checks: local store + live server over HTTP/WebSocket), `web/tests/admin_playwright.py` (56 browser checks + screenshots).

## 2026-10-09 (o) — v10: a mural composed for the phone Home header

Owner, on the phone Home screenshot: "create a completely new mural relevant to the open page that is a whole picture and fits the page, not a cut done made to work".

- New: `hero-home-m-night.webp` and `hero-home-m-sun.webp`, 1200×900 (4:3, 3× a 400 px phone). One whole picture built for that slot, not a crop of the wide banner. Brick wall top and sides (MintWall kinship); the Perth skyline with port cranes (sunset in Night, blue sky in Sun) sprayed on the brick with a broken edge; the owner's CARTUNE piece big across the middle; the muscle-car line-up on wet asphalt; the black Brougham and the blown RESURECTED car in front in burnout smoke; wattle and paint drips from mural B at the edges.
- Method (`style-guide/src/mural/build_v10.py`, copy in `web/assets/street-kit/mural/src/`): no image generator was available, so the owner's own art is cut out and recomposed. Banner A (night or sun variant) is upscaled ×2 with EDSR, then the cars and the line-up are cut out with rembg, and the CARTUNE piece and the smoke with colour keys. Wattle and drips come from B. Nothing is repainted. The script draws only the brick, the wet asphalt, the contact shadows and the reflections. The Sun mural reuses the Night CARTUNE piece and smoke, because the sun banner's piece sits on bright blue paint that can't be keyed cleanly.
- Phone Home (up to 700 px) shows it whole (`contain`). Up to 600 px it fills the width; from 601 to 700 px it stays 600 px wide, centred on the brick wall. Desktop keeps the banners, and the phone Tune page keeps the fiery crop. `hero-night-m` and `hero-sun-m` are no longer shipped in the kit (still in `style-guide/assets/art3/`).
- Tests: smoke checks the 1200×900 mural at 4:3 in Night and Sun. The fit check in `screens_playwright.py` checks the phone mural box (min(vw, 600) × 0.75, drawn with `contain`) and now also runs at 700 and 320 px.
- `CarTune-App.html` is about 3.73 MB (under 4 MB).

## 2026-10-09 (n) — v9: the updated site, a brick wall, and art that fits

The owner sent two zips ("I think these are them, just check them all and you'll figure out what's superseded") and a standing rule: CarTune is the sister app to MintWall, so a brick wall has to be in the background.

### What arrived
- `index.html` (30 Sep, 255 KB), "CarTune by DFTC". A newer single-file site. It has every function the old `prototype/CarTune.html` had, plus account, legal, the story, promo links, pre-order shop, business mode and drawn unit art. No photos in it.
- A CarTune-OS tree (mostly 2–5 Aug). Same bytes as the copy already merged at v5, except two files dated 4 Oct: `mobile/src/ble/flashReceiver.ts` and a `sha256Hex` in `exportFile.ts`.

### What was superseded, and what was merged
- The August tree is the old scaffold. The project's orchestrator, tests, mobile screens and `CLAUDE.md` are the later versions (longer, and they have the safety gates). Nothing in those files was newer, so nothing was copied back.
- The 4 Oct flash file was **not** merged. It adds a new way to write a calibration to the ECU through the OBD dongle. The app's flash stays the gated receiver flow it already had, and no safety gate was removed. `sha256Hex` only existed to serve that flash file, so the existing `exportTextFile` stays.
- The site file **was** merged: it replaces `prototype/CarTune.html`. Its flash function is the same simulated one as before.

### Brick wall
- The page wall is a running-bond brick texture again (`tex-mural`, drawn by `build_v8.py`, the art itself untouched): dark bricks, pale mortar, a few rust and teal bricks and a little of the art's paint. It tiles vertically. A theme-coloured veil keeps it quiet (heavier in Sun). It shows around the cards in both themes.

### Fit
- The inner-page header used `aspect-ratio: 5/1` together with `min-height: 172px`, which between about 621 and 890 px made the header wider than the page (horizontal scroll, art clipped). The ratio is gone; the header is only as wide as the page.
- The page foot was a hard crop, and on a phone it didn't cover its box. It's now a fixed shape (`1600/500`, `1600/560` on a phone) with `cover`, so the car line stays in frame at every width.
- The Home and Tune banners are drawn at `100% 100%` of a box that is their own shape, so they aren't cropped or stretched. Section slices stay `contain`.
- `screens_playwright.py` now fails if a banner box doesn't match its art, if a slice isn't contained, if the footer or a sheet strip is wider than its box, or if the header is wider than the viewport. Those checks also run at 1024, 768 and 360.

## 2026-10-08 (m) — v8: the owner's own art sets the design

Owner: "Integrate these to the design styling." Two finished artworks of the owner's own (`style-guide/owner-art/`): **A**, three CARTUNE banners (night, sun, fire), and **B**, an Aussie line-up mural. They replace the v6/v7 photo-to-art mural and set the palette. **The art is not repainted, filtered or recoloured: only cropped, scaled and compressed to WebP.** Features and gating are unchanged.

### Artwork (`style-guide/src/mural/build_v8.py`, new; copies in `web/assets/street-kit/mural/src/`)
- A is split on its white gutters into three 2103-wide banners: night (2103×293), sun (2103×243), fire (2103×198), WebP q84. Phone crops (`-m`, q86) keep the whole CARTUNE piece and the RESURECTED car.
- B is shipped whole as `app-header` (1600×569) and cut into 9 section slices (`bn-*`) with a feathered alpha edge (the only change to it), three natives as empty states (`st-cocky`, `st-swan`, `st-kooka`, feathered oval) and the splash corner (`tex-peel`).
- `tex-mural` (page wall) and `tex-rule` (spray rule) are still procedural, now black concrete with splashes and drips in the art palette; `tex-tags` is kept. The v6/v7 mural, sketch pieces and `st-gt/ute/ute-white` are removed from the kit (`mural/`: 23 files, 1.75 MB).

### Web app
- **Home hero:** the night banner (Night) or sun banner (Sun), full-bleed at its own aspect with nothing over it; the controls sit in a dark strip below, edged with the spray rule. The art's CARTUNE lettering replaces the text wordmark there (it stays for screen readers). Phones (≤620 px) get the crops.
- **Fire banner:** the Tune page (detail view) hero, and a strip across the top of the Flash sheet (confirm, competition gate, done). The "careful mate" tape moves to the top-left there.
- **Inner pages:** mural B is the header on Live data, Diagnostics and Tune spec (per-tab framing) and is faded in again as the page foot. B slices sit in section headings and panel/sheet tops, B's natives in the scan and report empty states, B's splash corner on cards/panels/sheets. Vehicle line icons are kept.
- **Palette (tokens v2.0, sampled with `style-guide/src/sample_art.py`):** new ART PALETTE block (`--c-wall` #171717, `--c-smoke` #EDEDEC, `--c-sky` #36B5DD, `--c-letter-blue` #049ADB, `--c-bush` #6DA339, `--c-sunset` #F46E36, `--c-sunset-glow` #FD8E34, `--c-sunset-deep` #A8360C, `--c-flame` #F4621E, `--c-torana` #C32815, `--c-gold` #EDB006, `--c-wattle` #EBC00F …). Legacy names keep working and now hold art colours. Night: smoke text, sunset primary with ink text, sky links, cobalt "read from car", letter-blue glow, wattle highlights. Sun: smoke-wash page, sunset-deep accent, deep-sky links, cobalt-deep focus. Status colours unchanged.
- **Headings:** a wattle paint stroke with drips under section headings (sunset-deep in Sun); big headings get the CARTUNE piece's blue keyline and black drop. The inner-page wordmark is Sedgwick graffiti in smoke with a letter-blue keyline.
- Theme colour, manifest colours and the app icon use the art palette.
- `CarTune-App.html` is about 3.3 MB (under the 4 MB target).

### Style guide (v2.0)
- Hero is the night banner (sun banner in Sun mode, crops on phones); a new 00 Imagery section shows A, the phone crops, B, its slices, the natives and the procedural pieces; the palette-source table now maps sampled art pixels to tokens; an "Art palette" swatch group; graffiti wordmark and drip-stroke headings (`.drip-head`, `.drip-head--key`). Images already inlined as `--img-*` tokens are drawn from the token instead of being inlined twice (guide ~3.4 MB).

### Tests
- `smoke_playwright.py` (114 checks) replaces the v6 art checks: Night and Sun show different banners at their own aspect, phone crops at 400 px, B on the capture tab, the fire banner on the tune page, the desktop Home banner full width.
- `screens_playwright.py` adds screen 29 (Tune page fire hero) and 30 (Flash sheet strip) and puts the Flash sheet in the contrast pass. `art_checks.py` reports each art layer's fingerprint and size, and skips text inside a closed `<details>`.

## 2026-09-27 (l) — v7: vehicles redrawn as realistic sketch / tattoo linework

Owner feedback: "push the artwork a bit more, the vehicles need to be a bit more of a realistic sketch / tattoo outline style than sticker type." Only the way the vehicles are rendered changed. The mural layout, where the art sits in the app, features, gating and the contrast rules are the same as v6.

### Artwork (`style-guide/src/mural/sketch.py`, new)
- The sticker treatment is gone: no cream die-cut ring, no thick uniform outline, no 3D block shadow, no posterised fills. Every vehicle in the mural, the section pieces (`bn-*`) and the empty-state art (`st-*`) is now drawn procedurally from the super-resolved cut-outs, like a tattoo artist would:
  - tone from CLAHE-lifted luminance with edge-preserving smoothing, mapped through an S-curve so lit panels stay open paper and deep shadows go solid black;
  - an edge-tangent flow field (structure tensor). The car is split into hand-sized SLIC patches, and each patch is hatched along its own mean contour direction, pulled a little toward a common diagonal;
  - shading in tonal bands: whip-shading flicks in the light greys, then single hatch, cross-hatch and a third hatch direction. Solid black goes in the tyres, glass and grille gaps. Hatch lines swell with darkness and pen pressure wanders;
  - linework traced as strokes (Canny at two scales, then pixel paths, then smoothed polylines) and redrawn with pressure: heavy on the silhouette and lower body, medium on the main panel lines, fine on detail (grilles, wheels, reflections), with tapered ends. Everything is drawn at 2x and downsampled so the ink is antialiased;
  - colour as tattoo washes only where the real paint is coloured, from the palette (Rust Slash, Teal, Diamond Glow, Cobalt), granulated, slightly off register, and kept out of the highlights so bare paper shows;
  - a cream paper/skin ground that gives way to the wall in the deep shadows and bleeds out with a dry-brush edge (the drawings sit in the mural like a flash sheet painted on the wall). Where a silhouette crosses the bare wall its line turns cream (white-ink rim light) so the drawing still reads in Night; loose whip strokes make the ground shadow.
- 01 (Resurected) is a printed sticker, so its white die-cut backing is knocked out first (`sources.unsticker`). The burnout, smoke and RESURECTED lettering now sit straight on the wall; the plate is still the owner's, pasted back crisp.
- Custom plates are pasted back crisp after drawing (and only where the plate is inside the cut-out). The Kenworth (05), GTS (07) and Statesman (02) badges are still painted out before drawing.
- On the mural the vehicles are laid in with low wall relief so the sun's stripes don't print through the paper.
- Sizes: `app-header` 237 KB, `app-header-m` 137 KB, `bn-*` 75–96 KB each, `st-*` 20–29 KB. Hatching compresses less well than flat fills, so `CarTune-App.html` grows from 2.3 MB to about 2.8 MB (target under 4 MB).

### Tests
- No test changes were needed. The art-load checks and the WCAG AA text-over-art check pass in Night and Sun at 1440 and 400 px (worst run 4.93:1).

## 2026-09-27 (k) — v6: the owner's photos become street-art artwork

Owner feedback: the photos looked "just placed there". They're now painted artwork in the house style ("WA united underground graffiti rebellion"), with one masterpiece mural at the top and the art used "a lot but subtly" everywhere else, the way the MintWall app layers its art. Features and gating are unchanged.

### Artwork (`style-guide/src/mural/`, output in `web/assets/street-kit/mural/`)
- Procedural pipeline (no image-generation tool was available): EDSR super-resolution (OpenCV dnn_superres, x4 for the 960 px line-up 09 and the FG 04, x2 for 01, 05 and 11), rembg cut-outs, then per vehicle: bilateral and mean-shift smoothing, Lab k-means posterise, pull to the style-guide palette (Wet Asphalt, Night Brick, Cream, Rust Slash, Teal, Diamond Glow, Cobalt), halftone in the shadows, cream highlights, bold ink lines, spray grain, ink outline, cream die-cut ring, 3D block shadow, overspray and drips. Walls are procedural brick with grime, water streaks and peeling ghost paint; sunbursts, graffiti tags (Sedgwick Ave, Permanent Marker, Black Ops One, Mr Dafoe, Knewave), spray bands, wave bands and a wet street reflection.
- **Masterpiece mural** (`app-header` 2400×960, `app-header-m` 1000×1250): the XB line-up (09) is the showpiece, with the Resurected burnout (01) and the black FG Falcon (04) as the headliners, over a sunburst, a retro sun, "WA UNITED", "FAIR GO" and "mates first" tags, a teal wave band and a wet street.
- 9 section pieces (`bn-*`, transparent), 3 painted die-cut stickers (`st-*`), and textures: `tex-mural` (page wall, tiles vertically), `tex-peel` (MintWall-style peeling paint), `tex-tags` (tag scribbles), `tex-rule` (spray-paint divider).
- Custom plates are pasted back crisp after painting; the RESURECTED plate and lettering keep their spelling. The Kenworth bonnet script and grille emblem (05), the HJ's GTS guard badge (07) and the Statesman ornament and grille emblem (02) are painted out before stylising.
- The v5 photo slots (`web/assets/street-kit/photos/`) are no longer shipped in the web kit (they're still in `style-guide/assets/photos/`).

### Web app
- `web/build.js` inlines `street-kit/mural/`: `<name>.webp` → `--ph-<name>` (overriding the photo slots), `tex-<name>.webp` → `--art-<name>`. `art/hero-photo.*` still overrides the header. The drawn `tex-brick` is only used when there's no mural wall.
- Header: the mural, whole on Home (12:5 desktop, 4:5 phone, wordmark top-left on a scrim) and as a slice on the other tabs and the tune page.
- Section headings (Home, Live data, Diagnostics, Tune spec, tune page): the photo banners are replaced by a painted piece faded in on the right (opacity 0.55 Night / 0.5 Sun, masked out before the text) plus a spray-paint rule. The heading uses the theme's text colour.
- Page wall (both themes), card and panel corners (peeling paint behind a surface-coloured veil), tag scribbles in the theme's ink in tile, panel, sheet and hero corners, painted strips on the live, report, connect and settings panels, and a faded mural footer. The vehicle line icons (`--i-car` and the others) are kept.
- `prefers-contrast: more` and print drop the art layers.

### Tests
- New `web/tests/art_checks.py`: art-load check (each layer is an inlined data URL that decodes) and a WCAG AA contrast check for text over art.
- `smoke_playwright.py`: 93 → 110 checks (the art layers load in Night and Sun; the phone and desktop murals, tall on Home and a slice on the other tabs).
- `screens_playwright.py`: v6 shots 19–28 in Night and Sun at 1440 and 400 px, art-load problems, and AA contrast over art on every tab, the tune page and the sheets (`contrast-<width>-<theme>.json`).

## 2026-09-27 (j) — v5: merge of the 2026-09-26/27 source into the web app build

Three-way merge: baseline `cartune-src` → the user's newer source (tune logic, presets, filing, ECU profiles, make list, mobile screens win) → our v4 build (diagnostics, `electrical_diag.py`, reply-header fix, web build, Street Kit skin, photos and tests kept).

### Merged as is (user's version)
- `mobile/src/tune/rules.ts`, `filing.ts` (new), `ecu/ecuProfiles.ts`, `state/CarTuneContext.tsx`, `screens/{EditVehicle,Flash,Tune}Screen.tsx`, `CarTune-App-Preview.html`, `mobile/scripts/app-preview.template.html`, `mobile/scripts/test-tune-rules.js`, and the new `prototype/` folder. None of these had v4 edits, so there were no code conflicts.
- CLAUDE.md merged cleanly. CHANGELOG.md: both sides added entries at the top; kept the user's entries first, then ours.

### Web app (`CarTune-App.html`, `web/dist/`)
- **Tune page:** tabs from `segmentsFor` (Fuel, Timing, Boost, Throttle, Limits, Transmission, Brakes & Traction, Cooling, Emissions) with worst-zone dots including switches; the 12 new sliders; the on/off switches as 48 px street-style switch cards; red switches sit under a "Lift cover" guard at their factory setting (from the prototype).
- **"Fix it with other settings"** (RELIEF) is listed before "Or adjust this one" / "Or undo it", 4 at a time plus "N more ways", each with its why line.
- **Filing:** presets stay as shipped and run in the new order. The first change saves "My <Preset> N", filed by `fileTune` (permission first, then performance); every change re-files it, and moves are announced. The filed card shows the folder, permission and reasons, with Rename / Delete. Folder chips switch between a preset and the tunes filed in it. Home shows "N of yours" on preset tiles and a "Your own tunes" list. The dock's Reset becomes "Start again" (from the base preset). Edited tunes from v4 (`slots:<car>`) are migrated once.
- **Emissions switches** stay behind the user agreement (Cancel / I accept), which is stored per browser and can be withdrawn in Settings. Tunes with them are filed at Competition and off-road.
- **Packages (demo):** a Settings chip row; the Edit vehicle ECU list uses `profilesForPackage`; the picker only offers trucks with Commercial, and ag/earthmoving with Heavy.
- **Vehicle picker:** Type → Make → Model → Generation → Engine → Transmission with search, breadcrumbs, auto-skip and a confirm card, over the prototype catalogue (635 models: 57 car, 15 truck, 12 ag, 15 earthmoving makes). `prototype/makes.js` is inlined by `web/build.js`, so there is one make list. EVs are shown but can't be tuned. In Demo mode the picked vehicle becomes the simulated car (made-up VIN starting CTDEMO); with a real adapter only the details change.
- **Flash gates (added, none removed):** permission level and reasons shown; Competition tunes need an extra acknowledgement; emissions changes need the agreement; a pull log counts only for the values it was logged with; typing FLASH and demo-only flashing unchanged.
- Fixed: the flash sheet's gate markers had no size (only the hero's did).

### Tests
- `mobile/scripts/run-node-tests.js` gives `test-tune-rules.js` flat aliases (`./rules`, `./filing`, `./presets`) so it runs unchanged.
- New `mobile/scripts/test-catalog-filing.js`: catalogue counts, every catalogue ECU id exists, EVs have no ECU, packages, and filing invariants for every switch on every engine.
- `web/tests/smoke_playwright.py`: 59 → 93 checks (new tabs, switches, lift cover, filing, agreement, flash gates, fix-it, Home, packages, picker).
- `web/tests/screens_playwright.py`: v5 screens at 1440/400 px in Night and Sun.

### Not ported / notes
- The prototype's licences, prices, cart and shop aren't in the web app (no store or purchase flow). `prototype/build.py` still uses its original machine paths (`/tmp/tsx`, `/mnt/user-data/outputs`) and was left untouched; `prototype/CarTune.html` is the user's prebuilt file.
- The mobile TuneScreen (user's version) asks for the agreement but doesn't use `filing.ts` yet; the filing UI is in the web app and the prototype.

## 2026-09-27 — Tune order, factory start, auto-filed user tunes, full make list, per-make licences

- Presets now run in order of permission then power: Factory, Economical, Comfort, Highway, Day Use, Handling, Sport, Off-Road, Burnout, Holeshot, Race. The tune page opens on Factory.
- `mobile/src/tune/filing.ts`: presets stay as shipped; any change saves a user tune, auto-filed under the closest preset by performance, but only among presets whose permission level (Factory / Road / Sport / Off-road and competition) covers every safety system or restriction the tune lifts. Permission always overrides performance, so a factory-like tune with anything lifted is never filed under Factory. Re-files automatically on every change.
- Prototype (`prototype/`): 635 models across 57 car makes, 15 truck, 12 ag and 15 earthmoving makes; per-manufacturer licences; every catalogue engine mapped to an ECU family (new: GM E39/E69/E77 V6, Transtron Isuzu).

## 2026-09-26 — Cross-setting fixes, TCM/ABS/throttle, on/off switches, packages

### Added
- **"Fix it with other settings"** on every slider and switch that isn't green, listed first, above "Or adjust this one". Each fix names the other setting, the value it moves to, and why (e.g. knock sensitivity → pull timing, richen mixture, fans on sooner, over-temp sooner, better fuel, intercooler). Only fixes that actually change something are shown. Map lives in `RELIEF` in `mobile/src/tune/rules.ts`.
- **New tabs:** Throttle, Brakes & Traction, Emissions.
- **New sliders (12):** throttle opening speed, throttle closing delay, launch control rpm; TCM: full-throttle shift point, shift speed, line pressure, converter lock-up speed, kickdown eagerness; ABS/ESC: traction slip allowance, stability intervention, ABS slip target, brake-throttle override delay.
- **On/off switches (30)** across every tab: decel fuel cut, closed loop, flex fuel, knock sensors, overboost cut, anti-lag, sport pedal default, speed limiter, launch control, flat shift, pops & crackles, start-stop, converter lock-up, auto-upshift, skip-shift, tow mode, traction control, stability control, ABS, brake override, hill hold, A/C cut, fan run-on, and EGR / DPF / SCR / swirl flaps / cat monitor / rear O2 / EVAP.
- **User agreement:** emissions switches ask once for acceptance, then work normally; a warning card lists what was changed.
- **Packages:** Standard (passenger), Commercial (+ trucks), Heavy (+ trucks + machinery). ECU lists in the app only show what the package includes, so trucks and machinery stay out of the public build. Prices are set in the store.

### Note
- Switch-to-ECU mapping is per definition file (e.g. the Barra's "Knock Sensor: Enable" scalar). Families without a definition show the switch but the receiver skips it until mapped.

## 2026-09-26 (i) — Owner's photos (web app)

### Changed
- The art is now the owner's own photos, street-art treated (cut-outs, paste-up and die-cut sticker borders, torn paper, drips, halftone, a gentle grade; the vehicles stay true-colour):
  - header: the XB coupe line-up as a paste-up poster, the owner's "Resurected" sticker (01) and the black FG Falcon (04). There's a separate phone version.
  - section headings are torn paste-up photo banners: Tunes (XB line-up, the big feature banner), Live data (FG ute), Diagnostics (Kenworth), Tune spec (HJ GTS), and the tune detail (white ute)
  - photo strips on the live dashboard panel (XB GT), report panel (Impala), connect sheet (F250) and settings sheet (coupe on the trailer)
  - die-cut photo stickers on the scan and report empty states
- Number plates are replaced with custom WA-style CarTune plates matched to each screen (CARTUNE, MATES, DIAG, 98 RON, SPEC IT, FAIR GO, TUNE IT, ALL PASS, OBD2). The owner's RESURECTED plate is kept as is. People are cropped or kept small.
- `web/build.js` inlines every image in `web/assets/street-kit/photos/` as `--ph-<name>`. The drawn art is now a fallback only; `art/hero-photo.*` still overrides the header.
- No functional changes. The single file is about 1.6 MB (was 1.1 MB).

### Added
- `web/tests/screens_playwright.py` also saves header, Tunes banner, settings and panel close-ups.

## 2026-09-26 (h) — Street Kit reskin (web app)

### Changed
- The whole web app (`CarTune-App.html`, `web/dist/`) is reskinned in the CarTune Street Style Guide v1.1:
  - wet-asphalt night palette with a Sun theme
  - Barlow Condensed / Big Shoulders Stencil headings, Permanent Marker tags, JetBrains Mono readouts
  - banner header with the new hero art (a generic silver long-nose prime mover and a muscle car)
  - rust tabs, sticker art on section headings and empty states
  - hazard-tape Demo banners, and a "careful mate" tape on the clear-codes and flash sheets
- Data screens stay flat and high contrast:
  - mono readouts in sunk wells
  - 48 px targets
  - status badges carry an icon plus text as well as colour
- New **Night / Sun toggle** in the header (`web/src/85-skin.js`). The Settings theme chips are now Auto / Night / Sun, and older stored `dark`/`light` values are migrated.
- `web/build.js` inlines the Street Kit tokens, fonts and art (`web/assets/street-kit/`) and supports a hero photo override (`art/hero-photo.*`). The manifest colours and PWA icon match the new palette.
- No functional changes: Web Serial / Web Bluetooth ELM327, the demo adapter, clear-codes confirmation and all calculators are untouched.

### Removed
- `web/assets/fonts.css` (replaced by `web/assets/street-kit/`).

### Added
- `web/tests/screens_playwright.py`: screenshots plus a layout check at 1440 and 400 px in both themes (no console errors, no horizontal scroll).

## 2026-09-26 (g) — Runnable browser app + vehicle electrical diagnostics

### Added
- **Browser app** `CarTune-App.html` (single file, works offline) and `web/dist/` (PWA). It keeps the App Preview screens: Home, tune detail, Pro tables, Pro settings, Flash sheet, Edit vehicle and Settings.
  - Connection: real OBD-II through **Web Serial** (USB ELM327/OBDLink) and **Web Bluetooth** (BLE; tries the FFF0, FFE0, Nordic UART, 18F0 and E7810A71 services), plus a labelled **Demo adapter**.
  - New tabs: Live data (capture and `mobile_capture.json` export), Tune spec (`tune_spec.json` export) and Diagnostics.
  - Built by `web/build.js` from the shared `mobile/src` logic.
- **Diagnostics tools:**
  - guided workflow with notes per vehicle
  - DTC scan: modes 03, 07 and 0A with descriptions, freeze frame (02), and clear (04) behind a checkbox plus typed CLEAR
  - live dashboard with CSV logging
  - battery state of charge, cranking (temperature-corrected), charging (smart charging aware) and ripple tests, with ATRV + PID 0x42 auto-fill and an experimental cranking-minimum capture
  - voltage-drop single test and power/ground circuit wizard
  - parasitic draw, module sleep timer, and fuse voltage drop → current with an editable fuse resistance table
  - circuit fault decision trees (open, short to ground, short to power, high resistance, intermittent)
  - 3-wire sensor check and meter-vs-scan comparison
  - CAN termination (pin 6↔14) and CAN-H/L voltage interpreters, plus DLC pinout
  - safety notes
  - printable HTML and JSON report
  - Thresholds are editable and labelled as general guidelines.
- `mobile/src/ble/obdSession.ts`, `elmEmulator.ts`, `sharedSession.ts`; robust reply parsing in `elm327.ts` (headers on/off, ISO-TP multi-frame, legacy protocols, error replies); 9 more Mode 01 PIDs; Mode 0A, 0904 and ATRV.
- `mobile/src/diag/*` and `mobile/src/screens/DiagnosticsScreen.tsx` (registered in `App.tsx`, linked from Home).
- `electrical_diag.py`, a Python mirror of the calculators, with a CLI available as `cartune_orchestrator.py --electrical-diag ...`. Exit codes: 0 pass, 1 warn, 2 fail, 3 error.
- Tests:
  - `tests/test_electrical_diag.py` (74 tests), using the shared vectors in `mock_data/diag_test_vectors.json`
  - `mobile/scripts/test-elm327.js` (75 checks), `test-diag.js` (262 checks), and the `run-node-tests.js` runner
  - `web/tests/smoke_playwright.py` (59 checks)

### Fixed
- CaptureScreen and useAutoDetect decoded ELM327 replies as if headers were off, although `INIT_SEQUENCE` sets `ATH1`. They now use `ObdSession`.
- Clearing codes in the mobile app goes through `ObdSession.clearDtcs({confirmed: true})`.

### Honest limits
- None of the new adapter code has been run against a real adapter or car yet. This covers Web Serial, Web Bluetooth (headless Linux Chrome has no `navigator.bluetooth`) and the BLE UUIDs.
- The browser cannot back up or flash an ECU. The flash flow is simulated in Demo only.
- Fuse resistances are approximate; all thresholds are guidelines, not manufacturer specs.

## 2026-09-25 (f) — Heavy trucks and machinery

### Added
- **13 heavy-duty ECU profiles** in `mobile/src/ecu/ecuProfiles.ts`, now grouped by `category`:
  - Commercial: Cummins CM2350/CM2450 (X15 — Kenworth, Western Star, Peterbilt, International), PACCAR MX-11/MX-13 (Kenworth, DAF), Detroit DD13/15/16, Volvo/Mack/UD, Isuzu/Hino/Fuso, Scania/MAN/Iveco/Mercedes trucks, pre-J1939 J1708/J1587 trucks.
  - Machinery: Caterpillar ADEM A4/A5, John Deere, CNH (Case IH/New Holland/Steyr), Kubota, Komatsu, JCB.
- New protocols `J1939/CAN` (250k, 29-bit, UDS via 18DA<ta><sa>) and `J1708`; connector field (OBD-II 16-pin / Deutsch 9-pin / Deutsch 6-pin / maker-specific).
- `J1939_MODULES`: engine, transmission, ABS/EBS, retarder, cluster, body, cab, aftertreatment source addresses — one connection reaches every module.
- New status **`oem-only`** ("Read only"): live data + fault codes work; writing needs the maker's tool (named in `oemTool`). `receiverProfile()` now sends `writable` and `emissionsNotice`.
- `emissionsNotice` on every heavy profile: DPF/SCR/EGR changes show the standard warning and need user-agreement acceptance. Never blocked — off-road, agriculture and export are core markets.
- Heavy-truck VIN makers in `detect.ts` (Kenworth, Peterbilt, Mack, Freightliner, Volvo, International, Isuzu, Scania, MAN, DAF, Iveco).
- Orchestrator: `J1939_MODULES`, PGN/source-address helpers and a J1939-73 DM1 fault-code decoder (SPN/FMI/count), with `tests/test_j1939.py` (7 tests).

### Honest limits
- Heavy/machinery profiles are **read-only** until each maker's unlock is built or licensed. Cat CDL needs Cat's adapter; Deere needs payload files.
- Isuzu/Hino/Fuso, Kubota, Komatsu and JCB entries are marked low-confidence in their notes — verify on a real machine.
- Australian-built Kenworth VINs may use a code not in the table; unknown codes show as unknown, not guessed.

## 2026-09-25 (e) — Real Barra data from the HP Tuners file

### Added
- `mobile/src/tune/barraData.ts`: data transcribed from all 54 photos of the HACCKG6 VCM Editor session (Spanish Oak 1024K, 2006 Ford Australia, "NISSAN PATROL BARRA HPTUNERS.hpt"). Source notes and generator in `barra_source/`.
  - **18 real tables, every cell:** knock gain cyl 1–6 (load × rpm), knock window offset cyl 1–6 + load adder, indicated engine torque, predicted load, engine friction torque, fuel cranking vs ECT, cranking fuel vs PIP count.
  - **198 real settings** in 16 groups: limits & cutoffs, decel fuel cut, oil over-temp, injectors, fuel control/O2/LTFT, temperature protection, turbo & boost, airflow & sensors, throttle, cam timing, intake runners, idle, fans & A/C, torque management, transmission, security & system.
  - The HP Tuners menu layout for this OS (names of every table group, including ones not photographed).
- Pro tables now open with the real tables first ("Real values · From your file · HPT #id"); platform tables without captured data stay marked "demo".
- **Pro Settings** list (`ProSettingsScreen.tsx` + preview): searchable, grouped, editable, each change shown against the file value.

### Corrected
- "Overtemp cutoff 7,000 rpm" was two separate settings: the temperature-based rpm cut (7,000) and oil over-temp protection's enable rpm (7,000).

### Notes
- Knock Gain Cyl 6's title was cut off in its photo (placed by sequence); Knock Window Offset Cyl 6's last row was cut off (assumed 0). Both flagged in the data.
- Two photos were an HP Tuners order receipt; nothing from them was used.

## 2026-09-25 (d) — Detail levels + pro tables

### Added
- **Three detail levels on every tune** (switch at the top of the tune screen):
  - *Simply*: 8 core sliders.
  - *With detail*: adds cruise mixture, part-throttle timing, idle speed.
  - *Technically*: adds knock sensitivity, hot-air timing pull, over-temp threshold, torque limiter; widens every slider to an open "pro" range; unlocks **Pro tables**.
- **Pro tables** (`ProTablesScreen.tsx`, `src/tune/tables.ts`): every calibration table for the ECU family, cell-by-cell. Heat-mapped grid, drag or range select, ±step, ±%, set, smooth, interpolate, copy/paste to spreadsheets (tab-separated), undo, revert to base, changed-cell marking. Safety overlay flags cells (e.g. base spark past borderline knock, lean PE lambda under boost, rev limit past stock) but never blocks.
- **Ford Spanish Oak (Barra) table map**: 25 tables across Fuel, Spark, Knock, Airflow & Boost, Limits & Protection, Driver demand, Idle, Cooling. Tables seen in the HACCKG6 HP Tuners file are marked "From your file" (stoich 14.64, rev limiter 6,350, over-temp cutoff 7,000, per-cylinder knock gain and window offset); the rest are marked "Platform table, confirm vs your file". Grid values are demo placeholders until the stock read is decoded.

## 2026-09-25 (c) — Home-first app

### Changed
- **Home screen is now the front page** (`HomeScreen.tsx`): vehicle card that fills itself in as the car is read (receiver → VIN → ECU → stock-file backup, skeleton placeholders instead of spinners, every field editable), fuel and fitted-parts chips, "On the car now", and the **11 saved tune categories** (Factory, Economical, Highway, Comfort, Day Use, Sport, Handling, Holeshot, Race, Burnout, Off-Road). Each tile holds the stock read as its base file, shows power/economy, and is coloured by risk for this exact car.
- Tapping a tile opens its detail (`TuneScreen.tsx`): summary first, sliders in tabs below, edits save instantly, Flash docked at the bottom.
- Flash flow checks: car connected → stock backed up → logged pull passed (when needed) → type FLASH.
- Navigation is now a stack (Home → Tune → Flash), Live data and Tune spec kept as secondary screens.

### Added
- `src/tune/presets.ts` (11 categories as slider positions, per engine type), `src/state/CarTuneContext.tsx`, `src/vehicle/detect.ts` (VIN make/year decode, OS-ID → ECU family), `src/vehicle/useAutoDetect.ts`, `EditVehicleScreen.tsx`.
- `CarTune-App-Preview.html` replaces the old tune-only preview. Rebuild with `mobile/scripts/build-preview.py`.

### Not yet
- Generating the calibration file from slider positions needs each ECU family's table map (definition file). Until then Flash still takes a prepared file.

## 2026-09-25 (b) — Slider tuning + all manufacturers

### Added
- **Tune screen** (`mobile/src/screens/TuneScreen.tsx`, `components/ZoneSlider.tsx`): one slider per setting, grouped into Fuel / Timing / Boost / Limits / Transmission / Cooling tabs. Track split green / yellow / orange / red; zones adapt live to fuel, fitted upgrades and the other sliders. Each position explains its effect; non-green settings show tap-to-apply "To balance it" fixes; orange/red expand "What can go wrong". Explanations at three levels (Simply / With detail / Technically). Petrol, turbo petrol and turbo diesel setting sets.
- **Rules engine** (`mobile/src/tune/rules.ts`): pure TypeScript, shared by app and web preview. Thresholds are general starting points, labelled as such; the logged-pull gate still applies before any flash. No emissions-delete settings.
- **All-manufacturer ECU registry** (`mobile/src/ecu/ecuProfiles.ts`): Ford, GM/Delco, Bosch MED17/EDC17/EDC16, Denso (Toyota, Subaru/Mazda), Hitachi (Nissan), Mitsubishi, Continental/Siemens, Delphi, Marelli, legacy K-line. Each has an honest status (ready / unlock coming / bench only / older protocol).
- Receiver protocol **v1.1**: `PROFILE:SET` selects the ECU family and unlock plug-in; Flash screen gains an ECU type picker.
- `CarTune-Tune-Preview.html`: browser preview of the Tune screen.
- `mobile/scripts/test-tune-rules.js`, `test-flash-protocol.js` (run against tsc output).

## 2026-09-25 — Safety fixes + wireless flash

### Fixed (safety-critical)
- **FlasherAgent** no longer returns `flashed: True` unconditionally. It flashes only via a configured command (`--flash-cmd` / `CARTUNE_FLASH_CMD`), verifies by readback SHA-256 (`--readback-cmd` / `CARTUNE_READBACK_CMD`), and reports `flashed`/`verified` honestly. Result saved to `flash_result.json`.
- **ValidatorAgent `_check_limits()`** now does real checks instead of always returning True: images exist, same size, not blank, and tune-spec values within sanity ranges (rev limiter, shift points, TCC lockup, WOT/cruise AFR, shift ≤ rev limiter). Fails before the copilot or the confirm prompt.
- **LoggerAgent** commits with a repo-local identity, so it works with no global git config, and reports `committed: False` with a reason instead of failing silently.

### Added
- `CarTune-Flash-Receiver-Protocol.md` — open, vendor-neutral receiver command set (BLE Nordic UART / Wi-Fi TCP 8890).
- Mobile: `src/ble/flashReceiver.ts` (protocol client + BLE and Wi-Fi transports), `src/utils/sha256.ts`, `src/screens/FlashScreen.tsx` (pick → connect → send → verify checksum → type FLASH → poll), new **Flash** tab.
- Tests: `test_flasher_agent.py`, `test_logger_agent.py`, and new `_check_limits` tests. **115 passing.** Mobile protocol code checked with `tsc --strict` and exercised against a mock receiver (checksum match, corruption caught, FAILED reported, non-CarTune device rejected, lost contact → unknown).

## Unreleased (2)

### Added
- **Real reference data**: `definitions_index.json` now has one genuinely
  verified entry (OS-ID `HACCKG6`) from an actual `.hpt` tune file — a 2006
  Ford Australia Barra I6 ECM. Confirmed real-world numbers now documented
  in `CLAUDE.md`: Stoich AFR 14.64, rev limiter 6,350 rpm, overtemp cutoff
  7,000 rpm, per-cylinder knock gain/window offset calibration tables.
- `hptuners` added as a real `--editor` choice — HP Tuners VCM Editor is a
  genuinely in-use tool (confirmed via the same tune file), though its
  launch command is still an unverified placeholder like the other GUI tools.
- `DefinitionMatchAgent` docstring updated: HP Tuners matches OS-ID against
  its own closed database rather than an open XDF file, so a matched
  HP-Tuners entry has `definition_path: null` by design.

### Fixed
- `Agent.__init__` now coerces `session_dir` to a `Path` — a plain string
  used to fail with a cryptic `TypeError` three calls deep inside `outfile()`.

### Known gap (unchanged)
- The uploaded data is calibration-table data (how the ECU computes/limits
  knock), not a live scanner/PID channel list — `custom_pid_reader` still
  has no real knock_retard/afr source. Needs an HP Tuners VCM Scanner
  channel export or equivalent for the HACCKG6 platform specifically.

## Unreleased (1)

### Added
- `DefinitionMatchAgent` — matches a read binary's OS-ID against a local
  `definitions_index.json`, falling back to `VehicleLookupAgent` on no match.
- `--autodetect-protocol` — probes known CAN bitrate/FD combos instead of
  requiring them upfront; caches the result per-VIN.
- `UpdateCheckAgent.digest()` (`--check-updates --digest`) — plain-English
  per-tool summary instead of a raw commit list.
- **Pull-data safety gate rework:** the former "dyno gate" now accepts
  either a real dyno CSV (`--dyno-log`) or a self-logged WOT pull
  (`--pid-log`, via new `SelfLoggedPullAgent`). The knock/AFR/coolant
  thresholds are unchanged either way — this was never a dyno-specific or
  road-legal requirement, only a data-source requirement.
- `PidCaptureAgent` (`--capture-pull`) — live-PID polling loop (Enter to
  start/stop) that produces a `--pid-log`-ready file. `rpm`/`coolant_c` are
  real reads via `python-obd`'s standard Mode 01 PIDs; `knock_retard`/`afr`
  are exposed via an injectable `custom_pid_reader` hook (genuinely
  platform-specific, not fabricated).
- `DiagnosticsAgent.os_id` — real read via `python-obd`'s Mode 09
  Calibration ID PID (a standard SAE J1979 PID, not manufacturer-secret),
  degrading to `None` if the library/adapter/PCM doesn't support it.
- `CommunityTuneAgent` (`--publish-tune`, `--check-community OS_ID`) — local
  shared repo of validated `tune_spec` + `validation_report` pairs, keyed by
  OS-ID. Publish is gated on an actually-passed validation.
- `requirements.txt`, `LICENSE` (MIT), `README.md`, `.gitignore`,
  `.github/workflows/tests.yml`, and a startup safety banner in the CLI.

### Changed
- `ValidatorAgent`'s refusal message no longer implies a dyno is
  specifically required — states both accepted data sources.

### Known gaps (see `CLAUDE.md` for full detail)
- `PidCaptureAgent.custom_pid_reader` has no default implementation —
  knock retard / precise AFR still need a platform-specific tool wired in.
- `CommunityTuneAgent` writes to a local directory only; no real shared
  git remote yet.
- Binary read/write to the PCM itself still goes through whichever
  external tool the design doc names per platform — not reimplemented here.
