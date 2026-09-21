"""T4 - Biomedical image processing: enhancement, restoration, segmentation, compression.

Runs on the synthetic CT phantom (pipeline/phantom.py).  Because the anatomy is generated, every method is
scored against exact ground truth: the clean image for enhancement / restoration, the true masks for
segmentation, the original pixels for compression.  Parameters of restoration methods are tuned on the same
image they are scored on ("oracle tuned"), which flatters every method equally; the ranking, not the absolute
PSNR, is what to read.
"""
import io
import lzma
import re
import time
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.fft import dctn, idctn
from skimage import exposure, filters, measure, morphology, segmentation
from skimage import restoration as skr
from skimage.metrics import structural_similarity
from sklearn.cluster import KMeans

from . import phantom as P
from .imaging_utils import contour_overlay, crop_zoom, dice, iou, psnr, save_png

SIZE = 256
DR = 2000.0                     # HU data range used for PSNR / SSIM (about air-to-bone-edge of the display window)
VIEW = (-300, 1400)             # display window (level, width) used for all T4 pictures
NOISE_DENOISE, NOISE_DEBLUR, PSF_SIGMA = 90.0, 15.0, 2.0
CROP = (150, 40, 64)            # y0, x0, size of the zoom crop (contains the left-lung nodule at ~(115, 70))


def _slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _view(hu):
    return P.window(hu, *VIEW)


def _norm(hu):                  # HU -> [0, 1] over the 12-bit CT range
    return np.clip((hu + 1024.0) / 4095.0, 0, 1)


def _denorm(x):
    return x * 4095.0 - 1024.0


def _entropy(u8):
    return float(measure.shannon_entropy(u8))


def _hist(u8, bins=64):
    return np.histogram(u8, bins=bins, range=(0, 256))[0].astype(int).tolist()


def _context():
    spec = P.make_spec(P.SHOWCASE_SEED, showcase=True)
    t = P.render(spec, [0.0], SIZE, SIZE)
    t = {k: (v[0] if isinstance(v, np.ndarray) else v) for k, v in t.items()}
    ideal = t["hu"]
    clean = P.acquire(ideal, 0, blur=0.6, noise=0.0)
    # ROIs, eroded so they never touch an edge
    nod = t["nodule"]
    lab, n = ndi.label(nod)
    nod_rois = [ndi.binary_erosion(lab == i, iterations=1) for i in range(1, n + 1)]
    lung_bg = ndi.binary_erosion(np.isclose(ideal, P.HU["lung"]), iterations=4)
    fat = ndi.binary_erosion(np.isclose(ideal, P.HU["fat"]), iterations=2)
    musc = ndi.binary_erosion(np.isclose(ideal, P.HU["soft"]) & t["body"], iterations=6)
    return {"t": t, "ideal": ideal, "clean": clean, "nod_rois": nod_rois, "lung_bg": lung_bg, "fat": fat, "musc": musc}


def _contrast(img, a, b):
    return float(abs(img[a].mean() - img[b].mean()))


def _cnr(img, a, b, noise_roi):
    """Contrast-to-noise: gray-level contrast between two regions over the noise (sd) in flat soft tissue.
    Noise is read from soft tissue, not lung, because narrow windows clip the lung to a flat black."""
    return _contrast(img, a, b) / (float(img[noise_roi].std()) + 1e-9)


# ------------------------------------------------------------------ 4.1 enhancement
def enhancement(cx, acq):
    lin = np.clip((acq + 1024) / 2524.0, 0, 1)                    # naive full-range linear map -> dull picture
    p1, p99 = np.percentile(lin, (1, 99))
    variants = [
        ("linear", "Full-range linear (baseline)", "baseline", lambda: lin),
        ("lung", "Lung window (L -600, W 1500)", "HU window", lambda: P.window(acq, -600, 1500) / 255.0),
        ("soft", "Soft-tissue window (L 40, W 400)", "HU window", lambda: P.window(acq, 40, 400) / 255.0),
        ("bone", "Bone window (L 400, W 1800)", "HU window", lambda: P.window(acq, 400, 1800) / 255.0),
        ("stretch", "Contrast stretch (1-99 %)", "generic", lambda: exposure.rescale_intensity(lin, in_range=(p1, p99), out_range=(0, 1))),
        ("gamma", "Gamma 0.5", "generic", lambda: lin ** 0.5),
        ("heq", "Histogram equalisation", "generic", lambda: exposure.equalize_hist(lin)),
        ("clahe", "CLAHE (clip 0.02)", "generic", lambda: exposure.equalize_adapthist(lin, kernel_size=32, clip_limit=0.02)),
        ("unsharp", "Unsharp mask (r 2, x 1.5)", "generic", lambda: np.clip(filters.unsharp_mask(lin, radius=2, amount=1.5), 0, 1)),
    ]
    rows = []
    for key, name, group, fn in variants:
        u8 = (np.clip(fn(), 0, 1) * 255 + 0.5).astype(np.uint8)
        f = u8.astype(float)
        nod = float(np.mean([_cnr(f, m, cx["lung_bg"], cx["musc"]) for m in cx["nod_rois"]]))
        rows.append({"id": key, "name": name, "group": group, "img": save_png(u8, f"t4/enh_{key}.png"),
                     "entropy": round(_entropy(u8), 2), "std": round(float(f[cx["t"]["body"]].std()), 1),
                     "cnr_nodule": round(nod, 1), "cnr_fat": round(_cnr(f, cx["fat"], cx["musc"], cx["musc"]), 1),
                     "contrast_nodule": round(float(np.mean([_contrast(f, m, cx["lung_bg"]) for m in cx["nod_rois"]])), 1),
                     "contrast_fat": round(_contrast(f, cx["fat"], cx["musc"]), 1),
                     "noise": round(float(f[cx["musc"]].std()), 1), "hist": _hist(u8)})
    return rows


# ------------------------------------------------------------------ 4.2 restoration
def _score(cx, out):
    return {"psnr": round(psnr(cx["clean"], out, DR), 2),
            "ssim": round(float(structural_similarity(cx["clean"], out, data_range=DR)), 4)}


def _panel(hu):
    v = _view(hu)
    return np.hstack([v, crop_zoom(v, *CROP, 4)])


def _best(cx, cands):
    """cands: list of (label, image) -> the (label, image, scores) with the highest PSNR."""
    scored = [(lab, img, _score(cx, img)) for lab, img in cands]
    return max(scored, key=lambda s: s[2]["psnr"])


def restoration(cx):
    ideal, clean = cx["ideal"], cx["clean"]
    out = {"psnr_range_hu": DR}

    # A) noise only
    noisy = P.acquire(ideal, 21, blur=0.6, noise=NOISE_DENOISE)
    x, sn = _norm(noisy), NOISE_DENOISE / 4095.0
    methods = {
        "Gaussian blur": [(f"σ = {s}", _denorm(filters.gaussian(x, s))) for s in (0.7, 1.0, 1.4, 1.8, 2.4)],
        "Median": [(f"{k} × {k}", _denorm(ndi.median_filter(x, size=k))) for k in (3, 5, 7)],
        "Bilateral": [(f"colour {c}, space {sp}", _denorm(skr.denoise_bilateral(x, sigma_color=c, sigma_spatial=sp)))
                      for c in (0.03, 0.05, 0.08) for sp in (2, 3)],
        "Non-local means": [(f"h = {m}σ", _denorm(skr.denoise_nl_means(x, patch_size=5, patch_distance=6, h=m * sn, sigma=sn, fast_mode=True)))
                            for m in (0.6, 0.9, 1.2)],
        "Total variation": [(f"weight {w}", _denorm(skr.denoise_tv_chambolle(x, weight=w))) for w in (0.01, 0.02, 0.03, 0.045, 0.07)],
    }
    rows = [{"name": "Noisy input", "param": f"σ = {NOISE_DENOISE:g} HU", "img": save_png(_panel(noisy), "t4/den_input.png"), **_score(cx, noisy)}]
    best_by = {}
    for name, cands in methods.items():
        lab, img, sc = _best(cx, cands)
        best_by[name] = img
        rows.append({"name": name, "param": lab, "img": save_png(_panel(img), f"t4/den_{_slug(name)}.png"), **sc})
    out["denoise"] = {"noise_hu": NOISE_DENOISE, "rows": rows,
                      "clean_img": save_png(_panel(clean), "t4/den_clean.png")}
    out["best_denoised"] = max(rows[1:], key=lambda r: r["psnr"])["name"]
    out["_denoised_hu"] = best_by[out["best_denoised"]]

    # B) blur + noise
    psf = np.zeros((25, 25)); psf[12, 12] = 1
    psf = ndi.gaussian_filter(psf, PSF_SIGMA); psf /= psf.sum()
    blurred = np.clip(ndi.gaussian_filter(ideal, PSF_SIGMA) + np.random.default_rng(5).normal(0, NOISE_DEBLUR, ideal.shape), -1024, 3071)
    xb = _norm(blurred)
    deb = {
        "Unsharp mask": [(f"radius {r}, amount {a}", _denorm(np.clip(filters.unsharp_mask(xb, radius=r, amount=a), 0, 1))) for r in (2, 3) for a in (0.5, 1, 2, 4)],
        "Wiener deconvolution": [(f"balance {b:g}", _denorm(np.clip(skr.wiener(xb, psf, b), 0, 1))) for b in (0.002, 0.005, 0.01, 0.03, 0.1)],
        "Richardson–Lucy": [(f"{n} iterations", _denorm(np.clip(skr.richardson_lucy(xb, psf, num_iter=n), 0, 1))) for n in (5, 10, 20, 40, 80)],
    }
    rows = [{"name": "Blurred + noisy input", "param": f"PSF σ = {PSF_SIGMA:g} px, noise {NOISE_DEBLUR:g} HU",
             "img": save_png(_panel(blurred), "t4/deb_input.png"), **_score(cx, blurred)}]
    for name, cands in deb.items():
        lab, img, sc = _best(cx, cands)
        rows.append({"name": name, "param": lab, "img": save_png(_panel(img), f"t4/deb_{_slug(name)}.png"), **sc})
    out["deblur"] = {"psf_sigma": PSF_SIGMA, "noise_hu": NOISE_DEBLUR, "rows": rows}

    # noise-vs-smoothing trade-off curve for the Gaussian filter (why "just blur it" is a trade-off)
    sweep = []
    for s in (0.3, 0.5, 0.7, 1.0, 1.4, 1.8, 2.4, 3.0):
        g = _denorm(filters.gaussian(x, s))
        sweep.append({"sigma": s, **_score(cx, g)})
    out["gaussian_sweep"] = sweep
    return out


# ------------------------------------------------------------------ 4.3 segmentation
def _body(hu):
    m = hu > -500
    m = morphology.binary_opening(m, morphology.disk(3))
    lab = measure.label(m)
    if lab.max() == 0:
        return m
    big = np.argmax(np.bincount(lab.ravel())[1:]) + 1
    return ndi.binary_fill_holes(lab == big)


def _lung_methods(hu, body):
    out = {}
    out["Fixed threshold (−400 HU)"] = (hu < -400) & body
    t = filters.threshold_otsu(hu[body])
    out["Otsu (inside body)"] = (hu < t) & body
    km = KMeans(n_clusters=3, n_init=4, random_state=0).fit(hu[body].reshape(-1, 1))
    lung_c = int(np.argmin(km.cluster_centers_.ravel()))
    m = np.zeros_like(body); m[body] = km.labels_ == lung_c
    out["K-means (k = 3)"] = m
    sm = ndi.gaussian_filter(hu, 1.0)
    grown = np.zeros_like(body)
    for cx_ in (int(SIZE * 0.31), int(SIZE * 0.69)):
        seed = (int(SIZE * 0.5), cx_)
        grown |= segmentation.flood(sm, seed, tolerance=250) & body
    out["Region growing (2 seeds)"] = grown
    grad = filters.sobel(sm)
    markers = np.zeros(hu.shape, int)
    markers[ndi.binary_erosion(sm < -700, iterations=3) & body] = 1
    markers[ndi.binary_erosion(sm > -100, iterations=2) & body] = 2
    markers[~body] = 3
    out["Watershed (marker-based)"] = segmentation.watershed(grad, markers) == 1
    m = (hu < -400) & body
    m = morphology.binary_opening(m, morphology.disk(1))
    m = morphology.remove_small_objects(m, 50)
    m = ndi.binary_fill_holes(m)
    out["Threshold + morphology"] = morphology.binary_closing(m, morphology.disk(2))
    return out


def _nodule_candidates(hu, lung):
    cand = (hu > -650) & ndi.binary_erosion(lung, iterations=1)
    cand = morphology.binary_opening(cand, morphology.disk(1))
    lab = measure.label(cand)
    keep = np.zeros_like(cand)
    for rp in measure.regionprops(lab):
        if 8 <= rp.area <= 260 and rp.eccentricity < 0.9:
            keep[lab == rp.label] = True
    return keep


def _detect(pred, gt):
    gl, gn = ndi.label(gt)
    pl, pn = ndi.label(pred)
    hit = sum(1 for i in range(1, gn + 1) if (pred & (gl == i)).sum() >= 0.3 * (gl == i).sum())
    fp = sum(1 for j in range(1, pn + 1) if not (gt & (pl == j)).any())
    return {"true_nodules": gn, "found": hit, "false_blobs": fp}


def segmentation_task(cx, acq, denoised):
    t = cx["t"]
    body = _body(acq)
    view = _view(acq)
    gt_lung, gt_nod, gt_body = t["lung"], t["nodule"], t["body"]
    res = {"body_dice": round(dice(body, gt_body), 4), "lung_rows": []}
    green, red = (40, 220, 90), (235, 60, 60)
    for name, m in _lung_methods(acq, body).items():
        res["lung_rows"].append({"name": name, "dice": round(dice(m, gt_lung), 4), "iou": round(iou(m, gt_lung), 4),
                                 "img": save_png(contour_overlay(view, [(gt_lung, green), (m, red)]), f"t4/seg_lung_{len(res['lung_rows'])}.png")})
    best = max(res["lung_rows"], key=lambda r: r["dice"])["name"]
    lung_best = _lung_methods(acq, body)[best]
    res["best_lung"] = best
    res["truth_img"] = save_png(contour_overlay(view, [(gt_lung, green), (gt_nod, (255, 200, 40))]), "t4/seg_truth.png")

    res["nodule_rows"] = []
    for name, src in (("Noisy image", acq), ("After denoising", denoised)):
        pred = _nodule_candidates(src, lung_best)
        d = _detect(pred, gt_nod)
        res["nodule_rows"].append({"name": name, "dice": round(dice(pred, gt_nod), 3),
                                   "precision": round(float((pred & gt_nod).sum() / max(pred.sum(), 1)), 3),
                                   "recall": round(float((pred & gt_nod).sum() / gt_nod.sum()), 3), **d,
                                   "img": save_png(contour_overlay(view, [(gt_nod, green), (pred, red)]), f"t4/seg_nod_{len(res['nodule_rows'])}.png")})
    res["legend"] = {"green": "ground truth", "red": "method output"}
    return res


# ------------------------------------------------------------------ 4.4 compression
def _rle_bytes(a):
    flat = a.ravel()
    change = np.flatnonzero(np.diff(flat)) + 1
    runs = len(change) + 1
    return runs * 3, runs                                   # 2-byte value + 1-byte count (counts > 255 split; rare here)


def _entropy_bits(v):
    _, c = np.unique(v, return_counts=True)
    p = c / c.sum()
    return float(-(p * np.log2(p)).sum())


def _med_residual(a):
    """LOCO-I / JPEG-LS median edge detector prediction residual (the predictor behind PNG-like and JPEG-LS coders)."""
    a = a.astype(np.int32)
    P_ = np.zeros_like(a)
    A = np.zeros_like(a); B = np.zeros_like(a); C = np.zeros_like(a)
    A[:, 1:] = a[:, :-1]; B[1:, :] = a[:-1, :]; C[1:, 1:] = a[:-1, :-1]
    mx, mn = np.maximum(A, B), np.minimum(A, B)
    P_ = np.where(C >= mx, mn, np.where(C <= mn, mx, A + B - C))
    return a - P_


def compression(cx, acq):
    ideal_clean = P.acquire(cx["ideal"], 0, blur=0.9, noise=0.0)
    res = {"rows_lossless": [], "lossy": {}}

    def lossless(img_hu):
        u16 = np.clip(img_hu + 1024, 0, 4095).round().astype(np.uint16)         # 12-bit CT stored in 16-bit words
        raw = u16.tobytes()
        rows = []

        def add(name, nbytes, note=""):
            rows.append({"name": name, "bytes": int(nbytes), "ratio": round(len(raw) / nbytes, 2), "bpp": round(8 * nbytes / u16.size, 2), "note": note})

        add("Raw 16-bit words", len(raw), "what a PACS would store uncompressed")
        b, runs = _rle_bytes(u16)
        add("Run-length coding", b, f"{runs:,} runs for {u16.size:,} pixels: noise breaks every run")
        add("Entropy bound, pixel values", _entropy_bits(u16.ravel()) * u16.size / 8, "best any per-pixel code could do (order 0)")
        res_ = _med_residual(u16)
        add("Entropy bound, prediction residual", _entropy_bits(res_.ravel()) * u16.size / 8, "predict each pixel from neighbours, code the error")
        z = zlib.compress(raw, 9); assert zlib.decompress(z) == raw
        add("Deflate (zlib -9)", len(z), "general-purpose byte compressor")
        x = lzma.compress(raw, preset=9); assert lzma.decompress(x) == raw
        add("LZMA", len(x), "stronger general-purpose compressor")
        bio = io.BytesIO(); Image.fromarray(u16).save(bio, format="PNG", optimize=True)
        assert np.array_equal(np.array(Image.open(io.BytesIO(bio.getvalue()))), u16)
        add("PNG 16-bit", len(bio.getvalue()), "row predictors + deflate")
        return rows, u16

    rows, u16 = lossless(acq)
    res["rows_lossless"] = rows
    rows_clean, _ = lossless(ideal_clean)
    res["lossless_noise_free"] = {r["name"]: r["ratio"] for r in rows_clean}
    res["noise_hu"] = 40.0
    res["pixels"] = int(u16.size)

    # ---- lossy: display-window 8-bit image (what a viewer shows; standard JPEG is 8-bit)
    src = _view(acq)
    raw8 = src.size
    orig = src.astype(np.float64)
    nod_rois, lung_bg = cx["nod_rois"], cx["lung_bg"]
    base_cnr = np.mean([_cnr(orig, m, lung_bg, cx["musc"]) for m in nod_rois])

    def eval_lossy(decoded, nbytes):
        d = decoded.astype(np.float64)
        return {"bytes": int(nbytes), "ratio": round(raw8 / nbytes, 1), "psnr": round(psnr(orig, d, 255), 2),
                "ssim": round(float(structural_similarity(orig, d, data_range=255)), 4),
                "cnr_kept": round(float(np.mean([_cnr(d, m, lung_bg, cx["musc"]) for m in nod_rois]) / base_cnr * 100), 1)}

    jpeg, j2k, decs = [], [], {}
    for q in (95, 85, 75, 60, 45, 30, 20, 12, 8, 4, 2):
        bio = io.BytesIO(); Image.fromarray(src).save(bio, format="JPEG", quality=q)
        dec = np.array(Image.open(io.BytesIO(bio.getvalue())))
        jpeg.append({"q": q, **eval_lossy(dec, len(bio.getvalue()))}); decs[("jpeg", q)] = dec
    for rate in (4, 8, 16, 24, 32, 48, 64, 96, 128, 192):
        bio = io.BytesIO(); Image.fromarray(src).save(bio, format="JPEG2000", quality_mode="rates", quality_layers=[rate], irreversible=True)
        dec = np.array(Image.open(io.BytesIO(bio.getvalue())))
        j2k.append({"target": rate, **eval_lossy(dec, len(bio.getvalue()))}); decs[("j2k", rate)] = dec
    res["lossy"] = {"raw_bytes_8bit": raw8, "jpeg": jpeg, "j2k": j2k}

    # picture comparison at a matched ~40:1 ratio
    def closest(rows, key):
        return min(rows, key=lambda r: abs(np.log(r["ratio"] / 40)))
    jr, kr = closest(jpeg, "q"), closest(j2k, "target")
    y0, x0, s = CROP
    panels = [("Original", src), (f"JPEG · {jr['ratio']:g}:1", decs[("jpeg", jr["q"])]), (f"JPEG 2000 · {kr['ratio']:g}:1", decs[("j2k", kr["target"])])]
    res["compare"] = {"panels": [{"name": n, "img": save_png(crop_zoom(a, y0, x0, s, 4), f"t4/cmp_{i}.png")} for i, (n, a) in enumerate(panels)],
                      "jpeg": jr, "j2k": kr}

    # ---- why transform coding works: 8x8 DCT energy compaction, and quality vs coefficients kept
    h, w = (src.shape[0] // 8) * 8, (src.shape[1] // 8) * 8
    blocks = (src[:h, :w].astype(np.float64) - 128).reshape(h // 8, 8, w // 8, 8).transpose(0, 2, 1, 3)
    D = dctn(blocks, axes=(2, 3), norm="ortho")
    zz = sorted(((i, j) for i in range(8) for j in range(8)), key=lambda p: (p[0] + p[1], p[1] if (p[0] + p[1]) % 2 else p[0]))
    energy = np.array([(D[:, :, i, j] ** 2).sum() for i, j in zz])
    cum = np.cumsum(energy) / energy.sum()
    curve = []
    for k in (1, 2, 3, 6, 10, 15, 21, 28, 36, 45, 55, 64):
        Dk = np.zeros_like(D)
        for (i, j) in zz[:k]:
            Dk[:, :, i, j] = D[:, :, i, j]
        rec = idctn(Dk, axes=(2, 3), norm="ortho").transpose(0, 2, 1, 3).reshape(h, w) + 128
        p = psnr(src[:h, :w], np.clip(rec, 0, 255), 255)
        curve.append({"k": k, "energy": round(float(cum[k - 1]) * 100, 2), "psnr": round(p, 2) if p < 100 else None})
    res["dct"] = curve
    return res


# ------------------------------------------------------------------ entry point
def run():
    t0 = time.time()
    cx = _context()
    acq = P.acquire(cx["ideal"], 7, blur=0.9, noise=40.0)
    out = {"phantom": {"size": SIZE, "mm_per_px": round(P.MM_PER_UNIT * 2 / SIZE, 2), "nodules": [
        {"x_mm": round(n[0] * P.MM_PER_UNIT), "y_mm": round(n[1] * P.MM_PER_UNIT), "diam_mm": round(n[3] * 2 * P.MM_PER_UNIT, 1), "hu": n[4]}
        for n in cx["t"]["spec"]["nodules"]], "noise_hu": 40.0, "blur_px": 0.9}}
    out["images"] = {"clean": save_png(_view(cx["clean"]), "t4/view_clean.png"), "acquired": save_png(_view(acq), "t4/view_acquired.png")}
    out["view_window"] = {"level": VIEW[0], "width": VIEW[1]}
    out["enhance"] = enhancement(cx, acq)
    rest = restoration(cx)
    denoised = rest.pop("_denoised_hu")
    out["restore"] = rest
    out["segment"] = segmentation_task(cx, acq, denoised)
    out["compress"] = compression(cx, acq)
    print(f"  T4 done in {time.time() - t0:.0f}s")
    return out
