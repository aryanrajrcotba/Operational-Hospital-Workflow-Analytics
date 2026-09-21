"""T5 - Biomedical image analysis: SIFT, RANSAC, CNN.

A. Registration.  A second "scan" of the same phantom is made with a *known* rotation, scale and shift.
   SIFT finds keypoints and descriptors in both images, descriptors are matched with Lowe's ratio test, and
   RANSAC fits a similarity transform that ignores the wrong matches.  Because the true transform is known we
   can measure the error directly, including the target registration error (TRE) at the nodules.
B. CNN.  A small convolutional network is trained to tell nodule patches from everything else (vessels,
   ribs, heart edge, plain lung), scored on cases it never saw, compared with two simple baselines, and used
   as a sliding-window detector on a whole slice.

Patches are cut from freshly rendered phantom slices; nothing here is patient data.
"""
import base64
import time

import numpy as np
import torch
from scipy import ndimage as ndi
from skimage import measure, transform
from skimage.feature import SIFT, match_descriptors
from skimage.transform import SimilarityTransform, warp
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, roc_curve

from . import phantom as P
from .config import INTERIM
from .imaging_utils import save_png, to_rgb

SIZE = 256
LUNG = (-600, 1500)
TRUE_TF = dict(rotation_deg=12.0, scale=1.08, dx=14.0, dy=-9.0)      # dx, dy: shift of the image centre
PATCH = 32
NEG_PER_POS = 3
SPLITS = {"train": 220, "val": 40, "test": 80}          # number of independent phantom "patients"
SEED0 = {"train": 1000, "val": 5000, "test": 9000}      # spec seeds never overlap the showcase (seed 3)
EPOCHS, BATCH, LR = 60, 64, 3e-3
LSE_R = 2.0                     # sharpness of the log-sum-exp pooling (r -> inf is max pooling, r -> 0 is average)
TORCH_SEEDS = [0, 1, 2]


def _b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def _lung_u8(hu):
    return P.window(hu, *LUNG)


# ================================================================== A. SIFT + RANSAC
def _true_transform():
    c = np.array([SIZE / 2 - 0.5, SIZE / 2 - 0.5])
    to_c, from_c = SimilarityTransform(translation=-c), SimilarityTransform(translation=c)
    rs = SimilarityTransform(scale=TRUE_TF["scale"], rotation=np.deg2rad(TRUE_TF["rotation_deg"]))
    shift = SimilarityTransform(translation=(TRUE_TF["dx"], TRUE_TF["dy"]))
    return SimilarityTransform(matrix=(shift.params @ from_c.params @ rs.params @ to_c.params))   # reference -> moving


def _params(tf):
    """Rotation, scale and where the image centre moves to (independent of the rotation centre chosen)."""
    m = tf.params
    c = np.array([[SIZE / 2 - 0.5, SIZE / 2 - 0.5]])
    d = (tf(c) - c)[0]
    return {"rotation_deg": float(np.rad2deg(np.arctan2(m[1, 0], m[0, 0]))), "scale": float(np.hypot(m[0, 0], m[1, 0])),
            "dx": float(d[0]), "dy": float(d[1])}


def _tre(true_tf, est_tf, pts):
    """Mean distance (px) between where the true and estimated transforms send the given reference points."""
    return float(np.linalg.norm(true_tf(pts) - est_tf(pts), axis=1).mean())


def _draw_kp(u8, kp, sc):
    rgb = to_rgb(u8).copy()
    from PIL import Image, ImageDraw
    im = Image.fromarray(rgb)
    d = ImageDraw.Draw(im)
    for (y, x), s in zip(kp, sc):
        r = max(2.0, float(s) * 1.6)
        d.ellipse([x - r, y - r, x + r, y + r], outline=(255, 210, 40))
    return np.array(im)


def _draw_matches(a, b, ka, kb, inl, max_lines=140):
    from PIL import Image, ImageDraw
    canvas = Image.fromarray(np.hstack([to_rgb(a), to_rgb(b)]))
    d = ImageDraw.Draw(canvas)
    idx = np.arange(len(ka))
    rng = np.random.default_rng(0)
    if len(idx) > max_lines:
        idx = np.sort(rng.choice(idx, max_lines, replace=False))
    for i in idx:
        col = (60, 230, 110) if inl[i] else (240, 70, 70)
        d.line([ka[i][1], ka[i][0], kb[i][1] + SIZE, kb[i][0]], fill=col, width=1)
    return np.array(canvas)


def registration():
    tf_true = _true_transform()
    spec = P.make_spec(P.SHOWCASE_SEED, showcase=True)
    ref_i = P.render(spec, [0.0], SIZE, SIZE)
    mov_i = P.render(spec, [0.02], SIZE, SIZE)                       # a slightly different level: anatomy is not identical
    ref = P.acquire(ref_i["hu"][0], 101, blur=0.9, noise=40.0)
    mov_warp = warp(mov_i["hu"][0], tf_true.inverse, output_shape=(SIZE, SIZE), order=1, cval=-1000.0, preserve_range=True)
    mov = P.acquire(mov_warp.astype(np.float32), 102, blur=0.9, noise=50.0)
    ru, mu = _lung_u8(ref), _lung_u8(mov)

    def sift(u8):
        s = SIFT(upsampling=1, c_dog=0.04 / 3 * 1.5)
        s.detect_and_extract(u8.astype(float) / 255.0)
        return s

    t0 = time.time()
    sa, sb = sift(ru), sift(mu)
    matches = match_descriptors(sa.descriptors, sb.descriptors, max_ratio=0.8, cross_check=True)
    ka, kb = sa.keypoints[matches[:, 0]], sb.keypoints[matches[:, 1]]          # (row, col)
    src, dst = ka[:, ::-1].astype(float), kb[:, ::-1].astype(float)           # (x, y)
    err = np.linalg.norm(tf_true(src) - dst, axis=1)
    truly = err < 3.0
    nod = np.array([[(n[0] + 1) / 2 * SIZE, (n[1] + 1) / 2 * SIZE] for n in ref_i["spec"]["nodules"]])   # (x, y) px

    ls = SimilarityTransform(); ls.estimate(src, dst)
    model, inl = measure.ransac((src, dst), SimilarityTransform, min_samples=2, residual_threshold=3.0, max_trials=3000, rng=0)
    res = {
        "true": TRUE_TF, "n_kp": [int(len(sa.keypoints)), int(len(sb.keypoints))], "n_matches": int(len(matches)),
        "matches_truly_correct": int(truly.sum()), "match_precision": round(float(truly.mean() * 100), 1),
        "ransac_inliers": int(inl.sum()), "ransac_inlier_precision": round(float(truly[inl].mean() * 100), 1),
        "ransac_outliers_removed": int((~inl).sum()), "seconds": round(time.time() - t0, 1),
        "ls": {**{k: round(v, 3) for k, v in _params(ls).items()}, "tre_px": round(_tre(tf_true, ls, nod), 2)},
        "ransac": {**{k: round(v, 3) for k, v in _params(model).items()}, "tre_px": round(_tre(tf_true, model, nod), 2)},
        "mm_per_px": round(P.MM_PER_UNIT * 2 / SIZE, 3),
    }

    # ---- pictures
    res["img"] = {
        "kp_ref": save_png(_draw_kp(ru, sa.keypoints, sa.scales), "t5/kp_ref.png"),
        "kp_mov": save_png(_draw_kp(mu, sb.keypoints, sb.scales), "t5/kp_mov.png"),
        "matches": save_png(_draw_matches(ru, mu, ka, kb, inl), "t5/matches.png"),
    }
    def overlay(a, b):                                    # reference = red, moving = green, aligned structures turn yellow
        return np.stack([a, b, np.zeros_like(a)], -1)
    back = warp(mov, model, output_shape=(SIZE, SIZE), order=1, cval=-1000.0, preserve_range=True)   # moving -> reference frame
    res["img"]["before"] = save_png(overlay(ru, mu), "t5/overlay_before.png")
    res["img"]["after"] = save_png(overlay(ru, _lung_u8(back)), "t5/overlay_after.png")
    rb = _lung_u8(back)
    cb = np.zeros_like(ru); tile = 32
    yy, xx = np.indices(ru.shape)
    chk = ((yy // tile + xx // tile) % 2).astype(bool)
    cb[chk], cb[~chk] = ru[chk], rb[~chk]
    res["img"]["checker"] = save_png(cb, "t5/checker_after.png")

    # ---- residual threshold sweep
    sweep = []
    for th in (0.5, 1, 2, 3, 5, 8, 12, 20):
        m, i = measure.ransac((src, dst), SimilarityTransform, min_samples=2, residual_threshold=th, max_trials=3000, rng=0)
        sweep.append({"threshold": th, "inliers": int(i.sum()) if m is not None else 0,
                      "precision": round(float(truly[i].mean() * 100), 1) if m is not None and i.sum() else None,
                      "tre_px": round(_tre(tf_true, m, nod), 2) if m is not None else None})
    res["threshold_sweep"] = sweep

    # ---- robustness: keep the correct matches, add k random wrong ones
    good_s, good_d = src[truly], dst[truly]
    rng = np.random.default_rng(0)
    rob = []
    for frac in (0, 10, 20, 30, 40, 50, 60, 70, 80, 90):
        k = int(round(len(good_s) * frac / (100 - frac))) if frac else 0
        e_ls, e_rs = [], []
        for _ in range(40):
            bs = rng.uniform(0, SIZE, (k, 2)); bd = rng.uniform(0, SIZE, (k, 2))
            S, D = np.vstack([good_s, bs]), np.vstack([good_d, bd])
            t1 = SimilarityTransform(); t1.estimate(S, D)
            t2, _ = measure.ransac((S, D), SimilarityTransform, min_samples=2, residual_threshold=3.0, max_trials=1000, rng=int(rng.integers(1e6)))
            e_ls.append(_tre(tf_true, t1, nod))
            e_rs.append(_tre(tf_true, t2, nod) if t2 is not None else np.nan)
        rob.append({"outlier_pct": frac, "ls_median": round(float(np.nanmedian(e_ls)), 2), "ls_p90": round(float(np.nanpercentile(e_ls, 90)), 2),
                    "ransac_median": round(float(np.nanmedian(e_rs)), 2), "ransac_p90": round(float(np.nanpercentile(e_rs, 90)), 2)})
    res["robustness"] = {"rows": rob, "good_matches": int(truly.sum()), "trials": 40}
    return res


# ================================================================== B. CNN
def _make_split(name):
    rng = np.random.default_rng(SEED0[name])
    X, y, meta = [], [], []
    half = PATCH // 2

    def cut(hu, cy, cx):
        pad = np.pad(hu, half, mode="constant", constant_values=-1000)
        return pad[int(cy):int(cy) + PATCH, int(cx):int(cx) + PATCH]

    for i in range(SPLITS[name]):
        spec = P.make_spec(SEED0[name] + i)
        nod = spec["nodules"]
        if not nod:
            continue
        blur, noise = rng.uniform(0.7, 1.2), rng.uniform(30, 70)
        for (nx_, ny_, nz_, r_, hu_) in nod:                               # positives: slice through the nodule
            z = nz_ + rng.uniform(-0.5, 0.5) * r_
            rd = P.render(spec, [z], SIZE, SIZE)
            img = P.acquire(rd["hu"][0], int(rng.integers(1 << 30)), blur=blur, noise=noise)
            cx_, cy_ = (nx_ + 1) / 2 * SIZE - 0.5 + rng.uniform(-3, 3), (ny_ + 1) / 2 * SIZE - 0.5 + rng.uniform(-3, 3)
            X.append(_lung_u8(cut(img, cy_ - half + half, cx_ - half + half))); y.append(1); meta.append(i)
        for _ in range(2):                                                # negatives from random levels
            z = rng.uniform(-0.55, 0.55)
            rd = P.render(spec, [z], SIZE, SIZE)
            img = P.acquire(rd["hu"][0], int(rng.integers(1 << 30)), blur=blur, noise=noise)
            lung, nodm, ideal = rd["lung"][0], rd["nodule"][0], rd["hu"][0]
            near_nod = ndi.binary_dilation(nodm, iterations=10)
            free_lung = ndi.binary_erosion(lung, iterations=8) & ~near_nod
            vessel = (ideal > -300) & lung & ~near_nod & ndi.binary_erosion(lung, iterations=4)
            other = rd["body"][0] & ~near_nod & ~ndi.binary_erosion(lung, iterations=2)
            n_pos_here = len(nod)
            want = (NEG_PER_POS * n_pos_here) // 2 + 1
            for pool, share in ((free_lung, 0.5), (vessel, 0.33), (other, 0.17)):
                pts = np.argwhere(pool)
                if len(pts) == 0:
                    continue
                for _k in range(max(1, int(round(want * share)))):
                    cy, cx = pts[rng.integers(len(pts))]
                    X.append(_lung_u8(cut(img, cy, cx))); y.append(0); meta.append(i)
    return np.array(X, np.uint8), np.array(y, np.int64), np.array(meta)


def _dataset():
    cache = INTERIM / "t5_patches.npz"
    key = np.array([PATCH, NEG_PER_POS, *SPLITS.values(), *SEED0.values(), 3])
    if cache.exists():
        z = np.load(cache)
        if np.array_equal(z["key"], key):
            return {s: (z[f"X_{s}"], z[f"y_{s}"]) for s in SPLITS}
    out = {s: _make_split(s)[:2] for s in SPLITS}
    INTERIM.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, key=key, **{f"X_{s}": v[0] for s, v in out.items()}, **{f"y_{s}": v[1] for s, v in out.items()})
    return out


class Net(torch.nn.Module):
    """3 conv blocks (conv, batch-norm, ReLU) -> 1x1 conv giving a nodule-score map -> log-sum-exp pooling -> one logit.
    Pooling by (soft) maximum suits small objects: a 6-pixel nodule is one strong location in the map, and
    averaging the whole map would dilute it.  The score map itself doubles as a class-activation map."""

    def __init__(self):
        super().__init__()
        self.c1 = torch.nn.Conv2d(1, 8, 3, padding=1)
        self.c2 = torch.nn.Conv2d(8, 16, 3, padding=1)
        self.c3 = torch.nn.Conv2d(16, 32, 3, padding=1)
        self.b1, self.b2, self.b3 = torch.nn.BatchNorm2d(8), torch.nn.BatchNorm2d(16), torch.nn.BatchNorm2d(32)
        self.head = torch.nn.Conv2d(32, 1, 1)

    def features(self, x):
        a1 = torch.relu(self.b1(self.c1(x)))
        a2 = torch.relu(self.b2(self.c2(torch.nn.functional.max_pool2d(a1, 2))))
        a3 = torch.relu(self.b3(self.c3(torch.nn.functional.max_pool2d(a2, 2))))
        return a1, a3

    def score_map(self, x):
        return self.head(self.features(x)[1])[:, 0]

    def forward(self, x):
        m = self.score_map(x).flatten(1)
        return (torch.logsumexp(m * LSE_R, 1) - float(np.log(m.shape[1]))) / LSE_R


def _tens(X):
    return torch.from_numpy(X.astype(np.float32) / 255.0).unsqueeze(1)


def _augment(xb):
    if torch.rand(1) < 0.5:
        xb = xb.flip(3)
    if torch.rand(1) < 0.5:
        xb = xb.flip(2)
    return torch.rot90(xb, int(torch.randint(0, 4, (1,))), (2, 3))


def _train(seed, data):
    torch.manual_seed(seed)
    net = Net()
    Xtr, ytr = _tens(data["train"][0]), torch.from_numpy(data["train"][1]).float()
    Xva, yva = _tens(data["val"][0]), torch.from_numpy(data["val"][1]).float()
    opt = torch.optim.Adam(net.parameters(), lr=LR)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, EPOCHS)
    lossf = torch.nn.BCEWithLogitsLoss()
    hist, best, best_state = [], (1e9, None), None
    for ep in range(EPOCHS):
        net.train()
        perm = torch.randperm(len(Xtr))
        tl = tc = 0.0
        for i in range(0, len(Xtr), BATCH):
            idx = perm[i:i + BATCH]
            xb, yb = _augment(Xtr[idx]), ytr[idx]
            opt.zero_grad()
            out = net(xb)
            loss = lossf(out, yb)
            loss.backward(); opt.step()
            tl += float(loss) * len(idx); tc += float(((out > 0).float() == yb).sum())
        sched.step()
        net.eval()
        with torch.no_grad():
            ov = net(Xva)
            vl = float(lossf(ov, yva)); vc = float(((ov > 0).float() == yva).float().mean())
        hist.append({"epoch": ep + 1, "train_loss": round(tl / len(Xtr), 4), "val_loss": round(vl, 4),
                     "train_acc": round(tc / len(Xtr) * 100, 2), "val_acc": round(vc * 100, 2)})
        if vl < best[0]:
            best = (vl, ep + 1)
            best_state = {k: v.clone() for k, v in net.state_dict().items()}
    net.load_state_dict(best_state)
    net.eval()
    return net, hist, best[1]


def _prob(net, X):
    with torch.no_grad():
        return torch.sigmoid(net(_tens(X))).numpy()


def _metrics(y, p, thr=0.5):
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
    prec, rec = tp / max(tp + fp, 1), tp / max(tp + fn, 1)
    return {"accuracy": round((tp + tn) / len(y) * 100, 2), "precision": round(prec * 100, 1), "recall": round(rec * 100, 1),
            "f1": round(2 * prec * rec / max(prec + rec, 1e-9) * 100, 1), "auc": round(float(roc_auc_score(y, p)), 4),
            "cm": {"tp": tp, "fp": fp, "fn": fn, "tn": tn}}


def _roc(y, p, n=40):
    f, t, _ = roc_curve(y, p)
    idx = np.unique(np.linspace(0, len(f) - 1, n).astype(int))
    return {"fpr": [round(float(v), 4) for v in f[idx]], "tpr": [round(float(v), 4) for v in t[idx]]}


def _baselines(data):
    Xtr, ytr = data["train"][0].reshape(len(data["train"][0]), -1) / 255.0, data["train"][1]
    Xte, yte = data["test"][0].reshape(len(data["test"][0]), -1) / 255.0, data["test"][1]
    lr = LogisticRegression(max_iter=2000, C=1.0).fit(Xtr, ytr)
    p_lr = lr.predict_proba(Xte)[:, 1]

    def blob(X):                                      # centre brightness minus surround brightness
        im = X.reshape(-1, PATCH, PATCH)
        c = im[:, 12:20, 12:20].mean((1, 2))
        ring = (im.sum((1, 2)) - im[:, 8:24, 8:24].sum((1, 2))) / (PATCH * PATCH - 16 * 16)
        return c - ring
    s_tr, s_te = blob(Xtr), blob(Xte)
    ths = np.quantile(s_tr, np.linspace(0.05, 0.95, 91))
    thr = max(ths, key=lambda t: ((s_tr > t) == ytr).mean())
    # convert score to a monotone pseudo-probability for AUC / metrics
    p_bl = 1 / (1 + np.exp(-(s_te - thr) * 30))
    return {"Logistic regression on pixels": (p_lr, 0.5), "Centre-surround rule": (p_bl, 0.5)}


def _cam(net, x):
    with torch.no_grad():
        return net.score_map(x).numpy()


def cnn():
    t0 = time.time()
    data = _dataset()
    sizes = {s: {"patches": int(len(data[s][1])), "nodules": int(data[s][1].sum()), "cases": SPLITS[s]} for s in SPLITS}
    runs = []
    for sd in TORCH_SEEDS:
        net, hist, best_ep = _train(sd, data)
        p = _prob(net, data["test"][0])
        runs.append((net, hist, best_ep, p, roc_auc_score(data["test"][1], p)))
    main = runs[0]
    net, hist, best_ep, p_test, _ = main
    yte = data["test"][1]
    res = {"sizes": sizes, "patch_px": PATCH, "patch_mm": round(PATCH * P.MM_PER_UNIT * 2 / SIZE), "epochs": EPOCHS,
           "params": int(sum(p.numel() for p in net.parameters())), "best_epoch": best_ep, "history": hist,
           "test": _metrics(yte, p_test), "roc": _roc(yte, p_test),
           "seeds": {"auc": [round(float(r[4]), 4) for r in runs],
                     "accuracy": [_metrics(yte, r[3])["accuracy"] for r in runs]}}
    base = {}
    for name, (pb, thr) in _baselines(data).items():
        base[name] = {**_metrics(yte, pb, thr), "roc": _roc(yte, pb)}
    res["baselines"] = base

    # ---- inside the network: filters, feature maps, class-activation maps on chosen test patches
    Xte = data["test"][0]
    order = np.argsort(-p_test)
    tp = [i for i in order if yte[i] == 1 and p_test[i] >= 0.5][:4]
    fn = [i for i in np.argsort(p_test) if yte[i] == 1 and p_test[i] < 0.5][:2]
    fp = [i for i in order if yte[i] == 0 and p_test[i] >= 0.5][:3]
    tn = [i for i in np.argsort(p_test) if yte[i] == 0][:3]
    ex = []
    for kind, ids in (("Nodule found", tp), ("Nodule missed", fn), ("False alarm", fp), ("Correctly rejected", tn)):
        for i in ids:
            cam = _cam(net, _tens(Xte[i:i + 1]))[0]
            cam = (cam - cam.min()) / (np.ptp(cam) + 1e-9)
            ex.append({"kind": kind, "prob": round(float(p_test[i]), 3), "patch": _b64(Xte[i]), "cam": [round(float(v), 3) for v in cam.ravel()]})
    res["examples"] = ex
    w1 = net.c1.weight.detach().numpy()[:, 0]
    res["filters"] = [[[round(float(v), 3) for v in row] for row in k] for k in w1]
    ref = tp[0] if tp else 0
    with torch.no_grad():
        a1, a3 = net.features(_tens(Xte[ref:ref + 1]))
    fm = a1[0].numpy()
    fm8 = np.clip(fm / (fm.max() + 1e-9) * 255, 0, 255).astype(np.uint8)
    res["feature_maps"] = {"size": int(fm8.shape[1]), "maps": [_b64(m) for m in fm8], "patch": _b64(Xte[ref])}

    # ---- sliding-window detection on the (unseen) showcase slice
    spec = P.make_spec(P.SHOWCASE_SEED, showcase=True)
    rd = P.render(spec, [0.0], SIZE, SIZE)
    img = P.acquire(rd["hu"][0], 303, blur=0.9, noise=50.0)
    u8 = _lung_u8(img)
    stride, half = 4, PATCH // 2
    pad = np.pad(u8, half, constant_values=0)
    ys = list(range(0, SIZE, stride))
    wins = np.stack([pad[y:y + PATCH, x:x + PATCH] for y in ys for x in ys])
    pm = _prob(net, wins).reshape(len(ys), len(ys))
    heat = np.kron(pm, np.ones((stride, stride)))[:SIZE, :SIZE]
    nod_px = [((n[0] + 1) / 2 * SIZE, (n[1] + 1) / 2 * SIZE, n[3] * SIZE) for n in spec["nodules"]]
    det = {}
    for thr in (0.3, 0.5, 0.7, 0.9):
        m = pm >= thr
        lab, n = ndi.label(m)
        cents = ndi.center_of_mass(pm, lab, range(1, n + 1)) if n else []
        pts = [((c[1] * stride), (c[0] * stride), float(pm[lab == i + 1].max())) for i, c in enumerate(cents)]
        hit = [any(np.hypot(px - nx_, py - ny_) < 8 for (px, py, _) in pts) for (nx_, ny_, _) in nod_px]
        fp_ = sum(1 for (px, py, _) in pts if not any(np.hypot(px - nx_, py - ny_) < 8 for (nx_, ny_, _) in nod_px))
        det[str(thr)] = {"found": int(sum(hit)), "of": len(nod_px), "false_alarms": int(fp_), "detections": [[round(a, 1), round(b, 1), round(c, 3)] for a, b, c in pts]}
    rgb = to_rgb(u8).copy().astype(float)
    hm = np.clip(heat, 0, 1)[..., None]
    rgb = rgb * (1 - 0.55 * hm) + np.array([255, 60, 60]) * 0.55 * hm
    res["detect"] = {"img": save_png(rgb.astype(np.uint8), "t5/detect.png"), "base": save_png(u8, "t5/detect_base.png"), "stride": stride,
                     "nodules": [[round(a, 1), round(b, 1), round(c, 1)] for a, b, c in nod_px], "by_threshold": det,
                     "windows": int(len(wins))}
    res["seconds"] = round(time.time() - t0, 1)
    return res


def run():
    t0 = time.time()
    out = {"registration": registration(), "cnn": cnn()}
    print(f"  T5 done in {time.time() - t0:.0f}s")
    return out
