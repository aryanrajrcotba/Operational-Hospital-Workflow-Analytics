"""T2 - Preprocessing of EHR-derived operational data: standardization + data cleaning.

Every step records what it found and what it changed so the frontend can show
evidence, not just claims.  Nothing is silently dropped: rows are repaired or
flagged, and the only columns removed are those with zero variance in a site.
"""
import json
import numpy as np
import pandas as pd

from .config import FACILITIES, FAMILY_OF, FLAGS, PROCESSED, snake
from .utils import hist, r

ALIASES = {"AvgWaitForDay": "AvgDelayForDay"}  # F4 name for the same daily-average feature
TIMESTAMPS = ["arrival_dttm", "scheduled_dttm", "begin_dttm"]
DERIVED_MIN = ["wait_min", "start_delay_min", "early_arrival_min"]
TRAIN_FRACTION = 0.70
CLIP_Q = (0.001, 0.999)
SCALE_DEMO = ["start_hour_4th", "start_hour_cu", "sum_time_to_complete_in_progress",
              "sum_in_progress", "day_max_wait", "avg_age_people_waiting",
              "num_completed_today", "line_count0"]


def _minutes(a, b):
    return (a - b).dt.total_seconds() / 60.0


def detect_calendar_shift(raw: dict, max_days: int = 3000):
    """Smallest constant day-shift k such that (arrival - k days) reproduces the
    source DayOfYear *and* DayOfWeek (Sunday=1) in >= 99.9 % of sampled rows, for every site."""
    samples = []
    for f in FACILITIES:
        d = raw[f].dropna(subset=["DayOfYear", "DayOfWeek"]).sample(1500, random_state=7)
        samples.append((d.x_ArrivalDTTM.dt.normalize(), d.DayOfYear.astype(int),
                        ((d.DayOfWeek.astype(int) - 2) % 7 + 1)))
    for k in range(max_days):
        ok = True
        for a, doy, dow in samples:
            s = a - pd.Timedelta(days=k)
            if (s.dt.dayofyear == doy).mean() < 0.999 or (s.dt.isocalendar().day == dow).mean() < 0.999:
                ok = False
                break
        if ok:
            return k
    return None


def _checks(df):
    """Consistency rules -> violation counts (evaluated before and after cleaning)."""
    cnt_cols = [c for c in df.columns if any(t in c for t in ("count", "num_", "size")) and df[c].dtype.kind in "if"]
    out = {
        "Exam begins before patient arrival": int((df.begin_dttm < df.arrival_dttm).sum()),
        "Negative value in a count column": int(sum((df[c] < 0).sum() for c in cnt_cols)),
        "'None in line' flag disagrees with line_count0": int(((df.none_in_line == 1) != (df.line_count0 == 0)).sum()),
        "'None in progress' flag disagrees with in_progress_size": int(((df.none_in_progress == 1) != (df.in_progress_size == 0)).sum()),
        "'Is first' flag disagrees with ahead_count = 0": int(((df.is_first == 1) != (df.ahead_count == 0)).sum()),
        "Average patient age outside 0-110": int(((df.avg_age_people_waiting < 0) | (df.avg_age_people_waiting > 110)).sum()),
    }
    return out


def run(raw: dict):
    shift = detect_calendar_shift(raw)
    assert shift is not None, "no constant calendar shift found - inspect calendar columns"

    report = {"sites": {}, "calendar_shift_found": True}
    full, clean = {}, {}

    for f in FACILITIES:
        src = raw[f]
        rep = {"raw_rows": len(src), "raw_cols": src.shape[1]}
        a, s, b = src.x_ArrivalDTTM, src.x_ScheduledDTTM, src.x_BeginDTTM

        # ---- evidence gathered on the RAW frame -------------------------------------
        rep["nulls_before"] = {c: int(n) for c, n in src.isna().sum().items() if n}
        rep["exact_duplicate_rows"] = int(src.duplicated().sum())
        rep["duplicate_time_keys"] = int(src.duplicated(["x_ArrivalDTTM", "x_ScheduledDTTM", "x_BeginDTTM"]).sum())
        rep["duplicate_arrival_ts"] = int(a.duplicated(keep=False).sum())
        m_sched = float(((_minutes(b, s).round() - src.Wait).abs() <= 1).mean())
        m_arr = float(((_minutes(b, a).round() - src.Wait).abs() <= 1).mean())
        rep["wait_matches_begin_minus_scheduled"] = r(m_sched * 100, 1)
        rep["wait_matches_begin_minus_arrival"] = r(m_arr * 100, 1)
        rep["wait_definition"] = "begin − scheduled" if m_sched > .99 else "begin − arrival" if m_arr > .99 else "unknown"
        rep["source_wait_median"] = r(src.Wait.median(), 1)
        rep["source_wait_mean"] = r(src.Wait.mean(), 1)
        rep["source_wait_min"], rep["source_wait_max"] = int(src.Wait.min()), int(src.Wait.max())
        dow_counts = src.DayOfWeek.dropna().astype(int).value_counts().sort_index()
        rep["dow_codes_raw"] = {int(k): int(v) for k, v in dow_counts.items()}
        arr_dec = a.dt.hour + a.dt.minute / 60
        off = (arr_dec - src.StartTime).round(1)
        rep["start_time_offset_h"] = r(off.mode().iloc[0], 1)
        rep["start_time_offset_share"] = r((off == off.mode().iloc[0]).mean() * 100, 1)
        raw_check = None  # filled after rename below

        # ---- STANDARDIZATION ---------------------------------------------------------
        df = src.rename(columns=ALIASES).copy()
        raw_to_clean = {c: snake(c) for c in df.columns}
        df = df.rename(columns=raw_to_clean)
        df = df.sort_values("arrival_dttm").reset_index(drop=True)
        df.insert(0, "record_id", [f"{f}-{i:06d}" for i in range(len(df))])
        df.insert(1, "facility", f)

        # one wait definition for every site, always in minutes, always from timestamps
        df["wait_min"] = _minutes(df.begin_dttm, df.arrival_dttm).round(2)
        df["start_delay_min"] = _minutes(df.begin_dttm, df.scheduled_dttm).round(2)
        df["early_arrival_min"] = _minutes(df.scheduled_dttm, df.arrival_dttm).round(2)
        df["arrival_hour"] = (df.arrival_dttm.dt.hour + df.arrival_dttm.dt.minute / 60
                              + df.arrival_dttm.dt.second / 3600).round(3)

        # calendar: source Sunday=1 code -> ISO (Mon=1..Sun=7)
        dow_src = df.day_of_week_src
        dow_iso = ((dow_src - 2) % 7 + 1)
        shifted = df.arrival_dttm.dt.normalize() - pd.Timedelta(days=shift)
        d_dow, d_month, d_doy = shifted.dt.isocalendar().day.astype(int), shifted.dt.month, shifted.dt.dayofyear
        known = dow_src.notna()
        rep["calendar_agreement"] = {
            "day_of_week": r((dow_iso[known] == d_dow[known]).mean() * 100, 2),
            "month": r((df.month_src[known] == d_month[known]).mean() * 100, 2),
            "day_of_year": r((df.day_of_year_src[known] == d_doy[known]).mean() * 100, 2),
            "rows_checked": int(known.sum()),
        }
        raw_ts_vs_cal = (df.arrival_dttm.dt.dayofweek + 1)[known]
        rep["naive_dow_agreement"] = r(((dow_iso[known]) == raw_ts_vs_cal).mean() * 100, 2)
        rep["naive_month_agreement"] = r((df.month_src[known] == df.arrival_dttm.dt.month[known]).mean() * 100, 2)
        rep["naive_doy_agreement"] = r((df.day_of_year_src[known] == df.arrival_dttm.dt.dayofyear[known]).mean() * 100, 2)
        df["calendar_imputed"] = (~known).astype("int8")
        df["day_of_week"] = dow_iso.fillna(d_dow).astype("int8")
        df["month"] = df.month_src.fillna(d_month).astype("int8")
        df["day_of_year"] = df.day_of_year_src.fillna(d_doy).astype("int16")
        df = df.drop(columns=["day_of_week_src", "month_src", "day_of_year_src"])
        rep["calendar_filled"] = int((~known).sum())

        # ---- DATA CLEANING ----------------------------------------------------------
        for c in FLAGS:
            df[snake(c)] = df[snake(c)].astype("int8")

        checks_before = _checks(df)
        # repair: is_first is fully determined by ahead_count (rule holds on every other row)
        df["is_first"] = (df.ahead_count == 0).astype("int8")
        rep["is_first_repaired"] = int(checks_before["'Is first' flag disagrees with ahead_count = 0"])
        checks_after = _checks(df)
        rep["checks"] = [{"rule": k, "before": checks_before[k], "after": checks_after[k]} for k in checks_before]

        # whole-number float columns -> integers
        cast = 0
        for c in df.columns:
            if df[c].dtype == "float64" and df[c].notna().all() and (df[c] % 1 == 0).all() and c not in DERIVED_MIN + ["arrival_hour"]:
                df[c] = df[c].astype("int32")
                cast += 1
        rep["float_to_int_cols"] = cast

        # outliers: flag, never delete (long waits are real operational events)
        q1, q3 = df.wait_min.quantile([.25, .75])
        fence = q3 + 1.5 * (q3 - q1)
        df["flag_wait_outlier"] = (df.wait_min > fence).astype("int8")
        df["flag_arrived_gt_3h_early"] = (df.early_arrival_min > 180).astype("int8")
        df["flag_started_gt_2h_early"] = (df.start_delay_min < -120).astype("int8")
        df["flag_dup_arrival_ts"] = df.arrival_dttm.duplicated(keep=False).astype("int8")
        rep["outliers"] = {
            "wait_q1": r(q1), "wait_q3": r(q3), "wait_fence": r(fence), "wait_max": r(df.wait_min.max()),
            "wait_flagged": int(df.flag_wait_outlier.sum()),
            "arrived_gt_3h_early": int(df.flag_arrived_gt_3h_early.sum()),
            "started_gt_2h_early": int(df.flag_started_gt_2h_early.sum()),
            "dup_arrival_ts_rows": int(df.flag_dup_arrival_ts.sum()),
        }
        rep["wait_hist_std"] = hist(df.wait_min, 0, 200, 5)
        rep["nulls_after"] = int(df.isna().sum().sum())

        full[f] = df.copy()
        # zero-variance columns are "not applicable at this site" -> drop from the per-site file
        const = {c: (df[c].iloc[0].item() if hasattr(df[c].iloc[0], "item") else df[c].iloc[0])
                 for c in df.columns if df[c].nunique(dropna=False) == 1
                 and c not in ("facility", "calendar_imputed") and not c.startswith("flag_")}
        rep["constant_dropped"] = const
        clean[f] = df.drop(columns=list(const))
        rep["clean_rows"], rep["clean_cols"] = len(clean[f]), clean[f].shape[1]
        rep["stage_cols"] = {"raw": src.shape[1], "standardized": df.shape[1] - 0, "cleaned": clean[f].shape[1]}
        report["sites"][f] = rep

    # ---- schema harmonization ----------------------------------------------------------
    raw_names = {f: {snake(ALIASES.get(c, c)) for c in raw[f].columns} for f in FACILITIES}
    core_raw = set.intersection(*raw_names.values())
    union_raw = set.union(*raw_names.values())
    report["schema"] = {
        "core_cols": len(core_raw), "union_cols": len(union_raw),
        "site_only": {f: sorted(raw_names[f] - core_raw) for f in FACILITIES},
        "raw_cols": {f: len(raw_names[f]) for f in FACILITIES},
    }

    # ---- scaling (fit on the chronological training window of each site) ------------------
    flags_core = [snake(c) for c in FLAGS]
    skip = set(TIMESTAMPS + ["wait_source_min", "record_id", "facility"]) | set(flags_core)
    core_num = [c for c in full["F1"].columns
                if c in core_raw and c not in skip and c not in ("day_of_week", "month", "day_of_year")
                and c not in DERIVED_MIN and full["F1"][c].dtype.kind in "if"]
    core_num += ["arrival_hour"] if "arrival_hour" not in core_num else []
    parts, params, clipped = [], {}, 0
    demo_before, demo_after = {c: [] for c in SCALE_DEMO}, {c: [] for c in SCALE_DEMO}
    for f in FACILITIES:
        df = full[f]
        n_train = int(len(df) * TRAIN_FRACTION)
        train = df.iloc[:n_train]
        lo, hi = train[core_num].quantile(CLIP_Q[0]), train[core_num].quantile(CLIP_Q[1])
        mu = train[core_num].clip(lo, hi, axis=1).mean()
        sd = train[core_num].clip(lo, hi, axis=1).std(ddof=0).replace(0, np.nan)
        x = df[core_num]
        clipped += int(((x < lo) | (x > hi)).sum().sum())
        z = ((x.clip(lo, hi, axis=1) - mu) / sd).fillna(0.0).astype("float32")
        z.columns = ["z_" + c for c in core_num]
        out = pd.concat([df[["record_id", "facility", "arrival_dttm", "wait_min", "day_of_week", "month", "day_of_year"]
                            + flags_core].reset_index(drop=True), z.reset_index(drop=True)], axis=1)
        out.insert(3, "split", np.where(np.arange(len(df)) < n_train, "train", "test"))
        parts.append(out)
        params[f] = {"train_rows": n_train, "mean": mu.round(5).to_dict(), "std": sd.round(5).to_dict(),
                     "clip_lo": lo.round(5).to_dict(), "clip_hi": hi.round(5).to_dict()}
        for c in SCALE_DEMO:
            demo_before[c].append(df[c].to_numpy())
            demo_after[c].append(z["z_" + c].to_numpy())
    model_ready = pd.concat(parts, ignore_index=True)

    scaling = []
    for c in SCALE_DEMO:
        b, z = np.concatenate(demo_before[c]), np.concatenate(demo_after[c])
        scaling.append({
            "feature": c, "family": FAMILY_OF.get(next((k for k in FAMILY_OF if snake(k) == c), ""), ""),
            "before": {"min": r(b.min()), "max": r(b.max()), "mean": r(b.mean()), "std": r(b.std())},
            "after": {"min": r(z.min()), "max": r(z.max()), "mean": r(z.mean(), 3), "std": r(z.std(), 3)},
            "hist_before": hist(b, float(np.percentile(b, .1)), float(np.percentile(b, 99.9)), (np.percentile(b, 99.9) - np.percentile(b, .1)) / 30),
            "hist_after": hist(z, -4, 4, 8 / 30),
        })
    report["scaling"] = {"features": scaling, "n_scaled": len(core_num), "train_fraction": TRAIN_FRACTION,
                         "clip_quantiles": list(CLIP_Q), "cells_clipped": clipped,
                         "cells_total": int(len(model_ready) * len(core_num)), "rows": len(model_ready)}

    # ---- write outputs ------------------------------------------------------------------
    PROCESSED.mkdir(parents=True, exist_ok=True)
    for f in FACILITIES:
        clean[f].to_csv(PROCESSED / f"{f}_clean.csv.gz", index=False)
    model_ready.to_csv(PROCESSED / "core_model_ready.csv.gz", index=False, float_format="%.4f")
    (PROCESSED / "scaler_params.json").write_text(json.dumps(params))
    return clean, full, report
