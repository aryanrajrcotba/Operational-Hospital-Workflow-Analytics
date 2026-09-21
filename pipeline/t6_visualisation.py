"""T6 - Biomedical image visualisation.

Produces what the interactive viewer in the T6 tab needs:

* a small CT-like volume (48 x 112 x 112, int16 HU) with a label volume (lung / nodule / bone), gzip + base64,
  written to frontend/data/t6_volume.js and loaded only when the tab is opened,
* the HU histogram (why windowing exists),
* colormap look-up tables with a perceptual analysis (CIELAB lightness along each map), so the advice
  "avoid rainbow" is measured rather than asserted.

Everything is synthetic (pipeline/phantom.py); the viewer itself does the rendering in the browser.
"""
import base64
import gzip

import numpy as np
from skimage import color

from . import phantom as P
from .config import FRONTEND_DATA
from .utils import r

SHAPE = (48, 112, 112)
Z_RANGE = (-0.6, 0.6)
VOL_SEED = 11
# (x, y, z, radius, HU) in phantom units; larger than the T4/T5 nodules so they survive 3.6 mm voxels
NODULES = [(-0.42, -0.05, 0.25, 0.060, 80.0), (0.38, 0.12, -0.20, 0.050, 60.0), (-0.28, 0.18, -0.05, 0.070, -420.0),
           (0.45, -0.10, 0.35, 0.045, 95.0), (0.30, 0.20, 0.05, 0.040, 50.0), (-0.45, 0.10, -0.38, 0.050, 70.0)]
MAPS = [("gray", "Grayscale"), ("hot", "Hot (black-red-yellow-white)"), ("viridis", "Viridis"), ("magma", "Magma"), ("jet", "Rainbow (jet)")]
HIST = dict(lo=-1050, hi=1050, step=25)


def _volume():
    spec = P.make_spec(VOL_SEED, n_nodules=0)
    spec["nodules"] = list(NODULES)
    zs = np.linspace(*Z_RANGE, SHAPE[0])
    for (x, y, z, rad, _) in NODULES:                                       # sanity: every nodule sits inside a lung
        assert P._in_lung(spec, x, y, z, margin=rad), f"nodule at {(x, y, z)} is not inside the lung"
    ideal = P.render(spec, zs, SHAPE[1], SHAPE[2])
    hu = P.acquire(ideal["hu"], 42, blur=0.7, noise=25.0, blur_z=0.6)
    lab = np.zeros(SHAPE, np.uint8)
    lab[ideal["bone"]] = 3
    lab[ideal["lung"]] = 1
    lab[ideal["nodule"]] = 2
    return spec, zs, np.round(hu).astype(np.int16), lab


def _colormaps():
    import matplotlib
    out = []
    for key, name in MAPS:
        cm = matplotlib.colormaps[key]
        lut = (cm(np.linspace(0, 1, 256))[:, :3] * 255 + 0.5).astype(np.uint8)
        lab = color.rgb2lab(lut[None].astype(float) / 255.0)[0]
        L = lab[:, 0]
        de = np.linalg.norm(np.diff(lab, axis=0), axis=1)                    # CIE76 step size between neighbouring entries
        grey = (0.299 * lut[:, 0] + 0.587 * lut[:, 1] + 0.114 * lut[:, 2])
        out.append({"id": key, "name": name, "stops": lut[::8].tolist() + [lut[-1].tolist()],
                    "lightness": [round(float(v), 1) for v in L[::4]],
                    "monotonic_lightness": bool(np.all(np.diff(L) >= -0.5)),
                    "lightness_range": [round(float(L.min()), 1), round(float(L.max()), 1)],
                    "step_cv": round(float(de.std() / de.mean()), 3),          # 0 = perfectly even steps
                    "reversals": int((np.diff(np.sign(np.diff(L[::4]))) != 0).sum()),
                    "greyscale_print": [int(v) for v in grey[::32]]})
    return out


def run():
    spec, zs, hu, lab = _volume()
    nz, ny, nx = SHAPE
    mm_xy = P.MM_PER_UNIT * 2 / nx
    mm_z = (zs[1] - zs[0]) * P.MM_PER_UNIT

    edges = np.arange(HIST["lo"], HIST["hi"] + HIST["step"], HIST["step"])
    body = lab >= 0
    counts = np.histogram(np.clip(hu, HIST["lo"], HIST["hi"] - 1), bins=edges)[0]
    by_label = {}
    for k, name in ((1, "lung"), (2, "nodule"), (3, "bone")):
        v = hu[lab == k]
        by_label[name] = {"voxels": int(v.size), "share": r(v.size / hu.size * 100, 1), "mean": r(v.mean(), 0), "sd": r(v.std(), 0),
                          "hist": np.histogram(np.clip(v, HIST["lo"], HIST["hi"] - 1), bins=edges)[0].astype(int).tolist()}

    payload = {
        "shape": list(SHAPE), "spacing_mm": [round(mm_z, 2), round(mm_xy, 2), round(mm_xy, 2)],
        "hist": {**HIST, "counts": counts.astype(int).tolist()}, "by_label": by_label,
        "nodules": [{"id": i + 1, "x": int(round((x + 1) / 2 * nx - 0.5)), "y": int(round((y + 1) / 2 * ny - 0.5)),
                     "z": int(round((z - Z_RANGE[0]) / (Z_RANGE[1] - Z_RANGE[0]) * (nz - 1))),
                     "diam_mm": round(rad * 2 * P.MM_PER_UNIT, 1), "hu": h, "type": "ground-glass" if h < -200 else "solid"}
                    for i, (x, y, z, rad, h) in enumerate(NODULES)],
        "colormaps": _colormaps(),
        "windows": [{"name": k, "level": v[0], "width": v[1]} for k, v in P.WINDOWS.items()],
        "noise_hu": 25.0, "voxels": int(hu.size),
    }

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    blob = lambda a: base64.b64encode(gzip.compress(np.ascontiguousarray(a).tobytes(), 9)).decode()
    js = ("window.VOLUME = " + '{"shape":%s,"hu":"%s","labels":"%s"};\n' % (list(SHAPE), blob(hu.astype("<i2")), blob(lab)))
    (FRONTEND_DATA / "t6_volume.js").write_text(js)
    payload["volume_file_kb"] = round(len(js) / 1024)
    print(f"  T6 volume {len(js) / 1e6:.2f} MB (gzip+base64)")
    return payload
