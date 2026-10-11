"""v7 vehicle renderer: realistic sketch / tattoo drawing (replaces paint.py's sticker look for vehicles).

A tattoo artist's process, done procedurally on the owner's (super-resolved) cut-outs:
  1. tone: CLAHE-lifted luminance, edge-preserving smoothing, mapped to darkness T in [0,1]
  2. flow: structure-tensor edge tangent field; the car is split into SLIC patches and each patch is
     hatched along its own mean tangent (hatching follows the form, in hand-sized patches)
  3. shading in tonal bands: stipple in the light greys, single hatch, cross-hatch, triple hatch,
     solid black in the deepest shadows (tyres, glass, grille gaps); hatch lines swell with darkness
  4. linework traced as strokes (Canny at two scales -> pixel paths -> smoothed polylines) and redrawn
     with pen pressure: heavy on the silhouette and in shadow, fine on detail, tapered ends
  5. colour: limited tattoo washes from the palette (Rust, Teal, Diamond Glow, Cobalt), only where the
     real paint is coloured, granulated and slightly off-register, highlights left as bare paper
  6. ground: cream paper/skin behind the drawing that bleeds out into the wall with a dry-brush edge,
     loose whip-shaded ground shadow under the wheels; custom plates pasted back crisp
Drawn at 2x and downsampled so strokes are antialiased like ink.
"""
import math
import numpy as np, cv2
from PIL import Image, ImageDraw
from paint import INK, CREAM, RUST, TEAL, GLOW, COBALT, noise, rng, to_np, to_im

PAPER = (240, 229, 211)
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

def trace(edges, min_len=6):
    """Thin edge map -> list of pixel paths (x, y), walking 8-connected, preferring to keep direction."""
    E = edges.astype(bool); H, W = E.shape
    cnt = cv2.filter2D(E.astype(np.uint8), -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT) - E
    ys, xs = np.nonzero(E)
    order = np.argsort((cnt[ys, xs] != 1).astype(np.int8), kind='stable')   # endpoints first
    vis = np.zeros_like(E); paths = []
    for i in order:
        y, x = int(ys[i]), int(xs[i])
        if vis[y, x]: continue
        path = [(x, y)]; vis[y, x] = True; dy0 = dx0 = 0
        while True:
            best = None; bs = -9
            for dy, dx in NB:
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and E[ny, nx] and not vis[ny, nx]:
                    s = dy * dy0 + dx * dx0
                    if s > bs: bs, best = s, (ny, nx, dy, dx)
            if best is None: break
            y, x, dy0, dx0 = best; vis[y, x] = True; path.append((x, y))
        if len(path) >= min_len: paths.append(np.array(path, np.float32))
    return paths

def smooth_path(p, k=5):
    if len(p) < k + 2: return p
    ker = np.ones(k) / k
    return np.stack([np.convolve(np.pad(p[:, i], k // 2, mode='edge'), ker, 'valid') for i in range(2)], 1)

def draw_strokes(size, paths, widths_fn, seed=0, step=2):
    """Pen strokes with pressure: width varies along the path, tapers at both ends."""
    cov = Image.new('L', size, 0); d = ImageDraw.Draw(cov); r = rng(seed)
    for p in paths:
        p = smooth_path(p)[::step]
        if len(p) < 2: continue
        w = widths_fn(p)
        t = np.linspace(0, 1, len(p)); taper = np.clip(np.sin(np.pi * t) ** 0.35, 0.25, 1)
        w = w * taper * (0.9 + 0.2 * r.random())
        for i in range(len(p) - 1):
            wi = max(1.0, float(w[i]))
            d.line([tuple(p[i]), tuple(p[i + 1])], fill=255, width=int(round(wi)))
            if wi > 2.5: d.ellipse([p[i][0] - wi / 2, p[i][1] - wi / 2, p[i][0] + wi / 2, p[i][1] + wi / 2], fill=255)
    return np.asarray(cov).astype(np.float32) / 255

def sample(a, p):
    x = np.clip(p[:, 0].astype(int), 0, a.shape[1] - 1); y = np.clip(p[:, 1].astype(int), 0, a.shape[0] - 1)
    return a[y, x]

def wash_colour(h, s, v):
    """Palette spot colour for a paint hue (OpenCV hue 0..180)."""
    hd = h * 2
    if hd < 38 or hd >= 330: return RUST
    if hd < 68: return (196, 120, 60)       # yellow/amber paint -> warm rust tint
    if hd < 105: return GLOW                 # lime -> diamond glow
    if hd < 170: return TEAL                 # greens
    return COBALT                            # blues / purples

def sketch_vehicle(img, width, seed=1, protect=None, ss=2, period=6.5, line=1.0, hatch=1.0, wash=0.62,
                   tone_lift=0.0, ground=True, ink=INK, paper=PAPER, stipple=1.0, spot_glow=0.0, body=None, rim=0.8, whip=1.0, drips=0, drip_cols=None, hatch_angle=-38, flow_bias=0.35, fade=0.55, gamma=1.5, pre=None):
    img = img.convert('RGBA'); s = width / img.width
    if pre:   # lift a very dark source (black car in dim light) so the tonal bands have something to find
        from PIL import ImageEnhance
        al = img.getchannel('A'); lut = [int(255 * (i / 255) ** (1 / pre)) for i in range(256)] * 3
        img = ImageEnhance.Contrast(img.convert('RGB').point(lut)).enhance(1.1).convert('RGBA'); img.putalpha(al)
    W0, H0 = width, max(1, round(img.height * s)); pad = int(W0 * 0.05)
    Ws, Hs, P = (W0 + 2 * pad) * ss, (H0 + 2 * pad) * ss, pad * ss
    big = img.resize((W0 * ss, H0 * ss), Image.LANCZOS)
    a = np.zeros((Hs, Ws, 4), np.float32); a[P:P + H0 * ss, P:P + W0 * ss] = to_np(big)
    A = a[..., 3] / 255.0; M = A > 0.5
    rgb = a[..., :3] * A[..., None] + 128 * (1 - A[..., None])
    u8 = rgb.astype(np.uint8)
    lab = cv2.cvtColor(u8, cv2.COLOR_RGB2LAB); L = lab[..., 0]
    L = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(L)
    Ls = cv2.bilateralFilter(L, 9, 28, 5 * ss).astype(np.float32)
    Ls = cv2.GaussianBlur(Ls, (0, 0), 0.9 * ss) / 255.0
    T = 1 - Ls
    lo, hi = np.percentile(T[M], 4), np.percentile(T[M], 98.5)
    T = np.clip((T - lo) / (hi - lo + 1e-6) - tone_lift, 0, 1) ** gamma
    T = T * T * (3 - 2 * T)                                            # S-curve: tattoo contrast, open paper, solid blacks
    r = rng(seed)

    # ---- edge tangent flow, SLIC patches with their own hatch angle
    g = cv2.GaussianBlur(L.astype(np.float32), (0, 0), 2 * ss)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    sig = 7 * ss
    J11 = cv2.GaussianBlur(gx * gx, (0, 0), sig); J22 = cv2.GaussianBlur(gy * gy, (0, 0), sig); J12 = cv2.GaussianBlur(gx * gy, (0, 0), sig)
    theta = 0.5 * np.arctan2(2 * J12, J11 - J22) + np.pi / 2          # tangent (along the edges)
    coh = np.sqrt((J11 - J22) ** 2 + 4 * J12 ** 2) / (J11 + J22 + 1e-6)
    from skimage.segmentation import slic
    small = cv2.resize(u8, (Ws // ss, Hs // ss), interpolation=cv2.INTER_AREA); msmall = cv2.resize(M.astype(np.uint8), (Ws // ss, Hs // ss)) > 0
    nseg = max(20, int(msmall.sum() / (48 * 48)))
    seg = slic(small, n_segments=nseg, compactness=12, mask=msmall, start_label=1, channel_axis=-1)
    seg = cv2.resize(seg.astype(np.int32).astype(np.float32), (Ws, Hs), interpolation=cv2.INTER_NEAREST).astype(np.int32)
    ns = seg.max() + 1
    c2 = np.bincount(seg.ravel(), (np.cos(2 * theta) * coh).ravel(), ns); s2 = np.bincount(seg.ravel(), (np.sin(2 * theta) * coh).ravel(), ns)
    cnt_ = np.bincount(seg.ravel(), None, ns) + 1e-6
    gv = math.radians(2 * hatch_angle)                                       # the artist's default diagonal
    seg_ang = 0.5 * np.arctan2(s2 / cnt_ + flow_bias * math.sin(gv), c2 / cnt_ + flow_bias * math.cos(gv)) + r.normal(0, 0.08, ns)
    seg_ang[0] = math.radians(35)
    seg_ph = r.random(ns); seg_p = period * ss * (0.88 + 0.24 * r.random(ns))
    ANG, PH, PER = seg_ang[seg], seg_ph[seg], seg_p[seg]
    yy, xx = np.mgrid[0:Hs, 0:Ws].astype(np.float32)
    wob = (noise(Hs, Ws, 30 * ss, seed + 1, 2) - 0.5) * 1.6
    press = 0.7 + 0.6 * noise(Hs, Ws, 6 * ss, seed + 2, 2)   # pen pressure wanders

    def hatch_layer(off, t0, t1, maxw=0.3):
        ang = ANG + off
        proj = (xx * np.cos(ang) + yy * np.sin(ang)) / PER + PH + wob
        dist = np.abs((proj % 1.0) - 0.5) * PER                      # px from the line centre
        hw = np.clip((T - t0) / (t1 - t0), 0, 1) ** 0.8 * PER * maxw * press
        return np.clip(hw - dist + 0.5, 0, 1) * (hw > 0.4)

    H1 = hatch_layer(0, 0.24 / hatch, 0.66)
    H2 = hatch_layer(math.radians(58), 0.40 / hatch, 0.80)
    H3 = hatch_layer(math.radians(-52), 0.62 / hatch, 0.95, 0.26)
    solid = np.clip((T - 0.9) / 0.05, 0, 1)
    # whip shading for the soft greys: short tapered flicks along the hatch direction (tattoo whip/pepper)
    ang = ANG; proj = (xx * np.cos(ang) + yy * np.sin(ang)) / (PER * 0.8) + PH + wob
    lid = np.floor(proj); along = (-xx * np.sin(ang) + yy * np.cos(ang)) / (PER * (2.2 + 1.6 * np.sin(lid * 12.9898) ** 2))
    fr = (along + np.sin(lid * 78.233) * 43.7) % 1.0
    flick = np.clip(np.sin(np.pi * fr) ** 1.5, 0, 1)
    dist = np.abs((proj % 1.0) - 0.5) * PER * 0.8
    wt = np.clip((T - 0.07) / 0.2, 0, 1) * np.clip((0.5 - T) / 0.15, 0, 1) * whip
    hw = wt * flick * PER * 0.14 * press
    st = np.clip(hw - dist + 0.5, 0, 1) * (hw > 0.3) * ((np.sin(lid * 3.1 + 1.7) * 0.5 + 0.5) < 0.55 + 0.4 * wt)
    dots = (r.random((Hs, Ws)) < np.clip((T - 0.05) / 0.3, 0, 1) * np.clip((0.42 - T) / 0.12, 0, 1) * 0.006 * stipple).astype(np.float32)
    st = np.maximum(st, cv2.dilate(dots, np.ones((ss, ss), np.uint8)))
    shade = np.maximum.reduce([H1, H2, H3, solid, st]) * M

    # ---- linework
    er = cv2.erode(M.astype(np.uint8), np.ones((3 * ss, 3 * ss), np.uint8)) > 0
    def canny(sigma, lo_q, hi_q):
        gb = cv2.GaussianBlur(L, (0, 0), sigma * ss)
        mag = np.hypot(cv2.Sobel(gb, cv2.CV_32F, 1, 0), cv2.Sobel(gb, cv2.CV_32F, 0, 1))[er]
        return (cv2.Canny(gb, np.percentile(mag, lo_q), np.percentile(mag, hi_q), L2gradient=True) > 0) & er
    fine = canny(0.9, 80, 93); major = canny(2.4, 78, 91) 
    fine &= ~cv2.dilate(major.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    cs, _ = cv2.findContours(M.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    sil = [c[:, 0, :].astype(np.float32) for c in cs if len(c) > 30]
    Td = cv2.GaussianBlur(T, (0, 0), 2 * ss)
    y0m, y1m = np.nonzero(M)[0].min(), np.nonzero(M)[0].max()
    lw = line * ss
    Lsil = draw_strokes((Ws, Hs), sil, lambda p: lw * (2.4 + 2.0 * sample(Td, p) + 1.6 * (p[:, 1] - y0m) / (y1m - y0m + 1)), seed + 3, step=2)
    Lmaj = draw_strokes((Ws, Hs), trace(major, 10), lambda p: lw * (0.9 + 1.5 * sample(Td, p)), seed + 4)
    Lfin = draw_strokes((Ws, Hs), trace(fine, 8), lambda p: lw * (0.45 + 0.8 * sample(Td, p)), seed + 5)
    lines = np.maximum.reduce([Lsil, Lmaj * 0.95, Lfin * 0.85])

    # ---- ground shadow: loose horizontal whip strokes under the car
    wy = np.nonzero(M.any(1))[0].max(); cols = np.nonzero(M[max(0, wy - 6 * ss):wy + 1].any(0))[0]
    gs = []
    if len(cols):
        x0, x1 = cols.min(), cols.max()
        for i in range(int((x1 - x0) / (9 * ss))):
            yv = wy - r.random() * 5 * ss + r.random() * 9 * ss; xa = x0 + r.random() * (x1 - x0); L_ = (18 + 70 * r.random()) * ss
            gs.append(np.array([[xa, yv], [min(Ws - 2, xa + L_), yv + r.normal(0, 1.5 * ss)]], np.float32))
    Lgs = draw_strokes((Ws, Hs), [np.linspace(q[0], q[1], 12) for q in gs], lambda p: np.full(len(p), lw * 1.1), seed + 6, step=1)

    inkcov = np.clip(np.maximum.reduce([shade, lines, Lgs * 0.8]), 0, 1)

    # ---- colour: tattoo washes where the real paint is coloured
    hsv = cv2.cvtColor(cv2.GaussianBlur(u8, (0, 0), 1.5 * ss), cv2.COLOR_RGB2HSV).astype(np.float32)
    Hh, S, V = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    pm = ((S > 0.30) & (V > 0.22) & M).astype(np.uint8)
    pm = cv2.morphologyEx(pm, cv2.MORPH_OPEN, np.ones((3 * ss, 3 * ss), np.uint8))
    pm = cv2.morphologyEx(pm, cv2.MORPH_CLOSE, np.ones((7 * ss, 7 * ss), np.uint8)).astype(np.float32)
    pm = cv2.GaussianBlur(pm, (0, 0), 2.5 * ss)
    gran = noise(Hs, Ws, 5 * ss, seed + 7, 3); bleed = noise(Hs, Ws, 30 * ss, seed + 8, 3)
    wa = np.clip(pm * 1.3 - 0.15 + (bleed - 0.5) * 0.5, 0, 1) * (0.72 + 0.4 * gran) * wash
    wa *= np.clip((T - 0.04) / 0.2, 0.25, 1)                            # highlights stay bare paper
    wa = np.roll(wa, (int(1.5 * ss), int(2 * ss)), (0, 1))               # a touch off register, like a quick colour pass
    # hue per region (median over SLIC patch keeps colour coherent)
    hq = np.bincount(seg.ravel(), (Hh * pm).ravel(), ns) / (np.bincount(seg.ravel(), pm.ravel(), ns) + 1e-6)
    hsat = np.bincount(seg.ravel(), (S * pm).ravel(), ns) / (np.bincount(seg.ravel(), pm.ravel(), ns) + 1e-6)
    pal = np.array([wash_colour(h_, 0, 0) for h_ in hq], np.float32)
    if body is not None:   # one body colour for a single car; only hot small spots (lights) keep their own
        pal[:] = body
        hot = ((hq * 2 < 25) | (hq * 2 > 335)) & (hsat > 0.55)
        pal[hot] = RUST
    WC = pal[seg]
    if spot_glow:   # a cold reflection wash on dark paint (black cars)
        refl = np.clip((0.2 - T) / 0.12, 0, 1) * M * (noise(Hs, Ws, 30 * ss, seed + 9, 2) > 0.55)
        gm = cv2.GaussianBlur(refl.astype(np.float32), (0, 0), 3 * ss) * spot_glow
        WC = np.where((gm > wa)[..., None], np.array(GLOW, np.float32), WC); wa = np.maximum(wa, gm)

    # ---- paper ground that bleeds into the wall
    dist_out = cv2.distanceTransform((~M).astype(np.uint8), cv2.DIST_L2, 5)
    brush = noise(Hs, Ws, 14 * ss, seed + 10, 3)
    streak = cv2.GaussianBlur(r.random((Hs, Ws)).astype(np.float32), (0, 0), sigmaX=10 * ss, sigmaY=0.8 * ss)
    streak = (streak - streak.mean()) / (streak.std() + 1e-6)
    gA = np.clip(A * 1.0 + np.clip(1 - dist_out / (5 * ss), 0, 1) ** 1.5 * np.clip(brush * 1.6 - 0.6 + streak * 0.35, 0, 1) * 0.6, 0, 1)
    # in the deep shadows the paper gives way to the wall: the drawing bleeds into the mural
    lit = np.clip((0.92 - cv2.GaussianBlur(T, (0, 0), 4 * ss)) / 0.45 + (brush - 0.5) * 0.6, 0, 1)
    gA *= (1 - fade) + fade * lit
    inner = A * ((1 - fade) + fade * lit)
    gA *= np.clip(0.94 + (noise(Hs, Ws, 1.5 * ss, seed + 11, 1) - 0.5) * 0.2, 0, 1)   # paper tooth
    base = np.array(paper, np.float32) * (0.96 + 0.05 * noise(Hs, Ws, 60 * ss, seed + 12, 3))[..., None]
    col = base * (1 - wa[..., None]) + (base * WC / 255.0) * wa[..., None] * 1.05     # multiply-like wash
    col = col * (1 - inkcov[..., None]) + np.array(ink, np.float32) * inkcov[..., None]
    if rim:   # silhouette and big lines turn cream where they cross the bare wall (white-ink rim light)
        bare = np.clip(1 - cv2.GaussianBlur(inner, (0, 0), 3 * ss) / 0.5, 0, 1) * rim * (noise(Hs, Ws, 25 * ss, seed + 14, 2) > 0.4)
        rl = np.maximum(Lsil, Lmaj * 0.8) * bare
        col = col * (1 - rl[..., None]) + np.array(CREAM, np.float32) * rl[..., None]
    alpha = np.maximum(gA if ground else A * 0, inkcov)

    # ---- custom plates stay crisp
    out = np.dstack([col, alpha * 255])
    for bx in (protect or []):
        x0, y0, x1, y1 = [int(round(v * s * ss)) + P for v in bx]
        mx = max(2, int((x1 - x0) * 0.05)); x0, y0, x1, y1 = max(0, x0 - mx), max(0, y0 - mx), min(Ws, x1 + mx), min(Hs, y1 + mx)
        if x1 - x0 < 6 or y1 - y0 < 6: continue
        sa = a[y0:y1, x0:x1, 3:4] / 255.0
        if sa.mean() < 0.3: continue                                   # plate box outside this cut-out
        src = np.clip((a[y0:y1, x0:x1, :3] - 128) * 1.12 + 128, 0, 255)
        out[y0:y1, x0:x1, :3] = out[y0:y1, x0:x1, :3] * (1 - sa) + src * sa
        out[y0:y1, x0:x1, 3] = np.maximum(out[y0:y1, x0:x1, 3], sa[..., 0] * 255)
        b = max(ss, (x1 - x0) // 50)
        for sl in [(slice(y0, y0 + b), slice(x0, x1)), (slice(y1 - b, y1), slice(x0, x1)), (slice(y0, y1), slice(x0, x0 + b)), (slice(y0, y1), slice(x1 - b, x1))]:
            out[sl][..., :3] = np.where(out[sl][..., 3:4] > 128, np.array(ink, np.float32), out[sl][..., :3])
    res = to_im(out, 'RGBA').resize((Ws // ss, Hs // ss), Image.LANCZOS)
    if drips:
        from paint import drip_from
        res = drip_from(res, drips, seed + 13, cols=drip_cols or [tuple(int(v) for v in (body or RUST))], maxlen=int(pad * 1.6), width=max(2, W0 // 300))
    return res
