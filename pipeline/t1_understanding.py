"""T1 - Understanding EHR-derived operational data.

Summarises what one record is, how it maps to EHR/RIS events, which feature families
exist, and how the four facilities behave.  Uses the standardized frames from T2 so the
numbers are comparable across sites (wait_min = begin - arrival everywhere).
"""
import numpy as np
import pandas as pd

from .config import FACILITIES, FAMILIES, FAMILY_OF, FLAGS, snake
from .load import describe
from .t2_preprocessing import ALIASES, TIMESTAMPS, DERIVED_MIN
from .utils import hist, r

STATS_COL = {"Wait": "wait_source_min", "DayOfWeek": "day_of_week", "Month": "month", "DayOfYear": "day_of_year"}
MIN_CELL = 20   # suppress means built from fewer rows than this


def _dtype_kind(raw_name, series):
    if raw_name in TIMESTAMPS or raw_name.startswith("x_"):
        return "timestamp"
    if raw_name == "Wait":
        return "target"
    if raw_name in FLAGS:
        return "binary flag"
    if raw_name in ("DayOfWeek", "Month", "DayOfYear"):
        return "calendar code"
    return "count" if series is not None and (series % 1 == 0).all() else "continuous"


def run(full: dict, raw: dict, dictionary: dict, t2_report: dict):
    out = {"sites": {}, "facilities": FACILITIES}

    for f in FACILITIES:
        df = full[f]
        a = df.arrival_dttm
        wk = df.wait_min
        site = {
            "rows": len(df), "raw_cols": raw[f].shape[1],
            "first_arrival": a.min().strftime("%Y-%m-%d"), "last_arrival": a.max().strftime("%Y-%m-%d"),
            "operating_days": int(a.dt.normalize().nunique()),
            "exams_per_day": r(len(df) / a.dt.normalize().nunique(), 1),
            "weekend_share": r((df.day_of_week >= 6).mean() * 100, 1),
            "wait_mean": r(wk.mean(), 1), "wait_median": r(wk.median(), 1),
            "wait_p90": r(wk.quantile(.9), 1), "wait_p95": r(wk.quantile(.95), 1),
            "early_median": r(df.early_arrival_min.median(), 1),
            "start_delay_median": r(df.start_delay_min.median(), 1),
            "late_start_share": r((df.start_delay_min > 0).mean() * 100, 1),
            "source_wait_definition": t2_report["sites"][f]["wait_definition"],
            "scanners_max": int(df.num_scanners_used_today.max()),
            "wait_hist": hist(wk, 0, 200, 5),
        }
        # by hour of arrival (from the timestamp)
        hr = a.dt.hour
        g = df.groupby(hr).wait_min.agg(["size", "mean"])
        site["hourly"] = {"hour": [int(h) for h in g.index], "volume": [int(v) for v in g["size"]],
                          "mean_wait": [r(m) if n >= MIN_CELL else None for n, m in zip(g["size"], g["mean"])]}
        # by weekday (ISO from the source calendar code)
        g = df.groupby("day_of_week").wait_min.agg(["size", "mean"]).reindex(range(1, 8))
        site["weekday"] = {"volume": [int(v) if not np.isnan(v) else 0 for v in g["size"]],
                           "mean_wait": [r(m) if n >= MIN_CELL else None for n, m in zip(g["size"].fillna(0), g["mean"])]}
        # monthly trend of published timestamps
        ym = a.dt.to_period("M").astype(str)
        g = df.groupby(ym).wait_min.agg(["size", "mean"])
        site["monthly"] = {"month": list(g.index), "volume": [int(v) for v in g["size"]],
                           "mean_wait": [r(m) if n >= MIN_CELL else None for n, m in zip(g["size"], g["mean"])]}
        # hour x weekday heatmap of mean wait
        hm = df.groupby([hr, "day_of_week"]).wait_min.agg(["size", "mean"])
        hours = list(range(8, 19))
        cells = []
        for h in hours:
            row = []
            for d in range(1, 8):
                if (h, d) in hm.index and hm.loc[(h, d), "size"] >= MIN_CELL:
                    row.append([r(hm.loc[(h, d), "mean"], 1), int(hm.loc[(h, d), "size"])])
                else:
                    row.append(None)
            cells.append(row)
        site["heatmap"] = {"hours": hours, "cells": cells}
        # feature correlation with the wait target
        num = [c for c in df.columns if df[c].dtype.kind in "if" and c not in
               set(TIMESTAMPS + DERIVED_MIN + ["wait_source_min", "arrival_hour", "calendar_imputed", "day_of_week", "month", "day_of_year"])
               and not c.startswith("flag_") and df[c].std() > 0]
        corr = df[num].corrwith(df.wait_min).dropna()
        top = corr.reindex(corr.abs().sort_values(ascending=False).index)[:12]
        site["top_corr"] = [{"feature": k, "r": r(v, 3)} for k, v in top.items()]
        out["sites"][f] = site

    # ---- feature dictionary (union of raw columns, F4's AvgWaitForDay folded into AvgDelayForDay)
    seen, dic = {}, []
    for f in FACILITIES:
        for c in raw[f].columns:
            seen.setdefault(ALIASES.get(c, c), []).append(f)
    for raw_name, sites in seen.items():
        col = STATS_COL.get(raw_name, snake(raw_name))
        entry = {"raw": raw_name, "name": col, "family": FAMILY_OF[raw_name], "desc": describe(raw_name, dictionary),
                 "sites": sites, "kind": None, "stats": {}, "constant_in": []}
        kinds = []
        for f in sites:
            if col in full[f].columns:
                s = full[f][col]
                if s.dtype.kind in "if":
                    entry["stats"][f] = [r(s.mean(), 2), r(s.min(), 2), r(s.max(), 2)]
                    if s.nunique() == 1:
                        entry["constant_in"].append(f)
                    kinds.append(_dtype_kind(raw_name, s))
        entry["kind"] = kinds[0] if kinds else _dtype_kind(raw_name, None)
        if raw_name == "AvgDelayForDay":
            entry["desc"] += " (named AvgWaitForDay in F4)"
        dic.append(entry)
    out["dictionary"] = dic

    fam_counts = {}
    for e in dic:
        fam_counts.setdefault(e["family"], {"all4": 0, "partial": 0})
        fam_counts[e["family"]]["all4" if len(e["sites"]) == 4 else "partial"] += 1
    out["families"] = [{"family": k, **fam_counts[k]} for k in FAMILIES]
    out["kinds"] = pd.Series([e["kind"] for e in dic]).value_counts().to_dict()
    out["totals"] = {
        "rows": sum(len(full[f]) for f in FACILITIES),
        "features_union": len(dic), "features_core": t2_report["schema"]["core_cols"],
        "first": min(out["sites"][f]["first_arrival"] for f in FACILITIES),
        "last": max(out["sites"][f]["last_arrival"] for f in FACILITIES),
    }
    return out
