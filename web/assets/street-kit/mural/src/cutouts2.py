"""Extra cut-outs for the art kit (03 sand ute, 05 truck, 08 coupe on trailer, 10 sedan + mate). rembg isnet,
full frame, keep the big components. Writes photos/art/NN-cut.png and prints the crop offset (for plate boxes).
    /workspace/.rembg-venv/bin/python src/mural/cutouts2.py"""
import os, sys, json
import numpy as np
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(HERE))
W = os.path.join(ROOT, 'photos', 'work'); ART = os.path.join(ROOT, 'photos', 'art')
BOX = {'03': None, '05': None, '08': None, '10': None}
def main():
    from rembg import remove, new_session
    from scipy import ndimage
    s = new_session('isnet-general-use'); offs = {}
    for k, box in BOX.items():
        im = Image.open(os.path.join(W, k + '-plated.png')).convert('RGB')
        if box: im = im.crop(box)
        a = np.asarray(remove(im, session=s, post_process_mask=True))[..., 3].astype(np.float32) / 255
        lab, n = ndimage.label(a > 0.5)
        if n > 1:
            sizes = ndimage.sum(np.ones_like(a), lab, range(1, n + 1))
            keep = [i + 1 for i, v in enumerate(sizes) if v > 0.03 * sizes.max()]
            a = a * (np.isin(lab, keep) | (ndimage.binary_dilation(np.isin(lab, keep), iterations=3)))
        m = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
        out = im.convert('RGBA'); out.putalpha(m); bb = out.getbbox(); out = out.crop(bb)
        ox, oy = bb[0] + (box[0] if box else 0), bb[1] + (box[1] if box else 0)
        out.save(os.path.join(ART, k + '-cut.png')); offs[k] = (ox, oy); print(k, out.size, (ox, oy), flush=True)
    json.dump(offs, open(os.path.join(ART, 'cut-offsets.json'), 'w'))
if __name__ == '__main__': main()
