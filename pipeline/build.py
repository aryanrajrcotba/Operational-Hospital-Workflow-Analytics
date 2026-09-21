"""Run the whole pipeline:  python -m pipeline.build [--only workbook|imaging]

workbook (T1-T3): reads WaitData.Published.xlsx -> data/processed/*.csv.gz and frontend/data/data.js, data_t3.js
imaging  (T4-T6): needs no workbook; generates the synthetic CT phantom -> frontend/assets/, data_t4..t6.js, t6_volume.js
"""
import argparse
import time
from datetime import datetime

from .config import FACILITIES, FAMILY_OF, FRONTEND_DATA, RAW_XLSX
from .utils import to_js, to_js_key


def workbook():
    from .load import load_dictionary, load_raw
    from . import t1_understanding, t2_preprocessing, t3_ehr_preprocessing

    raw = load_raw()
    unmapped = {c for f in FACILITIES for c in raw[f].columns} - set(FAMILY_OF)
    assert not unmapped, f"columns missing from config.FAMILIES: {sorted(unmapped)}"

    clean, full, t2 = t2_preprocessing.run(raw)
    t1 = t1_understanding.run(full, raw, load_dictionary(), t2)
    t3 = t3_ehr_preprocessing.run(full, t2)

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js(FRONTEND_DATA / "data.js", "DATA", {
        "meta": {"source": RAW_XLSX.name, "generated": datetime.now().strftime("%Y-%m-%d %H:%M")},
        "t1": t1, "t2": t2,
    })
    to_js_key(FRONTEND_DATA / "data_t3.js", "t3", t3)


def imaging():
    from . import t4_image_processing, t5_image_analysis, t6_visualisation

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js_key(FRONTEND_DATA / "data_t4.js", "t4", t4_image_processing.run())
    to_js_key(FRONTEND_DATA / "data_t5.js", "t5", t5_image_analysis.run())
    to_js_key(FRONTEND_DATA / "data_t6.js", "t6", t6_visualisation.run())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["workbook", "imaging"], help="run just T1-T3 or just T4-T6 (default: both)")
    args = ap.parse_args()
    t0 = time.time()
    if args.only != "imaging":
        workbook()
    if args.only != "workbook":
        imaging()
    print(f"Done in {time.time() - t0:.0f}s -> data/processed/, frontend/data/, frontend/assets/")


if __name__ == "__main__":
    main()
