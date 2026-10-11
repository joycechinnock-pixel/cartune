"""CarTune mural kit: turns the owner's photos into painted street art (procedural, OpenCV + PIL).

"Western Australian united underground graffiti rebellion": realism crossed with stencil and
tattoo line work, spray paint, drips, halftone, tags, all in the Street Style Guide palette.

Pipeline for a vehicle (paint_vehicle):
  1. edge-preserving smoothing (bilateral x3 + mean shift) -> flat, painterly regions
  2. colour k-means in Lab + mode filter -> stencil-cut colour shapes
  3. palette pull: neutrals -> ink / night brick / teal shadow / steel / cream ramp,
     colours -> nudged toward the nearest spray colour (cars keep their identity)
  4. bold ink line work (XDoG) + a thick silhouette outline, like a tattoo flash sheet
  5. halftone dots in the shadow transitions, cream spray highlights, spray grain
  6. overspray halo, drips from the lower edges
Composites: wall() brick + old paint ghosts, sunburst(), tag() lettering, on_wall() puts paint into
the brick (mortar shows through, chips and wear), wet_ground() for the reflective street.
Run with /workspace/.art-venv/bin/python (numpy, pillow, opencv-contrib-python-headless, scipy)."""
import math, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

INK = (18, 21, 22); BRICK = (27, 28, 31); CREAM = (243, 232, 217); RUST = (169, 63, 37)
TEAL = (74, 142, 153); GLOW = (107, 215, 206); COBALT = (33, 79, 200)
AMBER = (232, 176, 58); STEEL = (138, 149, 154); SLATE = (58, 66, 71); DEEPTEAL = (30, 62, 68)
NEON = (72, 244, 92)
SPRAY = [RUST, TEAL, GLOW, COBALT, AMBER, CREAM, (196, 82, 44), (120, 190, 60), (38, 122, 88)]
NEUTRAL_RAMP = [INK, BRICK, DEEPTEAL, SLATE, STEEL, (205, 198, 186), CREAM]
GF = '/usr/share/fonts/truetype/sand-box/google'

def rng(seed): return np.random.default_rng(seed)
def font(name, size):
    for root, _, files in os.walk(os.path.join(GF, name)):
        for f in sorted(files):
            if f.endswith('.ttf'): return ImageFont.truetype(os.path.join(root, f), size)
    raise FileNotFoundError(name)

def to_np(im): return np.asarray(im).astype(np.float32)
def to_im(a, mode=None): return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode)

def noise(h, w, scale, seed, octaves=3):
    """Smooth value noise in [0,1] (sum of blurred random fields)."""
    r = rng(seed); out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(1, int(scale / (2 ** o)))
        small = r.random((h // s + 2, w // s + 2)).astype(np.float32)
        out += cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC) * amp; tot += amp; amp *= 0.5
    out /= tot; out = (out - out.min()) / (out.max() - out.min() + 1e-6); return out

# ------------------------------------------------------------------ colour helpers
def lab(c): return cv2.cvtColor(np.uint8([[c]]), cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)
def rgb_from_lab(l): return cv2.cvtColor(np.clip(l, 0, 255).astype(np.uint8)[None, None], cv2.COLOR_LAB2RGB)[0, 0].astype(np.float32)

def pull_colour(c, amt=0.35, neutral_chroma=18):
    """Nudge a colour into the spray-can palette. Neutrals go on the ink->cream ramp (teal-tinted shadows)."""
    L = lab(c); chroma = math.hypot(L[1] - 128, L[2] - 128)
    if chroma < neutral_chroma:
        ramp = [lab(x) for x in NEUTRAL_RAMP]; t = L[0] / 255 * (len(ramp) - 1)
        i = int(min(len(ramp) - 2, t)); f = t - i
        tgt = ramp[i] * (1 - f) + ramp[i + 1] * f
        return rgb_from_lab(L * 0.25 + tgt * 0.75)
    best = min(SPRAY, key=lambda s: float(np.sum((lab(s)[1:] - L[1:]) ** 2)))
    B = lab(best); out = L.copy(); out[1:] = L[1:] * (1 - amt) + B[1:] * amt
    out[1:] = 128 + (out[1:] - 128) * 1.12   # spray paint is a touch more vivid
    return rgb_from_lab(out)

# ------------------------------------------------------------------ vehicle painting
def xdog(gray, sigma=1.2, k=1.6, p=22, eps=-0.02, phi=12):
    g1 = cv2.GaussianBlur(gray, (0, 0), sigma); g2 = cv2.GaussianBlur(gray, (0, 0), sigma * k)
    d = (1 + p) * g1 - p * g2
    e = np.where(d >= eps, 1.0, 1 + np.tanh(phi * (d - eps)))
    return e  # 1 = paper, <1 = ink

def mode_filter(labels, k, size=7):
    """Majority filter on a label map: crisp stencil shapes, no speckle."""
    best = np.zeros(labels.shape, np.float32) - 1; out = labels.copy()
    for i in range(k):
        m = cv2.blur((labels == i).astype(np.float32), (size, size))
        upd = m > best; out[upd] = i; best[upd] = m[upd]
    return out

def halftone_mask(h, w, tone, cell=9, angle=22, gain=1.0):
    """tone in [0,1] (1 = full dots). Rotated dot screen, antialiased."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = math.radians(angle); u = xx * math.cos(a) + yy * math.sin(a); v = -xx * math.sin(a) + yy * math.cos(a)
    du = (u % cell) - cell / 2; dv = (v % cell) - cell / 2; d = np.sqrt(du ** 2 + dv ** 2)
    r = np.sqrt(np.clip(tone * gain, 0, 1)) * cell * 0.62
    return np.clip(r - d + 0.5, 0, 1)

def paint_vehicle(img, width, seed=1, k=12, amt=0.35, line=1.0, ht=0.5, highlight=0.6, smooth_px=None,
                  keep=None, outline=6, drip_n=10, drip_cols=None, grain=10, over=0.35, hue_keep=None, cream_ring=0, block=None, protect=None):
    protect_px = []
    """img: RGBA (alpha = cutout). Returns RGBA painted artwork (with a little overspray/drip margin)."""
    img = img.convert('RGBA'); s = width / img.width
    im = img.resize((width, max(1, round(img.height * s))), Image.LANCZOS)
    pad = int(width * 0.06); W_, H_ = im.width + pad * 2, im.height + pad * 2
    a = to_np(im); alpha = a[..., 3] / 255.0; rgb = a[..., :3]
    # flatten background to a neutral so smoothing doesn't bleed
    bgc = np.array([40, 44, 46], np.float32)
    rgb = rgb * alpha[..., None] + bgc * (1 - alpha[..., None])
    u8 = rgb.astype(np.uint8)
    for _ in range(3): u8 = cv2.bilateralFilter(u8, 9, 38, 7)
    sp = smooth_px or max(6, width // 180)
    u8 = cv2.pyrMeanShiftFiltering(u8, sp, 22)
    # k-means in Lab over the vehicle pixels
    L = cv2.cvtColor(u8, cv2.COLOR_RGB2LAB).astype(np.float32)
    msk = alpha > 0.5; X = L[msk].reshape(-1, 3)
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    sub = X[rng(seed).choice(len(X), min(len(X), 60000), replace=False)]
    _, _, centres = cv2.kmeans(sub, k, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    d = ((L.reshape(-1, 1, 3) - centres[None]) ** 2).sum(-1); labels = d.argmin(1).reshape(L.shape[:2])
    labels = mode_filter(labels, k, size=max(5, width // 260 * 2 + 1))
    cols = []
    for c in centres:
        rgbc = rgb_from_lab(c)
        cols.append(pull_colour(rgbc, amt))
    cols = np.array(cols, np.float32); paint = cols[labels]
    lum = cv2.cvtColor(u8, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    lumq = (centres[:, 0] / 255.0)[labels]
    # halftone in the shadow transitions (poster print), ink coloured
    if ht:
        tone = np.clip((0.55 - lumq) / 0.35, 0, 1) * np.clip((lumq - 0.06) / 0.12, 0, 1)
        dots = halftone_mask(*lumq.shape, tone, cell=max(6, width // 170), angle=22)
        paint = paint * (1 - dots[..., None] * ht) + np.array(INK) * dots[..., None] * ht
    # cream spray highlights (soft)
    if highlight:
        hi = np.clip((lum - 0.8) / 0.15, 0, 1); hi = cv2.GaussianBlur(hi, (0, 0), max(1.5, width / 700))
        paint = paint * (1 - hi[..., None] * highlight) + np.array(CREAM) * hi[..., None] * highlight
    # ink line work: colour edges (Canny on the smoothed Lab), long strokes only, weight by edge strength
    Ls = cv2.cvtColor(u8, cv2.COLOR_RGB2LAB)
    ed = np.zeros(lum.shape, np.uint8)
    for ch, (lo, hi_) in zip(range(3), [(28, 70), (22, 55), (22, 55)]):
        ed |= cv2.Canny(cv2.GaussianBlur(Ls[..., ch], (0, 0), 1.2), lo, hi_)
    ed = (ed > 0).astype(np.uint8)
    ed = cv2.morphologyEx(ed, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab_, stats, _ = cv2.connectedComponentsWithStats(ed, connectivity=8)
    big = np.maximum(stats[:, cv2.CC_STAT_WIDTH], stats[:, cv2.CC_STAT_HEIGHT])
    keepc = big > width / 38; keepc[0] = False
    thin = keepc[lab_].astype(np.float32)
    strong = (big > width / 10)[lab_].astype(np.float32) * thin
    lw = max(1, int(round(line * width / 900)))
    ink = np.maximum(cv2.dilate(thin, np.ones((lw + 1, lw + 1), np.uint8)),
                     cv2.dilate(strong, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (lw * 2 + 2,) * 2)))
    ink = cv2.GaussianBlur(ink, (0, 0), 0.7) * (alpha > 0.4)
    paint = paint * (1 - ink[..., None] * 0.95) + np.array(INK) * ink[..., None] * 0.95
    # custom plates (and the owner's RESURECTED plate) stay legible: original pixels, crisp, ink border
    for bx in (protect or []):
        x0, y0, x1, y1 = [int(round(v * s)) for v in bx]; mx_ = max(2, int((x1 - x0) * 0.06))
        x0, y0, x1, y1 = max(0, x0 - mx_), max(0, y0 - mx_), min(paint.shape[1], x1 + mx_), min(paint.shape[0], y1 + mx_)
        if x1 - x0 < 4 or y1 - y0 < 4: continue
        src = to_np(im)[y0:y1, x0:x1, :3]
        src = np.clip((src - 128) * 1.15 + 128, 0, 255)
        paint[y0:y1, x0:x1] = src
        bd = max(1, (x1 - x0) // 60)
        paint[y0:y0 + bd, x0:x1] = INK; paint[y1 - bd:y1, x0:x1] = INK; paint[y0:y1, x0:x0 + bd] = INK; paint[y0:y1, x1 - bd:x1] = INK
        protect_px.append((x0, y0, x1, y1))
    # spray grain + slight value noise across big flats
    r = rng(seed + 5)
    saved = [(b_, paint[b_[1]:b_[3], b_[0]:b_[2]].copy()) for b_ in protect_px]
    paint += (r.normal(0, grain, paint.shape[:2])[..., None]).astype(np.float32)
    paint *= (0.94 + 0.12 * noise(*paint.shape[:2], width // 14, seed + 6, 3))[..., None]
    for b_, v in saved: paint[b_[1]:b_[3], b_[0]:b_[2]] = v
    # place on padded canvas
    out = np.zeros((H_, W_, 4), np.float32)
    out[pad:pad + im.height, pad:pad + im.width, :3] = paint
    A = np.zeros((H_, W_), np.float32); A[pad:pad + im.height, pad:pad + im.width] = alpha
    hard = (A > 0.45).astype(np.float32)
    # silhouette: ink ring (tattoo flash), optional cream outer ring + offset 3D block shadow (graffiti piece)
    if outline:
        def ring_of(m, px): return cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px * 2 + 1,) * 2))
        inkm = ring_of(hard, outline)
        layers = []
        if block:
            dx, dy, bc = block; M = np.float32([[1, 0, dx], [0, 1, dy]])
            outer = ring_of(inkm, cream_ring) if cream_ring else inkm
            sh = cv2.warpAffine(outer, M, (W_, H_))
            for t in range(1, 6):   # extrude
                sh = np.maximum(sh, cv2.warpAffine(outer, np.float32([[1, 0, dx * t / 6], [0, 1, dy * t / 6]]), (W_, H_)))
            layers.append((sh, bc))
        if cream_ring: layers.append((ring_of(inkm, cream_ring), CREAM))
        layers.append((inkm, INK))
        base = np.zeros((H_, W_, 3), np.float32); cov = np.zeros((H_, W_), np.float32)
        for m, c in layers:
            m = cv2.GaussianBlur(m, (0, 0), 0.8); base = base * (1 - m[..., None]) + np.array(c) * m[..., None]; cov = np.maximum(cov, m)
        hm = cv2.GaussianBlur(hard, (0, 0), 0.6)[..., None]
        out[..., :3] = out[..., :3] * hm + base * (1 - hm)
        hard = np.maximum(hard, cov)
    # overspray halo: speckled soft edge in the dominant edge colour (ink)
    halo = cv2.GaussianBlur(hard, (0, 0), max(3, width / 160)) * (1 - hard)
    speck = (r.random(halo.shape) < halo * 0.55).astype(np.float32)
    halo = np.clip(halo * over + speck * 0.5 * over, 0, 1)
    A = np.clip(hard + halo, 0, 1)
    out[..., 3] = A * 255
    res = to_im(out, 'RGBA')
    if drip_n: res = drip_from(res, drip_n, seed + 9, cols=drip_cols)
    return res

def drip_from(img, n, seed, cols=None, maxlen=None, width=None):
    """Paint drips hanging from the lower edges of an RGBA artwork (colour sampled from the edge)."""
    r = rng(seed); a = to_np(img); A = a[..., 3]; H_, W_ = A.shape
    ml = maxlen or int(H_ * 0.16); wd = width or max(3, W_ // 220)
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    solid = A > 200
    xs = r.choice(np.arange(int(W_ * 0.08), int(W_ * 0.92)), n, replace=False)
    for x in xs:
        col_ = np.where(solid[:, x])[0]
        if not len(col_): continue
        y0 = col_.max() - 2
        c = tuple(int(v) for v in a[max(0, y0 - 3), x, :3]) if cols is None else cols[r.integers(len(cols))]
        L_ = int(r.integers(ml // 4, ml)); w = int(r.integers(max(2, wd // 2), wd + 1))
        y1 = min(H_ - w - 2, y0 + L_)
        if y1 <= y0 + 2: continue
        d.rectangle((x - w // 2, y0, x + w // 2, y1), fill=c + (255,))
        d.ellipse((x - w, y1 - w, x + w, y1 + w), fill=c + (255,))
    ov = ov.filter(ImageFilter.GaussianBlur(0.6))
    out = img.copy(); out.alpha_composite(ov)
    # grow the canvas alpha where drips went past the art
    return out

# ------------------------------------------------------------------ walls, rays, tags
def wall(size, seed=1, brick=(62, 20), tone=1.0, ghosts=True, mortar=0.55):
    """Dark brick wall (Night Brick family) with grime, water stains and ghosts of old paint."""
    W_, H_ = size; r = rng(seed); bw, bh = brick
    base = np.zeros((H_, W_, 3), np.float32)
    rows = H_ // bh + 2
    img = np.zeros((H_, W_), np.float32); mort = np.zeros((H_, W_), np.float32)
    for j in range(rows):
        off = (bw // 2) * (j % 2); y0 = j * bh
        for i in range(-1, W_ // bw + 2):
            x0 = i * bw + off; v = r.normal(0, 0.08)
            img[max(0, y0):min(H_, y0 + bh), max(0, x0):min(W_, x0 + bw)] = v
    ys = np.arange(H_); xs = np.arange(W_)
    mort[(ys % bh) < 3, :] = 1
    for j in range(rows):
        off = (bw // 2) * (j % 2); y0, y1 = j * bh, min(H_, j * bh + bh)
        for x in range(off % bw, W_, bw): mort[y0:y1, max(0, x - 1):x + 2] = 1
    mort = cv2.GaussianBlur(mort, (0, 0), 0.9)
    n1 = noise(H_, W_, 180, seed + 1, 4); n2 = noise(H_, W_, 18, seed + 2, 3); fine = r.normal(0, 1, (H_, W_)).astype(np.float32)
    lum = 0.105 + img * 0.35 * 0.1 + (n1 - 0.5) * 0.06 + (n2 - 0.5) * 0.04 + fine * 0.012
    col = np.array([0.108, 0.112, 0.125]) + np.array([0.035, 0.012, 0.0]) * (img[..., None] * 6)
    base = col * (lum[..., None] / 0.105) * tone
    base = base * (1 - mort[..., None] * mortar) + np.array([0.05, 0.055, 0.058]) * mort[..., None] * mortar
    # water streaks down the wall
    st = cv2.GaussianBlur(r.random((1, W_)).astype(np.float32), (0, 0), 3)
    streak = np.repeat(st, H_, 0) * np.linspace(0.4, 1.0, H_)[:, None]
    base *= (1 - 0.12 * (streak > 0.62))[..., None]
    out = np.clip(base * 255, 0, 255)
    if ghosts:  # a few big faded blocks of old paint peeling off (rust / teal / cream), like the MintWall wall
        for c, s, a_ in [(RUST, 3, 0.22), (TEAL, 4, 0.2), (CREAM, 5, 0.12)]:
            m = noise(H_, W_, 420, seed + 20 + s, 3)
            m = np.clip((m - 0.64) / 0.02, 0, 1)
            peel = noise(H_, W_, 26, seed + 40 + s, 3)
            m = m * np.clip((peel - 0.25) / 0.05, 0, 1)            # ragged peeled holes
            m = cv2.GaussianBlur(m, (0, 0), 0.8) * a_ * (0.75 + 0.5 * n2)
            out = out * (1 - m[..., None]) + np.array(c) * m[..., None]
    return to_im(out).convert('RGBA'), (mort, n2)

def sunburst(size, centre, cols, n=28, seed=3, r0=0, alpha=0.9, ragged=True, spin=0, grit=1.0):
    """Rays from a centre (mural sunburst), ragged spray edges. Returns RGBA layer."""
    W_, H_ = size; yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32)
    ang = (np.arctan2(yy - centre[1], xx - centre[0]) + math.pi + spin) / (2 * math.pi)
    rad = np.sqrt((xx - centre[0]) ** 2 + (yy - centre[1]) ** 2)
    idx = np.floor(ang * n).astype(int) % n; frac = (ang * n) % 1
    wob = (noise(H_, W_, 40, seed, 3) - 0.5) * (0.35 if ragged else 0)
    on = (np.abs(frac - 0.5 + wob) < 0.3).astype(np.float32)
    on *= (rad > r0)
    out = np.zeros((H_, W_, 4), np.float32)
    ci = np.array(cols, np.float32)[idx % len(cols)]
    out[..., :3] = ci
    fade = np.clip(1 - (rad - r0) / (max(W_, H_) * 0.95), 0, 1) ** 0.6
    wear = noise(H_, W_, 12, seed + 4, 2); wear = np.clip((wear - 0.18 * grit) / 0.3, 0, 1)
    out[..., 3] = on * fade * wear * alpha * 255
    return to_im(out, 'RGBA')

def tag(text, fnt, size, fill, outline=INK, ow=6, shadow=(0, 0, 0), sw=(7, 7), angle=-6, glow=None, drips=6, seed=5, fill2=None):
    """Graffiti lettering: fill (+optional 2-tone split), ink outline, drop shadow, soft glow, drips."""
    f = font(fnt, size); tmp = Image.new('L', (10, 10)); bb = ImageDraw.Draw(tmp).textbbox((0, 0), text, font=f, stroke_width=ow)
    w, h = bb[2] - bb[0] + 80, bb[3] - bb[1] + 80 + size // 2
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(c); x, y = 40 - bb[0], 40 - bb[1]
    if glow:
        g = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(g).text((x, y), text, font=f, fill=glow + (200,), stroke_width=ow + 10, stroke_fill=glow + (200,))
        c.alpha_composite(g.filter(ImageFilter.GaussianBlur(14)))
    if shadow: d.text((x + sw[0], y + sw[1]), text, font=f, fill=shadow + (255,), stroke_width=ow, stroke_fill=shadow + (255,))
    d.text((x, y), text, font=f, fill=fill + (255,), stroke_width=ow, stroke_fill=outline + (255,))
    if fill2:  # lower half second colour (classic two-tone fill)
        m = Image.new('L', (w, h), 0); ImageDraw.Draw(m).text((x, y), text, font=f, fill=255)
        lower = Image.new('L', (w, h), 0); ImageDraw.Draw(lower).rectangle((0, y + (bb[3] - bb[1]) * 0.55, w, h), fill=255)
        m = ImageChops.multiply(m, lower); col = Image.new('RGBA', (w, h), fill2 + (255,)); c.paste(col, (0, 0), m)
    if drips:
        c = drip_from(c, drips, seed, maxlen=size // 2, width=max(3, size // 22))
    # spray texture: knock a few specks out
    a = to_np(c); r = rng(seed); a[..., 3] *= (r.random(a.shape[:2]) > 0.03)
    c = to_im(a, 'RGBA')
    return c.rotate(angle, resample=Image.BICUBIC, expand=True)

def on_wall(wall_img, art, pos, wall_maps=None, relief=0.22, wear=0.08, seed=7, opacity=1.0):
    """Composite RGBA art so it reads painted INTO the brick: wall texture multiplies through, mortar
    lines darken the paint, a few chips of paint are missing."""
    x, y = pos; W_, H_ = wall_img.size
    a = to_np(art); h, w = a.shape[:2]
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(W_, x + w), min(H_, y + h)
    if x1 <= x0 or y1 <= y0: return wall_img
    sub = a[y0 - y:y1 - y, x0 - x:x1 - x]
    base = to_np(wall_img)[y0:y1, x0:x1]
    wl = cv2.cvtColor(base[..., :3].astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    wl = (wl - wl.mean()) / (wl.std() + 1e-6)
    tex = 1 + np.clip(wl, -2.5, 2.5)[..., None] * relief * 0.25
    col = sub[..., :3] * tex
    al = sub[..., 3:] / 255.0 * opacity
    if wear:
        r = rng(seed); nm = noise(y1 - y0, x1 - x0, 30, seed, 3); chips = (nm > 1 - wear * 1.6) * (r.random(nm.shape) > 0.25)
        al = al * (1 - chips[..., None] * 0.85)
    base[..., :3] = base[..., :3] * (1 - al) + col * al
    out = to_np(wall_img); out[y0:y1, x0:x1] = base
    return to_im(out, 'RGBA')

def spray_band(img, y0, y1, colour, seed=3, alpha=0.85):
    W_, H_ = img.size; a = to_np(img); r = rng(seed)
    yy = np.arange(H_)[:, None].astype(np.float32)
    edge = y1 + (noise(1, W_, 30, seed, 3)[0] - 0.5) * (y1 - y0) * 0.6
    m = np.clip((edge[None, :] - yy) / 6, 0, 1) * (yy >= y0)
    m *= np.clip(noise(H_, W_, 8, seed + 1, 2) * 1.4, 0.55, 1)
    m *= alpha
    a[..., :3] = a[..., :3] * (1 - m[..., None]) + np.array(colour) * m[..., None]
    return to_im(a, 'RGBA')

def wet_ground(img, horizon, seed=11, strength=0.55):
    """Wet asphalt below `horizon`: dark street with a smeared, rippled reflection of the wall."""
    W_, H_ = img.size; a = to_np(img); h = H_ - horizon
    if h <= 0: return img
    refl = a[max(0, horizon - h):horizon][::-1].copy()
    if refl.shape[0] < h: refl = np.concatenate([refl, np.repeat(refl[-1:], h - refl.shape[0], 0)])
    ripple = (noise(h, W_, 16, seed, 2) - 0.5) * 14
    xs = np.clip(np.arange(W_)[None, :] + ripple, 0, W_ - 1).astype(np.float32); ys = np.repeat(np.arange(h)[:, None], W_, 1).astype(np.float32)
    refl = cv2.remap(refl, xs, ys, cv2.INTER_LINEAR)
    refl = cv2.GaussianBlur(refl, (0, 0), sigmaX=2, sigmaY=5)
    fall = np.linspace(strength, 0.08, h)[:, None, None]
    asphalt = np.array([16, 18, 20], np.float32) + rng(seed).normal(0, 6, (h, W_, 1))
    g = asphalt * (1 - fall) + refl[..., :3] * fall
    streak = noise(h, W_, 60, seed + 2, 3); g *= (0.85 + 0.3 * streak)[..., None]
    a[horizon:, :, :3] = g
    if a.shape[2] == 4: a[horizon:, :, 3] = 255
    # a kerb line
    a[horizon:horizon + 3, :, :3] *= 0.4
    return to_im(a)

def feather_rect(size, box, radius):
    m = Image.new('L', size, 0); ImageDraw.Draw(m).rectangle(box, fill=255)
    return m.filter(ImageFilter.GaussianBlur(radius))
