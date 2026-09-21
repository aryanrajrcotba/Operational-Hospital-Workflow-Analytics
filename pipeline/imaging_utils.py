"""Small helpers shared by the imaging topics (T4-T6)."""
import numpy as np
from PIL import Image
from skimage.segmentation import find_boundaries

from .config import FRONTEND_ASSETS


def save_png(arr, rel_path):
    """arr: uint8 (H, W) or (H, W, 3). Returns the path relative to frontend/ (what the page uses)."""
    p = FRONTEND_ASSETS / rel_path
    p.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.ascontiguousarray(arr)).save(p, optimize=True)
    return f"assets/{rel_path}"


def to_rgb(g):
    return np.stack([g, g, g], -1)


def contour_overlay(gray_u8, masks_colors):
    """Draw 1-px mask outlines (list of (mask, (r, g, b))) on a gray image; returns RGB uint8."""
    rgb = to_rgb(gray_u8).copy()
    for m, c in masks_colors:
        rgb[find_boundaries(m, mode="inner")] = c
    return rgb


def crop_zoom(img, y0, x0, size, factor):
    c = img[y0:y0 + size, x0:x0 + size]
    return np.kron(c, np.ones((factor, factor) + (1,) * (c.ndim - 2), dtype=c.dtype))


def dice(a, b):
    a, b = a.astype(bool), b.astype(bool)
    s = a.sum() + b.sum()
    return 1.0 if s == 0 else float(2 * (a & b).sum() / s)


def iou(a, b):
    a, b = a.astype(bool), b.astype(bool)
    u = (a | b).sum()
    return 1.0 if u == 0 else float((a & b).sum() / u)


def psnr(ref, x, data_range):
    mse = float(np.mean((ref.astype(np.float64) - x.astype(np.float64)) ** 2))
    return float("inf") if mse == 0 else float(20 * np.log10(data_range / np.sqrt(mse)))
