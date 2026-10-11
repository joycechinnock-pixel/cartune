# Street Kit artwork (v8: the owner's own art)

Cut from the owner's two artworks (`style-guide/owner-art/A-cartune-banners.png`,
`B-aussie-lineup-mural.png`, both 2103×748) by `style-guide/src/mural/build_v8.py`
(`/workspace/.art-venv/bin/python src/mural/build_v8.py all` from `style-guide/`
recrops them into `assets/art3/` and exports here). **The art is never repainted,
filtered or recoloured: only cropped, scaled and compressed (WebP).**
`web/build.js` inlines every WebP here: `<name>.webp` → `--ph-<name>`,
`tex-<name>.webp` → `--art-<name>`.

| file | size | what |
|---|---|---|
| hero-night.webp | 2103×293 | A, night banner (rows 0–293): Home hero in Night |
| hero-sun.webp | 2103×243 | A, sun banner (rows 300–543): Home hero in Sun |
| hero-fire.webp | 2103×198 | A, fire banner (rows 550–748): Tune page hero, Flash sheet strip |
| hero-home-m-night.webp / hero-home-m-sun.webp | 1200×900 | v10: the phone Home mural (≤700 px), one whole 4:3 picture recomposed from the owner's own art (`src/build_v10.py`) |
| hero-fire-m.webp | 890×198 | phone Tune page + Flash sheet strip: the whole CARTUNE piece + the RESURECTED car |
| app-header.webp | 1600×569 | B whole: inner-page header (Live data, Diagnostics, Tune spec) and the page foot |
| bn-*.webp | 600–900 wide | slices of B with a feathered alpha edge, faded in on the right of section headings and panel/sheet tops: tunes (GTS Monaro, orange coupe, Torana), live (Torana + Commodore), diag (FJ + EK), spec (skyline + black swan), detail (Commodores), dash (orange coupe), report (blue coupe + EK), connect (cockatoo + wattle), settings (drips, blue splash, kookaburra) |
| st-cocky / st-swan / st-kooka.webp | ~250–290 wide | B's cockatoo, black swan and kookaburra (feathered oval): empty states |
| tex-peel.webp | 543×270 | B's splash corner (yellow drips, blue splash): card, panel and sheet corners behind a veil |
| tex-mural.webp | 1600×1008 | page wall: running-bond brick (MintWall kinship) with a little of the art's paint. Tiles vertically. The owner's art is not in this file. |
| tex-rule.webp | | spray rule: wattle stroke, sky kiss, splatter and drips (procedural, art palette) |
| tex-tags.webp | | tag scribbles (mask, theme ink), kept from v6 |

The only change made to B is the feathered alpha on slices that sit behind UI.

`src/` holds reference copies of the scripts: `build_v8.py` and `sample_art.py`
(v8, current) and the v6/v7 photo-to-art pipeline (`build_art.py`, `paint.py`,
`sketch.py`, …), which is no longer used. The working copies live in `style-guide/src/`.
