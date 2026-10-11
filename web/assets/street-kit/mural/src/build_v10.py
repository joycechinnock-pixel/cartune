"""v10: a purpose-composed phone Home mural (one whole picture at 4:3), Night and Sun.

    /workspace/.art-venv/bin/python src/mural/build_v10.py      (from style-guide/; cut-outs in /tmp/v10, see README)

No image generator was available, so this composites the owner's OWN art into a fresh composition built for the
phone header shape (not a crop of the wide banner): the CARTUNE piece, the Brougham and the blown RESURECTED car
with their burnout smoke, the muscle-car line-up and the Perth skyline with cranes come from banner A (night or
sun variant, EDSR x2 upscaled, cut out with rembg / colour keys); wattle and paint drips come from mural B. The
pieces are only cut out, scaled and placed: nothing is repainted. New, drawn by this script: the brick wall
(MintWall kinship), the wet asphalt the cars sit on, their soft reflections and contact shadows.
Output: assets/art3/hero-home-m-{night,sun}.webp (1200x900 = 3x a 400 px phone header) + PNG masters in /tmp/v10."""
import os, sys
import numpy as np, cv2
from PIL import Image, ImageFilter, ImageChops
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paint import noise, rng

T = '/tmp/v10'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'art3')
W, H = 1200, 900
B = Image.open(os.path.join(ROOT, 'owner-art', 'B-aussie-lineup-mural.png')).convert('RGB')

def brick(theme, seed=5):
    r = rng(seed); bw, bh, gap = 92, 32, 8; row = bh + gap
    night = theme == 'night'
    mortar = np.array((70, 64, 58) if night else (196, 186, 170), np.float32)
    cols = ([(46, 34, 30), (60, 44, 36), (78, 50, 40), (34, 30, 30)] if night else
            [(150, 82, 62), (170, 98, 74), (128, 70, 56), (184, 122, 96)])
    a = np.empty((H, W, 3), np.float32); a[:] = mortar
    a *= (0.85 + noise(H, W, 40, seed, 3)[..., None] * 0.3)
    for c in range(H // row + 1):
        y0 = c * row; x = -((bw + gap) // 2 if c % 2 else 0) - int(r.uniform(0, 20))
        while x < W:
            x1, x2 = max(x, 0), min(x + bw, W)
            if x2 > x1:
                col = np.array(cols[r.integers(0, len(cols))], np.float32) * r.uniform(0.85, 1.12)
                a[y0:y0 + bh, x1:x2] = col
                a[y0:y0 + 2, x1:x2] *= 1.25 if night else 1.08
                a[y0 + bh - 2:y0 + bh, x1:x2] *= 0.7
            x += bw + gap
    a *= (0.75 + noise(H, W, 16, seed + 3, 3)[..., None] * 0.5)
    a *= (0.92 + noise(H, W, 3, seed + 4, 2)[..., None] * 0.16)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).convert('RGBA')

def ragged(w, h, seed, edge=40, sides=(1, 1, 1, 1)):
    """A rough painted-edge alpha (like a piece sprayed onto the wall): solid in the middle, broken at the edges."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.full((h, w), 1e9, np.float32)
    if sides[0]: d = np.minimum(d, yy)
    if sides[1]: d = np.minimum(d, w - 1 - xx)
    if sides[2]: d = np.minimum(d, h - 1 - yy)
    if sides[3]: d = np.minimum(d, xx)
    n = noise(h, w, 14, seed, 3) * 0.7 + noise(h, w, 4, seed + 1, 2) * 0.3
    m = np.clip((d / edge) * (0.7 + n * 0.6) - (1 - n) * 0.35, 0, 1) ** 1.2
    return Image.fromarray((m * 255).astype(np.uint8))

def scale(im, s): return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)

def keyed(rgb, fn, close=0, grow=0, feather=1.5):
    """Cut a piece off the art's own black wall with a colour key (fn: HSV/lum arrays -> 0..1)."""
    a = np.asarray(rgb.convert('RGB')).astype(np.float32) / 255
    hsv = cv2.cvtColor((a * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    m = np.clip(fn(hsv[..., 0] * 2, hsv[..., 1] / 255, lum, a), 0, 1)
    m8 = (m * 255).astype(np.uint8)
    if close: m8 = cv2.morphologyEx(m8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close, close)))
    if grow: m8 = cv2.dilate(m8, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (grow, grow)))
    if feather: m8 = cv2.GaussianBlur(m8, (0, 0), feather)
    out = rgb.convert('RGBA'); out.putalpha(Image.fromarray(m8)); return out

def fill_holes(m8, max_area=2500):
    """Fill only small enclosed holes (the dark shading inside letters), never the wall between letters."""
    ff = (m8 > 127).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(1 - ff, connectivity=4)
    out = ff.copy()
    for i in range(1, n):
        x, y, w, h, a = st[i]
        touches = x == 0 or y == 0 or x + w >= ff.shape[1] or y + h >= ff.shape[0]
        if a < max_area and not touches: out[lab == i] = 1
    return out * 255

def letters(src, theme):
    """The CARTUNE piece with its blue keyline and drips, off the dark wall (holes inside the letters filled).
    The blown car's roof and blower poke up into the piece in the banner, so its rembg mask is taken out."""
    c = src.crop((900, 0, 2660, 352))
    yy_, xx_ = np.mgrid[0:352, 0:1760].astype(np.float32)
    carm = 255 * np.clip((yy_ - 240) / 14, 0, 1) * np.clip((xx_ - 180) / 40, 0, 1) * np.clip((960 - xx_) / 40, 0, 1)   # roof + blower zone
    a = np.asarray(c).astype(np.float32) / 255
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    blue = (a[..., 2] - np.maximum(a[..., 0], a[..., 1]) > 0.12) & (a[..., 2] > 0.35)
    m = ((lum > 0.30) | blue).astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    m = fill_holes(m)
    m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))      # keep the dark outline round the keyline
    yy = np.arange(m.shape[0])[:, None]
    m = (m.astype(np.float32) * np.clip((352 - yy) / 40, 0, 1) * (1 - carm / 255)).astype(np.uint8)   # soft foot, no car
    m = cv2.GaussianBlur(m, (0, 0), 1.2)
    out = c.convert('RGBA'); out.putalpha(Image.fromarray(m)); return out

def smoke(src, theme):
    """Burnout smoke: the cloud bank above the Brougham in banner A (no car in it), keyed off the dark wall
    (bright = dense, mid greys = thin), with broken edges so it rolls rather than sits in a box."""
    c = src.crop((0, 0, 820, 178))
    def f(h, s, l, a): return np.clip((l - 0.22) / 0.42, 0, 1) * np.clip(1 - s * 3.0, 0, 1)
    k = keyed(c, f, close=0, feather=1.5)
    al = np.asarray(k.split()[3]).astype(np.float32) * np.asarray(ragged(c.width, c.height, 41, edge=70)).astype(np.float32) / 255
    k.putalpha(Image.fromarray(al.astype(np.uint8))); return k

def car(path, keep, drop=None):
    """rembg cut-out, restricted to the car's own box (drops stray lettering/birds rembg picked up)."""
    im = Image.open(path).convert('RGBA'); al = np.asarray(im.split()[3]).astype(np.float32)
    x0, y0, x1, y1 = keep; box = np.zeros_like(al); box[int(y0 * al.shape[0]):int(y1 * al.shape[0]), int(x0 * al.shape[1]):int(x1 * al.shape[1])] = 1
    if drop:
        a0, b0, a1, b1 = drop; box[int(b0 * al.shape[0]):int(b1 * al.shape[0]), int(a0 * al.shape[1]):int(a1 * al.shape[1])] = 0
    box = cv2.GaussianBlur(box, (0, 0), 6)
    xx = np.arange(al.shape[1])[None, :].astype(np.float32); edge = np.clip(np.minimum(xx, al.shape[1] - 1 - xx) / 40, 0, 1)
    im.putalpha(Image.fromarray((al * box * edge).astype(np.uint8)))
    return im.crop(im.getbbox())

def shadow(w, h, op):
    s = Image.new('L', (w, h), 0); a = np.zeros((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.clip(1 - (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2), 0, 1) ** 0.7 * 255 * op
    k = Image.new('RGBA', (w, h), (0, 0, 0, 255)); k.putalpha(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)))
    return k

def reflect(piece, op, fade):
    f = piece.transpose(Image.FLIP_TOP_BOTTOM).filter(ImageFilter.GaussianBlur(2.5))
    al = np.asarray(f.split()[3]).astype(np.float32)
    al *= np.clip(1 - np.arange(f.height)[:, None] / fade, 0, 1) * op
    f.putalpha(Image.fromarray(al.astype(np.uint8))); return f

def compose(theme):
    night = theme == 'night'
    src = Image.open(f'{T}/{theme}_x2.png').convert('RGB')
    h2 = src.height
    can = brick(theme)

    # 1. the skyline + cranes at sunset (night) / under blue sky (sun), sprayed on the brick with a rough edge
    sky = src.crop((2700, 0, 4206, int(h2 * 0.56)))
    sky = scale(sky, W * 0.9 / sky.width).convert('RGBA')
    sky.putalpha(ragged(sky.width, sky.height, 21, edge=70, sides=(1, 1, 1, 1)))
    can.alpha_composite(sky, ((W - sky.width) // 2, 44))

    # 2. wattle (mural B) breaking in from the top-left and right edges, paint drips top-right
    wat = keyed(B.crop((196, 110, 470, 345)), lambda h, s, l, a: np.clip((s - 0.38) / 0.2, 0, 1) * np.clip((l - 0.12) / 0.1, 0, 1), close=3, feather=1.2)
    wl = scale(wat, 0.95); can.alpha_composite(wl, (-30, 250))
    wr = scale(wat.transpose(Image.FLIP_LEFT_RIGHT), 0.75); can.alpha_composite(wr, (W - wr.width + 40, 300))
    drips = keyed(B.crop((1660, 0, 1990, 190)), lambda h, s, l, a: np.clip((s - 0.42) / 0.2, 0, 1) * np.clip((l - 0.18) / 0.1, 0, 1), close=3, feather=1)
    can.alpha_composite(scale(drips, 1.3), (W - int(330 * 1.3) + 30, -6))
    can.alpha_composite(scale(drips.transpose(Image.FLIP_LEFT_RIGHT), 0.9), (-40, -4))

    # 3. CARTUNE: the owner's piece, big, across the frame
    nsrc = Image.open(f'{T}/night_x2.png').convert('RGB')
    L = letters(nsrc, 'night'); L = scale(L, (W - 40) / L.width)
    can.alpha_composite(L, (20, 196))

    # 4. the muscle-car line-up on wet asphalt
    ground_y = 470
    g = np.zeros((H - ground_y, W, 4), np.float32)
    base = (10, 10, 12) if night else (30, 32, 37)
    g[..., :3] = base; ramp = np.clip(np.arange(H - ground_y) / 60, 0, 1)[:, None]
    g[..., 3] = 255 * ramp * (0.96 if night else 0.93)
    g[..., :3] *= (0.85 + noise(H - ground_y, W, 9, 33, 2)[..., None] * 0.35)
    gim = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGBA')
    can.alpha_composite(gim, (0, ground_y))
    row = Image.open(f'{T}/{theme}_row.png').convert('RGBA'); row = row.crop(row.getbbox())
    row = scale(row, (W + 30) / row.width)
    ral = np.asarray(row.split()[3]).astype(np.float32); ral *= np.clip((row.height - np.arange(row.height)[:, None]) / 26, 0, 1)
    row.putalpha(Image.fromarray(ral.astype(np.uint8)))
    ry = 560 - row.height
    can.alpha_composite(reflect(row, 0.28 if night else 0.2, 90), (-15, ry + row.height - 6))
    can.alpha_composite(row, (-15, ry))

    # 5. burnout smoke rolling across, then the two black heroes in front
    sm = smoke(nsrc, 'night')
    for (sc, x, y, flip) in ((1.0, -120, 560, 0), (0.95, 420, 600, 1), (0.9, 760, 540, 0), (0.8, -60, 700, 1), (0.85, 520, 720, 0), (0.7, 880, 700, 1)):
        piece = scale(sm.transpose(Image.FLIP_LEFT_RIGHT) if flip else sm, sc)
        can.alpha_composite(piece, (x, y))
    if night:
        bro = car(f'{T}/night_bro_cut.png', (0.04, 0.12, 1.0, 1.0))
        res = car(f'{T}/night_res_cut.png', (0.0, 0.38, 1.0, 1.0))
    else:
        bro = car(f'{T}/sun_bro_cut.png', (0.04, 0.14, 1.0, 1.0), drop=(0.0, 0.0, 0.2, 0.5))   # no cockatoo
        res = car(f'{T}/sun_res_cut.png', (0.0, 0.33, 1.0, 1.0), drop=(0.25, 0.0, 1.0, 0.36))
    bro = scale(bro, 620 / bro.width); res = scale(res, 660 / res.width)
    bx, by = -40, H - bro.height - 18
    rx, ry2 = W - res.width + 30, H - res.height - 4
    for (pc, x, y) in ((bro, bx, by), (res, rx, ry2)):
        can.alpha_composite(shadow(int(pc.width * 0.95), 70, 0.9 if night else 0.6), (x + int(pc.width * 0.03), y + pc.height - 48))
    can.alpha_composite(reflect(res, 0.22 if night else 0.15, 60), (rx, ry2 + res.height - 10))
    can.alpha_composite(res, (rx, ry2))
    can.alpha_composite(bro, (bx, by))
    # a last curl of smoke round the RESURECTED car's rear wheel, in front
    curl = scale(sm, 0.45); can.alpha_composite(curl, (rx - 150, H - curl.height + 10))
    return can.convert('RGB')

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for th in ('night', 'sun'):
        im = compose(th)
        im.save(f'{T}/home-m-{th}.png')
        im.save(os.path.join(OUT, f'hero-home-m-{th}.webp'), 'WEBP', quality=82, method=6)
        print(th, os.path.getsize(os.path.join(OUT, f'hero-home-m-{th}.webp')) // 1024, 'KB')
