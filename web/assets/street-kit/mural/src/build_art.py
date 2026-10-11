"""Compose the CarTune artwork from the owner's photos (procedural street-art pipeline, see paint.py).
    /workspace/.art-venv/bin/python src/mural/build_art.py [hero|banners|stickers|panels|all] [--preview DIR]
Writes WebP to style-guide/assets/art2/ (copied into the CarTune web kit by export step)."""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paint import *
from sources import cut, lineup, unsticker, ROOT
from sketch import sketch_vehicle
from PIL import ImageEnhance
OUT = os.path.join(ROOT, 'assets', 'art2'); os.makedirs(OUT, exist_ok=True)
CACHE = os.path.join(ROOT, 'photos', 'art', 'painted'); os.makedirs(CACHE, exist_ok=True)

def painted(key, width, **kw):
    """v7: draw a vehicle as a realistic sketch / tattoo piece (sketch.py), cached per (key, width, settings)."""
    import hashlib
    tag_ = f"v7-{key}-{width}-" + hashlib.md5(repr(sorted((k, str(v)) for k, v in kw.items())).encode()).hexdigest()[:10]
    f = os.path.join(CACHE, tag_ + '.png')
    if os.path.exists(f): return Image.open(f).convert('RGBA')
    im, boxes = lineup() if key == '09' else cut(key)
    if key == '01': im = unsticker(im)   # drop the printed sticker's white die-cut backing
    p = sketch_vehicle(im, width, protect=boxes, **kw); p.save(f); return p

def place(c, art, pos, maps=None, **kw): return on_wall(c, art, pos, maps, **kw)
def bottom_at(art, x, yb): return (x, yb - art.height)

# ------------------------------------------------------------------ the masterpiece
def hero(W_=2400, H_=960, phone=False, seed=11):
    c, maps = wall((W_, H_), seed=seed, brick=(58, 19) if not phone else (54, 18), ghosts=False)
    ground = H_ - (64 if not phone else 70)
    lw = 1820 if not phone else 1640
    lu = painted('09', lw, seed=21, line=1.5, hatch=1.5, wash=0.9, period=5, tone_lift=-0.1, fade=0.2)
    lx, lb = (330, ground - 18) if not phone else (-560, 810)
    cx, cy = (lx + lw // 2 + 40, lb - lu.height + 40) if not phone else (660, 500)
    # sunburst + setting sun behind the line-up (like the reference murals), painted into the brick
    rays = sunburst((W_, H_), (cx, cy), [RUST, (34, 36, 40), TEAL, (34, 36, 40), (150, 120, 96), (34, 36, 40)], n=36, seed=seed,
                    r0=0, alpha=0.6, spin=0.04, grit=0.4)
    c = place(c, rays, (0, 0), wear=0.02, relief=0.35)
    sun = Image.new('RGBA', (W_, H_), (0, 0, 0, 0)); d = ImageDraw.Draw(sun); R = 250 if not phone else 170
    d.ellipse((cx - R - 14, cy - R - 14, cx + R + 14, cy + R + 14), fill=INK + (255,))
    d.ellipse((cx - R, cy - R, cx + R, cy + R), fill=AMBER + (255,))
    hl = Image.new('RGBA', (W_, H_), (0, 0, 0, 0)); ImageDraw.Draw(hl).ellipse((cx - R * 0.72, cy - R * 0.9, cx + R * 0.6, cy + R * 0.2), fill=(250, 214, 120, 110))
    sun.alpha_composite(hl.filter(ImageFilter.GaussianBlur(20))); d = ImageDraw.Draw(sun)
    for i, yy in enumerate(range(int(cy - R * 0.05), cy + R, 30 if not phone else 24)):   # retro sunset stripes
        d.rectangle((cx - R - 20, yy, cx + R + 20, yy + 5 + i * 3), fill=INK + (255,))
    c = place(c, sun, (0, 0), wear=0.04, relief=0.1)
    c = spray_band(c, 0, 30 if not phone else 26, RUST, seed=seed + 1, alpha=0.92)
    # wall tags (layers of old pieces)
    t1 = tag('WA UNITED', 'Sedgwick Ave', 170 if not phone else 120, CREAM, outline=INK, ow=6, shadow=RUST, sw=(8, 8), angle=-4, drips=7, seed=3, fill2=GLOW)
    t3 = tag('FAIR GO', 'Black Ops One', 62 if not phone else 58, RUST, outline=INK, ow=3, shadow=None, angle=0, drips=5, seed=6)
    t4 = tag('mates first', 'Mr Dafoe', 96 if not phone else 84, GLOW, outline=INK, ow=4, shadow=None, angle=-7, drips=3, seed=8)
    t5 = tag('UNDERGROUND', 'Allerta Stencil', 44, CREAM, outline=INK, ow=2, shadow=None, angle=0, drips=0, seed=9)
    if not phone:
        c = place(c, t1, (1480, 150), opacity=0.92, wear=0.1)
        c = place(c, t3, (40, 410), opacity=0.8, wear=0.12)
        c = place(c, t4, (800, 180), opacity=0.6, wear=0.1)
    else:
        t1 = t1.resize((420, int(t1.height * 420 / t1.width)), Image.LANCZOS)
        c = place(c, t1, (566, 262), opacity=0.9, wear=0.1)
    # teal wave band (the coast) under the cars, stencil-cut
    wv = Image.new('RGBA', (W_, H_), (0, 0, 0, 0)); d = ImageDraw.Draw(wv)
    top = lb - 150 if not phone else 730
    base_ = ground if not phone else 880
    for k, col in enumerate([DEEPTEAL, TEAL, (38, 96, 106), INK]):
        pts = [(x, top + k * 30 + 16 * math.sin(x / 80 + k * 1.9)) for x in range(-20, W_ + 40, 10)]
        d.polygon(pts + [(W_ + 40, base_), (-20, base_)], fill=col + (235,))
    c = place(c, wv, (0, 0), wear=0.05, relief=0.3)
    # the showpiece: XB line-up
    c = place(c, lu, bottom_at(lu, lx, lb), wear=0.02, relief=0.05)   # low relief: the sun's stripes mustn't print through the paper
    # black headliners: Resurected burnout (01) and the FG Falcon (04)
    r01 = painted('01', 700 if not phone else 560, seed=31, line=1.1)
    fg = painted('04', 520 if not phone else 370, seed=41, line=1.1, fade=0.4)
    if not phone:
        c = place(c, r01, bottom_at(r01, 0, ground + 36), wear=0.02, relief=0.1); c = place(c, fg, bottom_at(fg, W_ - fg.width + 6, ground + 44), wear=0.02, relief=0.1)
    else:
        c = place(c, fg, bottom_at(fg, W_ - fg.width + 14, ground + 40), wear=0.02, relief=0.1); c = place(c, r01, bottom_at(r01, -16, ground + 16), wear=0.02, relief=0.1)
    c = wet_ground(c, ground + (44 if not phone else 40), seed=seed + 3, strength=0.5)
    a = to_np(c)[..., :3]; yy, xx = np.mgrid[0:H_, 0:W_].astype(np.float32)
    v = np.sqrt(((xx - W_ / 2) / (W_ / 2)) ** 2 + ((yy - H_ / 2) / (H_ / 2)) ** 2); a *= (1 - np.clip(v - 0.75, 0, 1) * 0.35)[..., None]
    return to_im(a)


# ------------------------------------------------------------------ section pieces (transparent: CSS lays them over the theme surface)
PIECES = {   # slot: (photo, sketch settings, tag word, tag colour, ray colours)
  'bn-tunes':    ('06', dict(body=RUST), 'TUNED', AMBER, [RUST, TEAL]),
  'bn-live':     ('11', dict(pre=1.8, fade=0.2, spot_glow=0.5), 'LIVE', GLOW, [TEAL, COBALT]),
  'bn-diag':     ('05', dict(), 'ROAD TRAIN', AMBER, [RUST, AMBER]),
  'bn-spec':     ('07', dict(gamma=0.9, hatch=1.3), 'SPEC IT', GLOW, [TEAL, RUST]),
  'bn-detail':   ('02', dict(gamma=0.9, hatch=1.3), 'FAIR GO', RUST, [RUST, TEAL]),
  'bn-dash':     ('10', dict(gamma=0.9, hatch=1.3), 'CRUISE', GLOW, [TEAL, AMBER]),
  'bn-report':   ('08', dict(), 'ALL PASS', AMBER, [COBALT, TEAL]),
  'bn-connect':  ('03', dict(gamma=0.9, hatch=1.3), 'SEND IT', GLOW, [AMBER, RUST]),
  'bn-settings': ('04', dict(fade=0.4), 'MATES', CREAM, [TEAL, RUST]),
}
def piece(slot, W_=1400, H_=440, seed=5):
    key, kw, word, wc, rc = PIECES[slot]
    im, _ = cut(key); vw = int(min(W_ * 0.56, (H_ - 40) * im.width / im.height * 0.92))
    v = painted(key, vw, seed=seed + len(slot), **kw)
    if v.height > H_ - 10: v = v.resize((int(v.width * (H_ - 10) / v.height), H_ - 10), Image.LANCZOS)
    c = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    vx = W_ - v.width - 20; vy = H_ - v.height
    cx, cy = vx + v.width // 2, H_ - 30
    rays = sunburst((W_, H_), (cx, cy), [rc[0], (0, 0, 0), rc[1], (0, 0, 0)], n=30, seed=seed, alpha=0.7, grit=0.4)
    a = to_np(rays); a[..., 3] *= (np.all(a[..., :3] > 2, axis=2))            # black rays = gaps
    xx = np.arange(W_)[None, :]; a[..., 3] *= np.clip((xx - (W_ * 0.36)) / (W_ * 0.22), 0, 1)   # fades out to the left (text side)
    c.alpha_composite(to_im(a, 'RGBA'))
    t = tag(word, 'Sedgwick Ave' if len(word) < 9 else 'Permanent Marker', 92, wc, outline=INK, ow=5, shadow=INK, sw=(6, 6), angle=-6, drips=4, seed=seed + 3)
    c.alpha_composite(t, (max(0, vx - t.width + 40), 30))
    c.alpha_composite(v, (vx, vy))
    return c

def texture_bg(W_=1600, H_=1092, seed=77, ov=220):
    """Faint mural wall for the page background: brick, ghost rays, faded tags (the CSS veil makes it subtle).
    Tiles vertically (painted taller, then the overflow is cross-faded into the top; H_ is a multiple of 2 brick rows)."""
    full = _texture_bg(W_, H_ + ov, seed)
    a = to_np(full); ramp = np.linspace(0, 1, ov)[:, None, None]
    a[:ov] = a[H_:H_ + ov] * (1 - ramp) + a[:ov] * ramp
    return to_im(a[:H_])

def _texture_bg(W_, H_, seed):
    c, maps = wall((W_, H_), seed=seed, brick=(64, 21), ghosts=True)
    rays = sunburst((W_, H_), (int(W_ * 0.78), int(H_ * 1.05)), [RUST, (40, 40, 44), TEAL, (40, 40, 44)], n=40, seed=seed, alpha=0.35, grit=0.8)
    c = on_wall(c, rays, (0, 0), wear=0.1, relief=0.5)
    for i, (w, f, col, xy, ang) in enumerate([('united', 'Sedgwick Ave', TEAL, (80, 120), -8), ('WA', 'Knewave', RUST, (1100, 90), 6),
                                               ('rebels', 'Mr Dafoe', CREAM, (240, 700), -4), ('fair go', 'Permanent Marker', GLOW, (980, 620), -10)]):
        t = tag(w, f, 150, col, outline=INK, ow=4, shadow=None, angle=ang, drips=5, seed=seed + i)
        c = on_wall(c, t, xy, opacity=0.35, wear=0.25, seed=seed + i)
    return c.convert('RGB')

def texture_peel(W_=900, H_=560, seed=31):
    """MintWall-style peeling paint panel: layers of cream / teal / rust paint flaking off dark render. RGBA, soft edges."""
    base = np.zeros((H_, W_, 3), np.float32) + np.array(BRICK); r = rng(seed)
    base += (noise(H_, W_, 40, seed, 4)[..., None] - 0.5) * 30
    for j, (col, thr, sc) in enumerate([(TEAL, 0.42, 160), (CREAM, 0.5, 120), (RUST, 0.58, 90)]):
        m = noise(H_, W_, sc, seed + 10 + j, 4); edge = noise(H_, W_, 14, seed + 20 + j, 3) * 0.08
        mm = np.clip((m + edge - thr) / 0.015, 0, 1)
        crack = np.clip((np.abs(m + edge - thr) < 0.006) * 1.0, 0, 1)
        shade = 0.85 + 0.3 * noise(H_, W_, 24, seed + 30 + j, 3)
        base = base * (1 - mm[..., None]) + (np.array(col) * shade[..., None]) * mm[..., None]
        base *= (1 - crack[..., None] * 0.7)
    base += r.normal(0, 6, (H_, W_, 1))
    img = to_im(base).convert('RGBA')
    al = feather_rect((W_, H_), (30, 30, W_ - 30, H_ - 30), 26); img.putalpha(al)
    return img

def texture_tags(W_=900, H_=360, seed=51):
    """Corner scribble cluster (tags, crown, arrow, stars) in cream ink on transparent, for card corners."""
    c = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    for i, (w, f, sz, col, xy, ang) in enumerate([('WA', 'Knewave', 150, CREAM, (560, 10), 8), ('rebel', 'Mr Dafoe', 120, CREAM, (330, 150), -10),
                                                   ('mates', 'Sedgwick Ave', 96, CREAM, (40, 210), -6)]):
        t = tag(w, f, sz, col, outline=(0, 0, 0), ow=0, shadow=None, angle=ang, drips=3, seed=seed + i)
        c.alpha_composite(t, xy)
    d = ImageDraw.Draw(c)   # crown + arrow, marker strokes
    x, y = 700, 220; d.line([(x, y + 60), (x + 20, y), (x + 50, y + 40), (x + 80, y), (x + 110, y + 40), (x + 140, y), (x + 160, y + 60), (x, y + 60)], fill=CREAM + (255,), width=9, joint='curve')
    st = [(300 + 46 * math.cos(math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else 0.45), 90 - 46 * math.sin(math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else 0.45)) for i in range(10)]
    d.polygon(st, outline=CREAM + (255,), width=7)
    d.line([(60, 120), (260, 60)], fill=CREAM + (255,), width=8); d.polygon([(260, 60), (224, 50), (240, 86)], fill=CREAM + (255,))
    return c

def texture_divider(W_=1600, H_=70, seed=61):
    """Spray-paint rule with drips (teal over rust), transparent."""
    c = Image.new('RGBA', (W_, H_), (0, 0, 0, 0)); a = to_np(c)
    xx = np.arange(W_)[None, :].astype(np.float32); yy = np.arange(H_)[:, None].astype(np.float32)
    for col, yc, th, sd in [(RUST, 20, 9, 1), (TEAL, 27, 6, 2)]:
        wob = (noise(1, W_, 60, seed + sd, 3)[0] - 0.5) * 8
        m = np.clip(1 - np.abs(yy - yc - wob[None, :]) / th, 0, 1) ** 0.6
        m *= np.clip(noise(H_, W_, 6, seed + sd + 5, 2) * 1.6, 0.4, 1)
        m *= np.clip(np.minimum(xx, W_ - xx) / 120, 0, 1)
        a[..., :3] = a[..., :3] * (1 - m[..., None]) + np.array(col) * m[..., None]; a[..., 3] = np.maximum(a[..., 3], m * 255)
    c = to_im(a, 'RGBA')
    return drip_from(c, 14, seed, cols=[RUST, TEAL], maxlen=40, width=5)

def sticker(key, width=760, seed=9, out_w=340, **kw):
    """Empty-state vehicle: a small tattoo-flash sketch (no ring, no outline). Drawn big, shipped small (~112 css px)."""
    p = painted(key, width, seed=seed, line=1.4, period=7.5, **kw)
    return p.resize((out_w, round(p.height * out_w / p.width)), Image.LANCZOS)

def save(img, name, q=72, alpha_q=None):
    f = os.path.join(OUT, name + '.webp')
    if img.mode == 'RGBA': img.save(f, 'WEBP', quality=q, alpha_quality=alpha_q or q, method=6)
    else: img.convert('RGB').save(f, 'WEBP', quality=q, method=6)
    print(name, img.size, os.path.getsize(f) // 1024, 'KB', flush=True); return f

if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    t = time.time()
    if what in ('hero', 'all'):
        save(hero(), 'mural-hero', q=70); save(hero(1000, 1250, phone=True), 'mural-hero-m', q=70)
    if what in ('pieces', 'all'):
        for slot in PIECES: save(piece(slot), 'pc-' + slot[3:], q=68)
    if what in ('tex', 'all'):
        save(texture_bg(), 'tex-mural', q=62); save(texture_peel(), 'tex-peel', q=64); save(texture_tags(), 'tex-tags', q=70); save(texture_divider(), 'tex-rule', q=72)
    if what in ('stickers', 'all'):
        save(sticker('06', body=RUST), 'st-gt', q=72)
        save(sticker('11', pre=1.8, fade=0.2, spot_glow=0.5), 'st-ute', q=72)
        save(sticker('02', gamma=0.9, hatch=1.3), 'st-ute-white', q=72)
    if what in ('export', 'all'):   # into the CarTune web kit: every file becomes a CSS variable (see web/build.js)
        import shutil
        kit = '/workspace/cartune-build/CarTune-OS/web/assets/street-kit/mural'; os.makedirs(kit, exist_ok=True)
        ren = {'mural-hero': 'app-header', 'mural-hero-m': 'app-header-m'}
        for f in sorted(os.listdir(OUT)):
            n = f[:-5]; n = ren.get(n, n); n = 'bn-' + n[3:] if n.startswith('pc-') else n
            shutil.copy(os.path.join(OUT, f), os.path.join(kit, n + '.webp'))
        print('exported', len(os.listdir(kit)), 'files to', kit)
    print('done', round(time.time() - t, 1))
