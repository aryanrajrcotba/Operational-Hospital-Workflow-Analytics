"""Synthetic chest-CT phantom used by T4-T6.

WaitData.Published.xlsx contains no images, so the biomedical-imaging topics run on a phantom generated
here.  It is *not* patient data and it is deliberately simple, but it has what those topics need:

* values in Hounsfield units (air -1000, lung ~ -850, fat -100, soft tissue ~45, bone 250-700),
* anatomy the algorithms can find (body, couch, lungs, heart, spine, ribs, sternum, trachea, vessels),
* nodules with known position / size / density, so segmentation and detection are scored against
  exact ground truth instead of eyeballed,
* a known acquisition model (blur + noise) so restoration can be scored against the clean image.

Geometry is analytic in normalised coordinates x, y, z in [-1, 1] (1 unit = 200 mm, field of view 400 mm;
x = left-right, y = anterior(-)/posterior(+), z = head(+)/foot(-)).  The same spec can be rendered at any
resolution, e.g. 256 x 256 for T4/T5 and 112 x 112 x 48 for the T6 volume.
"""
import numpy as np
from scipy.ndimage import gaussian_filter

MM_PER_UNIT = 200.0
SHOWCASE_SEED = 3
HU = dict(air=-1000.0, lung=-850.0, fat=-100.0, soft=45.0, blood=40.0, bone=380.0, cortical=700.0,
          couch=-550.0, csf=15.0)


def make_spec(seed: int, n_nodules=None, showcase: bool = False) -> dict:
    """Random anatomy + nodules.  showcase=True pins four well-separated nodules on the z = 0 plane."""
    rng = np.random.default_rng(seed)
    s = {
        "body": (0.80 * rng.uniform(.94, 1.06), 0.58 * rng.uniform(.94, 1.06)),
        "lung_c": 0.33 * rng.uniform(.95, 1.05), "lung_ab": (0.30 * rng.uniform(.93, 1.07), 0.38 * rng.uniform(.93, 1.07)),
        "heart": (0.17 + rng.normal(0, .01), -0.10 + rng.normal(0, .01)),
        "spine_y": 0.44 + rng.normal(0, .008), "rib_phase": rng.uniform(0, 6.28),
        "texture_seed": int(rng.integers(1 << 30)),
    }
    tubes = []                                   # (p0, p1, radius, hu)  -- vessels (bright) and airways (dark)
    tubes.append(((0, 0.05, 1.05), (0, 0.05, 0.38), 0.05, HU["air"]))                       # trachea
    for sgn in (-1, 1):
        tubes.append(((0, 0.05, 0.38), (sgn * 0.15, 0.04, 0.20), 0.032, HU["air"]))        # main bronchi
        tubes.append(((sgn * 0.15, 0.04, 0.20), (sgn * 0.25, 0.06, -0.15), 0.022, HU["air"]))
        for _ in range(9):                       # bronchovascular tree in the lung
            z0 = rng.uniform(-0.6, 0.6)
            p0 = np.array([sgn * 0.12, rng.uniform(-0.05, 0.10), z0])
            d = rng.normal(size=3); d[0] = abs(d[0]) * sgn; d /= np.linalg.norm(d)
            p1 = p0 + d * rng.uniform(0.30, 0.50)
            tubes.append((tuple(p0), tuple(p1), rng.uniform(.010, .020), HU["blood"]))
    for _ in range(70):                          # small peripheral vessels: hard negatives for a nodule detector
        sgn = rng.choice([-1, 1])
        p0 = np.array([sgn * rng.uniform(.10, .45), rng.uniform(-.25, .30), rng.uniform(-.8, .8)])
        d = rng.normal(size=3); d /= np.linalg.norm(d)
        tubes.append((tuple(p0), tuple(p0 + d * rng.uniform(.10, .30)), rng.uniform(.006, .012), HU["blood"]))
    s["tubes"] = tubes
    s["aorta"] = ((-0.02, 0.19, 0.07), (0.10, 0.30, 0.05))          # ascending / descending (x, y, r)

    nod = []
    if showcase:
        for (x, y, r, hu) in [(-0.42, -0.10, 0.038, 70), (0.36, 0.14, 0.030, 55), (-0.30, 0.20, 0.048, -420),
                              (0.47, -0.12, 0.024, 90)]:
            nod.append((x, y, 0.0, r, float(hu)))
    else:
        for _ in range(int(n_nodules if n_nodules is not None else rng.integers(2, 6))):
            for _try in range(50):
                sgn = rng.choice([-1, 1])
                x, y, z = sgn * s["lung_c"] + rng.uniform(-.2, .2), rng.uniform(-.28, .30), rng.uniform(-.55, .55)
                r = rng.uniform(0.026, 0.05)
                if _in_lung(s, x, y, z, margin=r + 0.03):
                    solid = rng.random() < 0.65
                    hu = rng.normal(70, 30) if solid else rng.normal(-430, 60)
                    nod.append((float(x), float(y), float(z), float(r), float(hu)))
                    break
    s["nodules"] = nod
    return s


def _lung_scale(z):
    return np.sqrt(np.clip(1 - (z / 1.0) ** 2, 0, 1))


def _in_lung(s, x, y, z, margin=0.0):
    a, b = s["lung_ab"]
    sc = _lung_scale(z)
    for sgn in (-1, 1):
        u = (x - sgn * s["lung_c"]) / (a * sc + 1e-9)
        v = (y + 0.02) / (b * sc + 1e-9)
        if np.hypot(u, v) <= 1 - margin / min(a * sc, b * sc):
            hx, hy = s["heart"]
            if ((x - hx) / 0.25) ** 2 + ((y - hy) / 0.23) ** 2 > 1:
                return True
    return False


def _seg_dist(X, Y, Z, p0, p1):
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    t = ((X - p0[0]) * d[0] + (Y - p0[1]) * d[1] + (Z - p0[2]) * d[2]) / (d @ d)
    t = np.clip(t, 0, 1)
    return np.sqrt((X - (p0[0] + t * d[0])) ** 2 + (Y - (p0[1] + t * d[1])) ** 2 + (Z - (p0[2] + t * d[2])) ** 2)


def render(spec: dict, zs, ny: int, nx: int) -> dict:
    """Ideal (noise-free, un-blurred) HU volume + ground-truth masks. Returns arrays shaped (len(zs), ny, nx)."""
    zs = np.atleast_1d(np.asarray(zs, float))
    x = (np.arange(nx) + 0.5) / nx * 2 - 1
    y = (np.arange(ny) + 0.5) / ny * 2 - 1
    Z, Y, X = np.meshgrid(zs, y, x, indexing="ij")
    hu = np.full(X.shape, HU["air"], np.float32)

    bx, by = spec["body"]
    taper = 1 - 0.04 * Z ** 2
    rb = np.hypot(X / (bx * taper), Y / (by * taper))
    body = rb <= 1
    hu[body] = HU["soft"]
    hu[body & (rb > 0.86)] = HU["fat"]                                   # subcutaneous fat layer
    # couch under the patient
    couch = (np.abs(X) < 0.55) & (Y > by + 0.02) & (Y < by + 0.07) & ~body
    hu[couch] = HU["couch"]

    # lungs
    a, b = spec["lung_ab"]
    sc = _lung_scale(Z)
    lung = np.zeros(X.shape, bool)
    for sgn in (-1, 1):
        lung |= np.hypot((X - sgn * spec["lung_c"]) / (a * sc + 1e-9), (Y + 0.02) / (b * sc + 1e-9)) <= 1
    hx, hy = spec["heart"]
    heart = (((X - hx) / 0.25) ** 2 + ((Y - hy) / 0.23) ** 2 + ((Z + 0.42) / 0.55) ** 2) <= 1
    lung &= ~heart
    hu[lung] = HU["lung"]
    hu[heart] = HU["blood"] + 5

    # great vessels
    for (ax, ay, ar) in spec["aorta"]:
        hu[(np.hypot(X - ax, Y - ay) <= ar) & body] = HU["blood"] + 5

    # spine: cortical shell, cancellous core, discs, canal, spinous process
    sy = spec["spine_y"]
    v = ((X / 0.09) ** 2 + ((Y - sy) / 0.075) ** 2)
    vert = v <= 1
    hu[vert] = HU["cortical"]
    core = v <= 0.72
    disc = (np.mod(Z + 1.0, 0.28) < 0.05)
    hu[core & ~disc] = 260.0
    hu[core & disc] = 90.0
    hu[(np.hypot(X, Y - (sy - 0.10)) <= 0.035)] = HU["csf"]
    hu[((X / 0.02) ** 2 + ((Y - (sy + 0.11)) / 0.06) ** 2 <= 1) & body] = HU["cortical"]

    # ribs: slanted arcs on the thoracic wall + sternum
    u, w = X / 0.66, Y / 0.48
    rho, th = np.hypot(u, w), np.arctan2(w, u)
    ribs = (np.abs(rho - 1) < 0.06) & (np.cos(14 * (th + 0.6 * Z) + spec["rib_phase"]) > 0.80) & (Y < sy - 0.05)
    hu[ribs & body] = 420.0
    hu[(((X / 0.075) ** 2 + ((Y + 0.52) / 0.028) ** 2) <= 1) & body] = 330.0

    # airways / vessels inside the lungs
    nodule = np.zeros(X.shape, bool)
    for (p0, p1, rad, val) in spec["tubes"]:
        if zs.max() < min(p0[2], p1[2]) - rad or zs.min() > max(p0[2], p1[2]) + rad:
            continue                                            # tube does not reach these slices
        d = _seg_dist(X, Y, Z, p0, p1)
        m = d <= rad
        if val == HU["air"]:
            hu[m & body] = HU["air"]
        else:
            hu[m & lung] = val
    # nodules last so they are never hidden
    for (nx_, ny_, nz_, r_, v_) in spec["nodules"]:
        m = ((X - nx_) ** 2 + (Y - ny_) ** 2 + (Z - nz_) ** 2) <= r_ ** 2
        hu[m] = v_
        nodule |= m

    lung_field = lung | nodule
    return {"hu": hu, "lung": lung_field, "nodule": nodule, "body": body,
            "bone": (hu > 200) & body, "spec": spec}


def acquire(ideal_hu, seed: int, blur=0.9, noise=40.0, blur_z=None):
    """Ideal HU -> what a scanner would give: point-spread blur + spatially correlated Gaussian noise."""
    rng = np.random.default_rng(seed)
    sig = blur if ideal_hu.ndim == 2 else ((blur_z or 0), blur, blur)
    img = gaussian_filter(ideal_hu, sig) if blur > 0 else ideal_hu.copy()
    n = gaussian_filter(rng.normal(size=ideal_hu.shape), (0, 0.6, 0.6) if ideal_hu.ndim == 3 else 0.6)
    n /= n.std() + 1e-9
    return np.clip(img + noise * n, -1024, 3071).astype(np.float32)


def window(hu, level, width):
    lo = level - width / 2
    return (np.clip((hu - lo) / width, 0, 1) * 255 + 0.5).astype(np.uint8)


WINDOWS = {"Lung": (-600, 1500), "Soft tissue": (40, 400), "Bone": (400, 1800), "Full range": (0, 4095)}
