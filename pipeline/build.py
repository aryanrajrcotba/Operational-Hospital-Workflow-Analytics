"""Run the whole pipeline:  python -m pipeline.build

Reads WaitData.Published.xlsx -> writes data/processed/*.csv.gz and frontend/data/data.js
"""
import time
from datetime import datetime

from .config import FACILITIES, FAMILY_OF, FRONTEND_DATA, RAW_XLSX
from .load import load_dictionary, load_raw
from . import t1_understanding, t2_preprocessing
from .utils import to_js


def main():
    t0 = time.time()
    raw = load_raw()
    unmapped = {c for f in FACILITIES for c in raw[f].columns} - set(FAMILY_OF)
    assert not unmapped, f"columns missing from config.FAMILIES: {sorted(unmapped)}"

    clean, full, t2 = t2_preprocessing.run(raw)
    t1 = t1_understanding.run(full, raw, load_dictionary(), t2)

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js(FRONTEND_DATA / "data.js", "DATA", {
        "meta": {"source": RAW_XLSX.name, "generated": datetime.now().strftime("%Y-%m-%d %H:%M")},
        "t1": t1, "t2": t2,
    })
    print(f"Done in {time.time() - t0:.0f}s -> data/processed/, frontend/data/data.js")


if __name__ == "__main__":
    main()
