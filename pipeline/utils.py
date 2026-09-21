import json
import numpy as np
import pandas as pd


def hist(values, lo, hi, step):
    """Return {edges:[lo..hi], counts:[...]} with values clipped into the last bin."""
    v = np.asarray(values, dtype=float)
    v = v[~np.isnan(v)]
    edges = np.arange(lo, hi + step, step)
    counts, _ = np.histogram(np.clip(v, lo, hi - 1e-9), bins=edges)
    return {"lo": lo, "hi": hi, "step": step, "counts": counts.astype(int).tolist(), "n": int(len(v))}


def to_js(path, var, obj):
    """Write `window.<var> = {...};` so the frontend works from file:// without fetch()."""
    def conv(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return None if np.isnan(o) else round(float(o), 4)
        if isinstance(o, (np.bool_,)):
            return bool(o)
        if isinstance(o, (pd.Timestamp,)):
            return o.isoformat()
        raise TypeError(type(o))
    path.write_text(f"window.{var} = " + json.dumps(obj, default=conv, separators=(",", ":")) + ";\n")


def r(x, n=2):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else round(float(x), n)


def to_js_key(path, key, obj):
    """Write `window.DATA.<key> = {...};` (topic files loaded after data.js)."""
    tmp = path.with_suffix(".tmp")
    to_js(tmp, "_", obj)
    body = tmp.read_text()[len("window._ = "):]
    tmp.unlink()
    path.write_text(f"window.DATA = window.DATA || {{}};\nwindow.DATA.{key} = " + body)
