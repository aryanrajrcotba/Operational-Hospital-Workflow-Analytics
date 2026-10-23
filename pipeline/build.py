"""Run the whole pipeline:  python -m pipeline.build [--only workbook|imaging|ops|text|weight]

workbook (T1-T3): reads WaitData.Published.xlsx -> data/processed/*.csv.gz and frontend/data/data.js, data_t3.js
imaging  (T4-T6): needs no workbook; generates the synthetic CT phantom -> frontend/assets/, data_t4..t6.js, t6_volume.js
ops      (T7-T9, T13): reads data/processed/F*_clean.csv.gz (written by `workbook`) -> data_t7.js, data_t8.js, data_t9.js, data_t13.js
text     (T10-T12): needs no workbook; generates synthetic radiology reports -> data_t10.js .. data_t12.js
home     (Home tab): small models exported for the in-browser tools -> data_home.js (run after text/weight not required)
weight   (T14-T15): needs no workbook; generates synthetic adult lifestyle data -> data_t14.js, data_t15.js
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


def ops():
    from . import t7_staffing, t8_strategy_demand, t9_strategy_scenarios, t13_dimensionality_reduction

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js_key(FRONTEND_DATA / "data_t7.js", "t7", t7_staffing.run())
    t8 = t8_strategy_demand.run()
    to_js_key(FRONTEND_DATA / "data_t8.js", "t8", t8)
    to_js_key(FRONTEND_DATA / "data_t9.js", "t9", t9_strategy_scenarios.run(t8))
    to_js_key(FRONTEND_DATA / "data_t13.js", "t13", t13_dimensionality_reduction.run())


def text():
    from . import t10_text_classification, t11_information_extraction, t12_ranking_wsd

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js_key(FRONTEND_DATA / "data_t10.js", "t10", t10_text_classification.run())
    to_js_key(FRONTEND_DATA / "data_t11.js", "t11", t11_information_extraction.run())
    to_js_key(FRONTEND_DATA / "data_t12.js", "t12", t12_ranking_wsd.run())


def weight():
    from . import t14_weight_behaviour_explore, t15_weight_behaviour_models

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js_key(FRONTEND_DATA / "data_t14.js", "t14", t14_weight_behaviour_explore.run())
    to_js_key(FRONTEND_DATA / "data_t15.js", "t15", t15_weight_behaviour_models.run())


def home():
    from . import home as home_mod

    FRONTEND_DATA.mkdir(parents=True, exist_ok=True)
    to_js_key(FRONTEND_DATA / "data_home.js", "home", home_mod.run())


GROUPS = {"workbook": workbook, "imaging": imaging, "ops": ops, "text": text, "weight": weight, "home": home}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=list(GROUPS), help="run one group of topics (default: all, in this order)")
    args = ap.parse_args()
    t0 = time.time()
    for name, fn in GROUPS.items():
        if args.only in (None, name):
            fn()
    print(f"Done in {time.time() - t0:.0f}s -> data/processed/, frontend/data/, frontend/assets/")


if __name__ == "__main__":
    main()
