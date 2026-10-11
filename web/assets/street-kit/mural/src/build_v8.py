"""v8: the owner's own finished artworks become the CarTune imagery.

    /workspace/.art-venv/bin/python src/mural/build_v8.py [crops|tex|export|all]   (from style-guide/)

Sources (untouched originals, kept in style-guide/owner-art/):
  A-cartune-banners.png    three banner variants stacked (night / sun / fire), 2103 px wide, split on the
                           white gutters at rows 294-298 and 544-548.
  B-aussie-lineup-mural.png  wide mural: Aussie car line-up on a black wall, Perth skyline, cockatoo,
                           wattle, black swan, kookaburra, banksia, paint splashes.

The art itself is never repainted or filtered: A is only cropped, scaled and compressed (WebP). B is cropped into
slices; slices that sit behind UI get a soft alpha vignette (feathered edges) so they fade into the page, which is
the only change. The page wall is a procedural running-bond brick wall (CarTune is the sister app to MintWall, so the
brick stays in the background) with a little of the art's paint on it. The spray rule is procedural too.
Both use the palette sampled from A and B (see tokens.part.css "ART PALETTE").
Writes WebP to style-guide/assets/art3/; `export` copies them into the CarTune web kit (web/build.js turns every
<name>.webp into --ph-<name> and tex-<name>.webp into --art-<name>)."""
import os, sys, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter
from paint import noise, to_np, to_im, rng, drip_from

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC_A = os.path.join(ROOT, 'owner-art', 'A-cartune-banners.png')
SRC_B = os.path.join(ROOT, 'owner-art', 'B-aussie-lineup-mural.png')
OUT = os.path.join(ROOT, 'assets', 'art3'); os.makedirs(OUT, exist_ok=True)
KIT = '/workspace/cartune-build/CarTune-OS/web/assets/street-kit/mural'

# palette sampled from the art (src/sample_art.py prints these): wall, wattle, sky, cobalt, green, sunset, flame, smoke
WALL = (23, 23, 23); WATTLE = (235, 192, 15); SKY = (54, 181, 221); COBALT = (16, 117, 179)
GREEN = (109, 163, 57); SUNSET = (244, 110, 54); FLAME = (244, 98, 30); SMOKE = (237, 237, 236)

# ---- A: the three banners (rows between the white gutters; one antialiased row trimmed each side)
BANNERS = {'night': (0, 293), 'sun': (300, 543), 'fire': (550, 748)}
# phone crops: the whole CARTUNE piece + the blown RESURECTED car (x range per banner, measured on the art)
PHONE_X = {'night': (430, 1410), 'sun': (500, 1320), 'fire': (560, 1450)}

# ---- B: slices (x0, y0, x1, y1) in source px. bn-* = section pieces (about 3.2:1, faded in on the right of
#      headings and panel tops), st-* = small empty-state pieces, tex-peel = a paint-splash corner for cards.
PIECES = {
    'bn-tunes':    (690, 360, 1590, 640),    # GTS Monaro, orange HQ coupe, red Torana
    'bn-live':     (1130, 400, 1830, 620),   # red Torana + silver Commodore
    'bn-diag':     (0, 340, 700, 560),       # green FJ + white EK
    'bn-spec':     (1100, 150, 1950, 415),   # Perth skyline + black swan
    'bn-detail':   (1430, 400, 2080, 603),   # silver + blue Commodores
    'bn-dash':     (900, 340, 1500, 528),    # orange coupe
    'bn-report':   (300, 320, 960, 526),     # blue coupe + white EK
    'bn-connect':  (0, 20, 720, 245),        # cockatoo + wattle
    'bn-settings': (1450, 50, 2103, 254),    # yellow drips, blue splash, kookaburra
}
STICKERS = {
    'st-swan':  (1680, 196, 1925, 362),      # black swan (scan: all clear)
    'st-cocky': (40, 0, 330, 215),           # cockatoo (scan: before reading)
    'st-kooka': (1840, 40, 2103, 260),       # kookaburra (report: nothing saved yet)
}
PEEL = (1560, 0, 2103, 270)                  # yellow drips + blue splash corner

def save(img, name, q=82, alpha_q=None):
    f = os.path.join(OUT, name + '.webp')
    if img.mode == 'RGBA': img.save(f, 'WEBP', quality=q, alpha_quality=alpha_q or q, method=6)
    else: img.convert('RGB').save(f, 'WEBP', quality=q, method=6)
    print(f'{name:16s} {img.size[0]}x{img.size[1]}  {os.path.getsize(f) // 1024} KB', flush=True); return f

def vignette(size, edge, left_fade=0.0, shape='rect'):
    """Soft alpha: feathered rounded rectangle (or ellipse); left_fade ramps the left part out (heading text side)."""
    W_, H_ = size; m = Image.new('L', size, 0); d = ImageDraw.Draw(m)
    if shape == 'ellipse': d.ellipse((edge, edge, W_ - edge, H_ - edge), fill=255)
    else: d.rounded_rectangle((edge, edge, W_ - edge, H_ - edge), radius=edge * 2, fill=255)
    a = np.asarray(m.filter(ImageFilter.GaussianBlur(edge * 0.8))).astype(np.float32) / 255
    if left_fade:
        xx = np.arange(W_, dtype=np.float32)[None, :] / W_
        a *= np.clip(xx / left_fade, 0, 1) ** 1.4
    return Image.fromarray((a * 255).astype(np.uint8))

def crops():
    A = Image.open(SRC_A).convert('RGB'); B = Image.open(SRC_B).convert('RGB')
    assert A.size == (2103, 748) and B.size == (2103, 748), (A.size, B.size)
    for k, (y0, y1) in BANNERS.items():
        b = A.crop((0, y0, A.width, y1))
        save(b, f'hero-{k}', q=84)                                   # desktop: full banner, native resolution
        x0, x1 = PHONE_X[k]; save(b.crop((x0, 0, x1, b.height)), f'hero-{k}-m', q=86)
    save(B.resize((1600, round(B.height * 1600 / B.width)), Image.LANCZOS), 'app-header', q=78)   # inner-page header + page foot: B whole
    for k, box in PIECES.items():
        c = B.crop(box).convert('RGBA'); c.putalpha(vignette(c.size, 22, left_fade=0.35)); save(c, k, q=76, alpha_q=100)
    for k, box in STICKERS.items():
        c = B.crop(box).convert('RGBA'); c.putalpha(vignette(c.size, 10, shape='ellipse')); save(c, k, q=82, alpha_q=100)
    c = B.crop(PEEL).convert('RGBA'); c.putalpha(vignette(c.size, 22)); save(c, 'tex-peel', q=76, alpha_q=100)

# ---- procedural pieces in the art palette
def splat(a, cx, cy, R, col, r, alpha=1.0, drips=0, grit=0.35):
    """Paint splash like the ones on mural B: ragged noisy core, a spray of satellite drops thrown one way,
    fine mist and grit (dry, speckled paint), optional runs."""
    H_, W_ = a.shape[:2]
    x0, x1 = max(0, int(cx - R * 3.5)), min(W_, int(cx + R * 3.5)); y0, y1 = max(0, int(cy - R * 3.5)), min(H_, int(cy + R * 5))
    if x1 - x0 < 4 or y1 - y0 < 4: return
    h, w = y1 - y0, x1 - x0
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    sx_, sy_ = r.uniform(0.6, 1.5), r.uniform(0.6, 1.2)                     # stretched, not round
    d = np.sqrt(((xx - cx) / sx_) ** 2 + ((yy - cy) / sy_) ** 2) / R
    n = noise(h, w, max(3, R / 2.5), int(r.integers(1e6)), 3); n2 = noise(h, w, max(2, R / 7), int(r.integers(1e6)), 2)
    m = np.clip((1 - d + (n - 0.5) * 1.3 + (n2 - 0.5) * 0.5) * 5, 0, 1)
    throw = r.uniform(0, 6.283)                                              # satellites thrown one way
    for _ in range(int(R * 1.2)):
        ang = throw + r.normal(0, 0.9); dist = R * (0.9 + r.exponential(0.8)); rr = max(1.0, R * r.uniform(0.02, 0.12))
        px, py = cx + np.cos(ang) * dist, cy + np.sin(ang) * dist
        m = np.maximum(m, np.clip((rr - np.sqrt((xx - px) ** 2 + (yy - py) ** 2)) * 1.5, 0, 1))
    mist = np.exp(-(d / 2.0) ** 2) * 0.14 * (r.random((h, w)) > 0.45)
    m = np.maximum(m, mist)
    for _ in range(drips):                                                   # runs
        dx = cx + r.uniform(-0.5, 0.5) * R; L = R * r.uniform(1.2, 3.6); wd = max(1.2, R * r.uniform(0.04, 0.09))
        run = (np.abs(xx - dx) < wd) & (yy > cy) & (yy < cy + L)
        bead = np.sqrt((xx - dx) ** 2 + (yy - cy - L) ** 2) < wd * 1.4
        m = np.maximum(m, (run | bead).astype(np.float32))
    m *= np.clip(1 - grit * (r.random((h, w)) > 0.6) - grit * 0.6 * (n2 < 0.4), 0, 1)   # dry, speckled paint
    m = cv2.GaussianBlur(m, (0, 0), 0.6) * alpha
    a[y0:y1, x0:x1, :3] = a[y0:y1, x0:x1, :3] * (1 - m[..., None]) + np.array(col, np.float32) * m[..., None]
    if a.shape[2] == 4: a[y0:y1, x0:x1, 3] = np.maximum(a[y0:y1, x0:x1, 3], m * 255)

def concrete(W_, H_, seed):
    """Black cracked-concrete wall (mural B's ground): flat #171717 with grime, stains and hairline cracks."""
    r = rng(seed)
    n1 = noise(H_, W_, 260, seed + 1, 4); n2 = noise(H_, W_, 30, seed + 2, 3); n3 = noise(H_, W_, 6, seed + 3, 2)
    lum = 1 + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.35 + (n3 - 0.5) * 0.25 + r.normal(0, 0.05, (H_, W_))
    a = np.array(WALL, np.float32)[None, None, :] * lum[..., None]
    cr = np.zeros((H_, W_), np.uint8)                                # hairline cracks
    for _ in range(int(W_ * H_ / 90000)):
        x, y = r.uniform(0, W_), r.uniform(0, H_); ang = r.uniform(0, 6.283); pts = [(x, y)]
        for _ in range(r.integers(6, 18)):
            ang += r.normal(0, 0.5); x += np.cos(ang) * r.uniform(8, 26); y += np.sin(ang) * r.uniform(8, 26); pts.append((x, y))
        cv2.polylines(cr, [np.int32(pts)], False, 255, 1, cv2.LINE_AA)
    a *= (1 - cr[..., None] / 255 * 0.45)
    hi = cv2.GaussianBlur(np.roll(cr, 1, axis=0).astype(np.float32), (0, 0), 0.6) / 255
    a += hi[..., None] * 10
    return a

def texture_wall(W_=1600, seed=11):
    """Page wall: weathered running-bond brick, the MintWall kinship. Dark bricks, pale mortar, a few
    rust and teal ghosts and a little of the art's paint. Height is an exact number of courses, and the
    bond repeats every two courses, so the texture tiles vertically with no seam and no cross-fade."""
    r = rng(seed)
    bw, bh, gap = 58, 22, 6
    row = bh + gap
    courses = 36                                  # even, so the next tile starts on an unshifted course
    H_ = courses * row
    mortar = np.array((132, 120, 106), np.float32)
    a = np.empty((H_, W_, 3), np.float32); a[:] = mortar
    a *= (0.82 + noise(H_, W_, 48, seed, 3)[..., None] * 0.36)
    dark = np.array((54, 42, 36), np.float32); light = np.array((96, 74, 60), np.float32)
    rust = np.array((122, 52, 36), np.float32); teal = np.array((36, 78, 88), np.float32)
    for c in range(courses):
        y0 = c * row; shift = (bw + gap) // 2 if c % 2 else 0; x = -shift
        while x < W_:
            x1, x2 = max(x, 0), min(x + bw, W_)
            if x2 > x1:
                q = r.random()
                col = rust if q < 0.045 else teal if q < 0.08 else light if q < 0.16 else dark
                col = col * r.uniform(0.88, 1.14)
                a[y0:y0 + bh, x1:x2] = col
            x += bw + gap
    a *= (0.72 + noise(H_, W_, 14, seed + 9, 3)[..., None] * 0.55)   # each brick weathers differently
    a *= (0.92 + noise(H_, W_, 3, seed + 4, 2)[..., None] * 0.16)     # grit
    for c in range(courses):                                          # a lip of light on each course, shadow under
        y0 = c * row
        a[y0:y0 + 1] = np.minimum(a[y0:y0 + 1] * 1.35, 200)
        a[y0 + bh - 1:y0 + bh] *= 0.72
    cols = [WATTLE, SKY, GREEN, SUNSET]
    for i in range(5):                                                # a little of the art's paint, never covering the bond
        col = np.array(cols[i % 4], np.float32); y = r.uniform(0, H_); x0 = r.uniform(0, W_ * 0.5)
        L = r.uniform(180, 520); th = r.uniform(4, 12); slope = r.uniform(-0.08, 0.08)
        yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32)
        msk = np.clip(1 - np.abs(yy - (y + (xx - x0) * slope)) / th, 0, 1) * ((xx > x0) & (xx < x0 + L))
        msk *= np.clip(noise(H_, W_, 8, seed + 20 + i, 2) * 1.4 - 0.2, 0, 1) * r.uniform(0.18, 0.34)
        a = a * (1 - msk[..., None]) + col * msk[..., None]
    return to_im(np.clip(a, 0, 255)).convert('RGB')

def texture_rule(W_=1600, H_=74, seed=63):
    """Spray-paint rule under section headings: wattle-yellow stroke, a sky-blue kiss, splatter, drips."""
    r = rng(seed); a = np.zeros((H_, W_, 4), np.float32)
    xx = np.arange(W_)[None, :].astype(np.float32); yy = np.arange(H_)[:, None].astype(np.float32)
    for col, yc, th, sd, x_end in [(WATTLE, 20, 8.5, 1, 1.0), (SKY, 28, 4.5, 2, 0.62)]:
        wob = (noise(1, W_, 70, seed + sd, 3)[0] - 0.5) * 7
        m = np.clip(1 - np.abs(yy - yc - wob[None, :]) / th, 0, 1) ** 0.55
        m *= np.clip(noise(H_, W_, 9, seed + sd + 5, 2) * 1.6, 0.7, 1)
        m *= np.clip(np.minimum(xx, W_ * x_end - xx) / 110, 0, 1)
        a[..., :3] = a[..., :3] * (1 - m[..., None]) + np.array(col) * m[..., None]; a[..., 3] = np.maximum(a[..., 3], m * 255)
    for i in range(10):
        splat(a, r.uniform(40, W_ - 40), r.uniform(12, 32), r.uniform(2.5, 6), [WATTLE, SKY, GREEN, SUNSET][i % 4], r, alpha=0.95)
    c = to_im(a, 'RGBA')
    return drip_from(c, 16, seed, cols=[WATTLE, WATTLE, SKY], maxlen=42, width=5)

def tex():
    save(texture_wall(), 'tex-mural', q=70)
    save(texture_rule(), 'tex-rule', q=80, alpha_q=80)
    # tex-tags (tag scribbles, used only as a mask in the theme's ink) is kept from v6/v7: copy it across
    src = os.path.join(ROOT, 'assets', 'art2', 'tex-tags.webp')
    if os.path.exists(src): shutil.copy(src, os.path.join(OUT, 'tex-tags.webp'))

def export():
    """Replace the kit's imagery with v8 (README and src/ stay; the v7 files are removed so they aren't inlined)."""
    for f in os.listdir(KIT):
        if f.endswith('.webp'): os.remove(os.path.join(KIT, f))
    for f in sorted(os.listdir(OUT)):
        if f.endswith('.webp'): shutil.copy(os.path.join(OUT, f), os.path.join(KIT, f))
    tot = sum(os.path.getsize(os.path.join(KIT, f)) for f in os.listdir(KIT) if f.endswith('.webp'))
    print('exported', len([f for f in os.listdir(KIT) if f.endswith('.webp')]), 'files,', tot // 1024, 'KB to', KIT)

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('crops', 'all'): crops()
    if what in ('tex', 'all'): tex()
    if what in ('export', 'all'): export()
