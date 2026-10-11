"""Palette sampling for tokens v2.0: median colour of a hue/saturation mask over regions of the owner's artworks.
   python3 src/sample_art.py   (numpy, pillow, opencv; e.g. /workspace/.art-venv/bin/python)"""
from PIL import Image; import numpy as np, colorsys
import os; R=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','owner-art')
A=os.path.join(R,'A-cartune-banners.png')
B=os.path.join(R,'B-aussie-lineup-mural.png')
a=np.asarray(Image.open(A).convert('RGB')).astype(float); b=np.asarray(Image.open(B).convert('RGB')).astype(float)
import cv2
def hsv(x): return cv2.cvtColor(x.astype(np.uint8)[None],cv2.COLOR_RGB2HSV)[0].astype(float)  # H 0-180
def pick(img,box,hr=None,smin=0,vmin=0,vmax=255,smax=255,label=''):
    x0,y0,x1,y1=box; px=img[y0:y1,x0:x1].reshape(-1,3); h=hsv(px)
    m=(h[:,1]>=smin)&(h[:,1]<=smax)&(h[:,2]>=vmin)&(h[:,2]<=vmax)
    if hr: m&=(h[:,0]>=hr[0])&(h[:,0]<=hr[1])
    sel=px[m]; med=np.median(sel,axis=0).astype(int)
    # also 75th percentile brightness pick (vivid)
    v=sel.max(axis=1); q=sel[v>=np.percentile(v,60)]; viv=np.median(q,axis=0).astype(int)
    print(f'{label:22s} n={m.sum():7d} median #{med[0]:02X}{med[1]:02X}{med[2]:02X}  vivid #{viv[0]:02X}{viv[1]:02X}{viv[2]:02X}')
pick(b,(450,10,1550,260),label='B black wall',vmax=80)
pick(b,(450,10,1550,260),label='B wall all')
pick(b,(0,0,380,330),hr=(18,32),smin=150,vmin=150,label='B wattle yellow')
pick(b,(700,430,1150,650),hr=(18,32),smin=150,vmin=120,label='B GTS yellow')
pick(b,(1830,0,2103,260),hr=(95,110),smin=150,vmin=120,label='B sky splash blue')
pick(b,(1720,430,2070,570),hr=(100,125),smin=120,vmin=60,label='B cobalt car')
pick(b,(250,40,460,240),hr=(40,80),smin=120,vmin=90,label='B green splash')
pick(b,(10,350,410,560),hr=(40,90),smin=80,vmin=50,label='B green FJ')
pick(b,(930,370,1450,520),hr=(5,17),smin=150,vmin=150,label='B orange torana')
pick(b,(1140,450,1560,630),hr=(0,6),smin=150,vmin=120,label='B red torana')
pick(b,(1100,600,1700,748),hr=(0,15),smin=150,vmin=150,label='B orange/red streak')
n=a[0:293]; s=a[300:543]; f=a[550:748]
pick(n,(1700,0,2103,130),hr=(0,20),smin=150,vmin=150,label='A night sunset')
pick(n,(0,0,450,120),smax=40,vmin=170,label='A night smoke white')
pick(n,(450,0,1400,180),hr=(95,115),smin=150,vmin=100,label='A night letter blue')
pick(s,(1300,0,2103,90),hr=(95,115),smin=80,vmin=120,label='A sun sky blue')
pick(f,(0,0,1200,150),hr=(0,20),smin=180,vmin=180,label='A fire orange')
pick(f,(0,0,1200,150),hr=(170,180),smin=180,vmin=120,label='A fire red')
pick(f,(1000,0,1450,100),hr=(15,35),smin=150,vmin=180,label='A fire letter yellow')
pick(n,(0,230,2103,293),vmax=60,label='A asphalt')
