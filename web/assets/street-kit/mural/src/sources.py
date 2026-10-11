"""Source cut-outs for the mural kit, with the custom plate positions in each cut-out's own pixels.
Cut-outs come from src/photos (orient -> plates -> cutout -> resurected); the small ones were upscaled
with OpenCV's EDSR super-resolution (photos/art/*-x2/x4.png, see upscale.py)."""
import os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
WK = os.path.join(ROOT, 'photos', 'work'); ART = os.path.join(ROOT, 'photos', 'art')
sys.path.insert(0, os.path.join(ROOT, 'src', 'photos'))
from plates import PLATES

# where each -cut.png sits inside its -plated.png (found with cv2.matchTemplate, exact match)
CUT_AT = {'02': (351, 485), '04': (544, 412), '06': (223, 470), '07': (198, 769), '11': (34, 156)}
UPSCALED = {'04': ('04-cut-x4.png', 4), '01': ('01-cut-x2.png', 2), '11': ('11-cut-x2.png', 2), '05': ('05-cut-x2.png', 2)}
# extra cut-outs made by cutouts2.py live in photos/art (offset into the plated photo in cut-offsets.json)
ART_CUTS = ('03', '05', '08', '10')
# maker badges to paint out before stylising (cut-out pixels, before upscaling): owner asked for no Holden / Kenworth badges
BADGES = {'05': [(394, 178, 446, 203), (516, 134, 542, 180)],          # KENWORTH bonnet script, K grille emblem
          '07': [(750, 204, 818, 232)],                                 # GTS guard badge (Holden)
          '02': [(1490, 406, 1560, 504), (1570, 500, 1656, 564)]}       # Statesman bonnet ornament + grille emblem

def plate_boxes(k, scale=1.0, off=(0, 0)):
    out = []
    for *quad, text, style in PLATES.get(k, []):
        xs = [p[0] for p in quad]; ys = [p[1] for p in quad]
        out.append(((min(xs) - off[0]) * scale, (min(ys) - off[1]) * scale, (max(xs) - off[0]) * scale, (max(ys) - off[1]) * scale))
    return out

def cut(k):
    """RGBA cut-out (best resolution available) + list of plate boxes to protect, in its pixels."""
    if k in UPSCALED:
        f, s = UPSCALED[k]; im = Image.open(os.path.join(ART, f)).convert('RGBA')
    else:
        s = 1; im = Image.open(os.path.join(ART if k in ART_CUTS else WK, f'{k}-cut.png')).convert('RGBA')
    if k in BADGES:
        import cv2
        a = np.asarray(im).copy(); m = np.zeros(a.shape[:2], np.uint8)
        for x0, y0, x1, y1 in BADGES[k]: m[int(y0 * s):int(y1 * s), int(x0 * s):int(x1 * s)] = 255
        rgb = cv2.inpaint(np.ascontiguousarray(a[..., :3]), m, 9, cv2.INPAINT_TELEA); a[..., :3] = rgb
        im = Image.fromarray(a, 'RGBA')
    if k in ART_CUTS:
        import json
        CUT_AT[k] = tuple(json.load(open(os.path.join(ART, 'cut-offsets.json')))[k])
    if k == '01':   # the owner's RESURECTED plate (kept exactly as printed)
        boxes = [(614 * s, 368 * s, 711 * s, 408 * s)]
    else:
        boxes = [b for b in plate_boxes(k, s, CUT_AT.get(k, (0, 0))) if b[2] > 0 and b[0] < im.width and b[3] > 0 and b[1] < im.height]
    return im, boxes

def lineup():
    """09, the XB coupe line-up (EDSR x4 of a 960 px photo), cars cut out with rembg isnet (mask made at 1920)."""
    im = Image.open(os.path.join(ART, '09-x4.png')).convert('RGB')
    m = Image.open(os.path.join(ART, '09-mask.png')).convert('L').resize(im.size, Image.LANCZOS)
    rgba = im.convert('RGBA'); rgba.putalpha(m)
    x0, y0, x1, y1 = m.point(lambda v: 255 if v > 40 else 0).getbbox(); pad = 40
    x0, y0, x1, y1 = max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)
    boxes = [(a - x0, b - y0, c - x0, d - y0) for a, b, c, d in plate_boxes('09', 4)]
    return rgba.crop((x0, y0, x1, y1)), boxes

def unsticker(im, band=70, lmin=208, smax=0.16):
    """01 is a printed sticker: knock out its white die-cut backing (bright, flat, near the edge)
    so the drawing sits straight on the wall instead of on a sticker shape."""
    import cv2
    a = np.asarray(im.convert('RGBA')).copy(); A = a[..., 3] > 128
    al = a[..., 3:4] / 255.0; onw = np.ascontiguousarray((a[..., :3] * al + 250 * (1 - al)).astype(np.uint8))
    hsv = cv2.cvtColor(onw, cv2.COLOR_RGB2HSV)
    g = cv2.cvtColor(onw, cv2.COLOR_RGB2GRAY).astype(np.float32)
    var = cv2.GaussianBlur(g * g, (0, 0), 1.5) - cv2.GaussianBlur(g, (0, 0), 1.5) ** 2
    bright = (hsv[..., 2] >= lmin) & (hsv[..., 1] <= smax * 255) & (var < 300)
    d = cv2.distanceTransform(A.astype(np.uint8), cv2.DIST_L2, 5)
    seed = bright & A & (d < 22)
    n, lab = cv2.connectedComponents((bright & A & (d < band)).astype(np.uint8), connectivity=8)
    keep = np.unique(lab[seed]); keep = keep[keep > 0]
    back = np.isin(lab, keep)
    back = cv2.morphologyEx(back.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
    back |= A & (d < 9)
    na = np.where(back, 0, a[..., 3]).astype(np.uint8)
    na = cv2.morphologyEx(na, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats((na > 128).astype(np.uint8), connectivity=8)
    big = st[1:, cv2.CC_STAT_AREA].max()
    na[~np.isin(lab, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 0.02 * big])] = 0
    na = cv2.GaussianBlur(na, (0, 0), 1.2)
    a[..., 3] = na
    return Image.fromarray(a, 'RGBA')
