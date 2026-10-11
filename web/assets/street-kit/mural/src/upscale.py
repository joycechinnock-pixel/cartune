import cv2, time, sys
sr = cv2.dnn_superres.DnnSuperResImpl_create()
for src, model, scale, out in [("photos/work/09-plated.png","EDSR_x4",4,"photos/art/09-x4.png"),("photos/work/04-cut.png","EDSR_x4",4,"photos/art/04-cut-x4.png"),("photos/work/01-cut.png","EDSR_x2",2,"photos/art/01-cut-x2.png"),("photos/work/11-cut.png","EDSR_x2",2,"photos/art/11-cut-x2.png"),("photos/art/05-cut.png","EDSR_x2",2,"photos/art/05-cut-x2.png")]:
    if len(sys.argv) > 1 and not any(a in out for a in sys.argv[1:]): continue
    t=time.time()
    im = cv2.imread(src, cv2.IMREAD_UNCHANGED)
    sr.readModel(f"/workspace/.art-models/{model}.pb"); sr.setModel("edsr", scale)
    rgb = sr.upsample(im[..., :3])
    if im.shape[2] == 4:
        a = cv2.resize(im[..., 3], (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
        rgb = cv2.merge([*cv2.split(rgb), a])
    cv2.imwrite(out, rgb); print(out, rgb.shape, round(time.time()-t,1), flush=True)
