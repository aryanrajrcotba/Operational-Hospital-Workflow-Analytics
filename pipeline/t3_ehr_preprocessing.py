"""T3 - Preprocessing of EHR-derived data: redundant data removal + missing data.

Works on the standardized frames from T2.  Two questions, both answered with evidence:

1. Redundancy.  Which records / columns repeat information already held elsewhere?  Columns are
   removed in four stages (constant -> identical -> functional copy -> collinear cluster) and the
   effect on a wait-time model is measured on a chronological hold-out, so "removed" never means
   "silently lost signal".  No records are removed: none are true duplicates.
2. Missing data.  The published file has 96 empty cells, all calendar fields (repaired in T2).  The
   larger issue is *implicit* missingness: averages that are undefined when the queue is empty or
   nothing has finished yet are stored as 0.  We discover those rules from the data, mark the rows,
   and benchmark imputers by hiding values we know (MCAR / MAR / MNAR).
"""
import re
import time
import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import leaves_list, linkage, fcluster
from scipy.spatial.distance import squareform
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.experimental import enable_iterative_imputer  # noqa: F401
from sklearn.impute import IterativeImputer, KNNImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, r2_score

from .config import FACILITIES, FAMILIES, FAMILY_OF, PROCESSED, snake
from .utils import r

TRAIN_FRACTION = 0.70
R_COLLINEAR = 0.95          # |Pearson| threshold for a collinear cluster (complete linkage: every pair)
R_FUNCTIONAL = 0.9999       # |Spearman| threshold for "one column is a function of another"
PREFER_KEEP = ["arrival_hour"]   # T2's timestamp-derived hour beats the source StartTime polynomials;
                                 # also pinned so time of day survives collinearity pruning
PROTECTED = {"wait_min", "wait_source_min", "start_delay_min", "calendar_imputed"}
STAT_COLS = re.compile(r"^(avg_|median|most_recent|day_min_wait|day_max_wait|expected_)")
STRUCT_MIN_PRECISION, STRUCT_MIN_RECALL = 0.99, 0.85
REPRESENT = {snake(c): fam for c, fam in FAMILY_OF.items()}
REPRESENT.update({"arrival_hour": "Calendar & time of day", "early_arrival_min": "Target & timestamps",
                  "day_of_week": "Calendar & time of day", "month": "Calendar & time of day",
                  "day_of_year": "Calendar & time of day", "avg_delay_for_day": "Recent delay history"})

# imputation benchmark
BENCH_ROWS, BENCH_REPEATS, BENCH_COLS_PER_FAMILY = 3000, 2, 2
RATES = [5, 10, 20, 40]
MECHANISMS = ["MCAR", "MAR", "MNAR"]
METHODS = ["Column mean", "Column median", "Carry last value", "Time interpolation", "k-nearest rows", "Regression (iterative)"]
AUX_COLS = ["line_count0", "arrival_hour"]   # always-observed helpers offered to kNN / iterative


def _features(df):
    return [c for c in df.columns if df[c].dtype.kind in "if" and c not in PROTECTED and not c.startswith("flag_")]


def _family(c):
    return REPRESENT.get(c, "Other")


# ------------------------------------------------------------------ redundancy
def _redundancy(df, train, feats):
    dec = {}                                   # col -> dict(decision, reason, kind, rep, r)
    kept = list(feats)

    # 1) constant
    for c in list(kept):
        if df[c].nunique() == 1:
            dec[c] = {"stage": "constant", "kind": "constant", "rep": None, "r": None,
                      "reason": f"always {df[c].iloc[0]:g} at this site (not applicable here)"}
            kept.remove(c)

    # 2) identical to an earlier column
    seen = {}
    for c in list(kept):
        key = hash(train[c].to_numpy().tobytes())
        prev = seen.get(key)
        if prev is not None and np.array_equal(df[c].to_numpy(), df[prev].to_numpy()):
            dec[c] = {"stage": "identical", "kind": "identical", "rep": prev, "r": 1.0,
                      "reason": f"every value equals {prev}"}
            kept.remove(c)
        else:
            seen[key] = c

    # 3) functional copy: affine or monotone transform of a column we keep
    order = [c for c in PREFER_KEEP if c in kept] + [c for c in kept if c not in PREFER_KEEP]
    sp = train[kept].corr(method="spearman").abs()
    pe = train[kept].corr().abs()
    keep_f = []
    for c in order:
        hit = next((k for k in keep_f if sp.loc[c, k] >= R_FUNCTIONAL), None)
        if hit is None:
            keep_f.append(c)
            continue
        affine = pe.loc[c, hit] ** 2 >= 0.999999
        dec[c] = {"stage": "function", "kind": "affine copy" if affine else "monotone transform", "rep": hit,
                  "r": r(float(train[[c, hit]].corr().iloc[0, 1]), 4),
                  "reason": f"{'straight-line' if affine else 'monotone'} function of {hit} (Spearman {sp.loc[c, hit]:.4f})"}
    kept = [c for c in kept if c in keep_f]

    # 4) collinear clusters: complete linkage so *every* pair in a cluster has |r| >= R_COLLINEAR
    tgt = train[kept].corrwith(train.wait_min).abs().fillna(0)
    corr = train[kept].corr().fillna(0)
    D = 1 - corr.abs().to_numpy()
    np.fill_diagonal(D, 0)
    Z = linkage(squareform((D + D.T) / 2, checks=False), "complete")
    labels = fcluster(Z, t=1 - R_COLLINEAR, criterion="distance")
    clusters = []
    for lab in np.unique(labels):
        members = [kept[i] for i in np.where(labels == lab)[0]]
        if len(members) < 2:
            continue
        pinned = [m for m in members if m in PREFER_KEEP]
        rep = pinned[0] if pinned else max(members, key=lambda c: (tgt[c], -kept.index(c)))
        clusters.append({"rep": rep, "rep_target_r": r(tgt[rep], 3), "members": [
            {"col": m, "r": r(corr.loc[m, rep], 3), "target_r": r(tgt[m], 3)} for m in members if m != rep]})
        for m in members:
            if m != rep:
                dec[m] = {"stage": "collinear", "kind": "collinear", "rep": rep, "r": r(corr.loc[m, rep], 3),
                          "reason": f"r = {corr.loc[m, rep]:+.3f} with {rep}" + ("" if rep in PREFER_KEEP else ", which tracks wait_min more closely")}
    kept = [c for c in kept if c not in dec]
    clusters.sort(key=lambda c: -len(c["members"]))
    return dec, kept, clusters


def _model_scores(df, feats, n_train):
    """Chronological hold-out. Ridge (standardised) + gradient boosting -> MAE / R^2 on minutes."""
    X, y = df[feats], df.wait_min.to_numpy()
    Xtr, Xte, ytr, yte = X.iloc[:n_train], X.iloc[n_train:], y[:n_train], y[n_train:]
    out = {}
    hgb = HistGradientBoostingRegressor(max_iter=150, random_state=0, early_stopping=False).fit(Xtr, ytr)
    p = hgb.predict(Xte)
    out["hgb"] = {"mae": r(mean_absolute_error(yte, p), 3), "r2": r(r2_score(yte, p), 4)}
    med = Xtr.median()
    A, B = Xtr.fillna(med), Xte.fillna(med)
    mu, sd = A.mean(), A.std(ddof=0).replace(0, 1)
    rd = Ridge(alpha=10.0).fit((A - mu) / sd, ytr)
    p = rd.predict((B - mu) / sd)
    out["ridge"] = {"mae": r(mean_absolute_error(yte, p), 3), "r2": r(r2_score(yte, p), 4)}
    return out


def _records(df, feats):
    same_ts = df[df.arrival_dttm.duplicated(keep=False)]
    grp = same_ts.groupby("arrival_dttm")
    return {
        "rows": len(df),
        "exact_duplicate_rows": int(df.drop(columns=["record_id"]).duplicated().sum()),
        "duplicate_time_keys": int(df.duplicated(["arrival_dttm", "scheduled_dttm", "begin_dttm"]).sum()),
        "shared_arrival_rows": int(len(same_ts)),
        "shared_arrival_groups": int(grp.ngroups),
        "shared_arrival_distinct_wait_share": r((grp.wait_min.nunique() > 1).mean() * 100, 1) if grp.ngroups else None,
        "identical_state_rows": int(df[feats].duplicated().sum()),
    }


# ------------------------------------------------------------------ missing data
def _explicit_missing(t2_site, full_site):
    nulls = t2_site["nulls_before"]
    out = {"cells": int(sum(nulls.values())), "cols": nulls, "rows": int(full_site.calendar_imputed.sum())}
    if out["rows"]:
        m = full_site[full_site.calendar_imputed == 1]
        by = m.arrival_dttm.dt.to_period("M").astype(str).value_counts().sort_index()
        allm = full_site.arrival_dttm.dt.to_period("M").astype(str).value_counts().sort_index()
        out["by_month"] = [{"month": k, "missing": int(v), "rows": int(allm[k])} for k, v in by.items()]
        out["wait_mean_missing"] = r(m.wait_min.mean(), 1)
        out["wait_mean_other"] = r(full_site[full_site.calendar_imputed == 0].wait_min.mean(), 1)
        out["all_fields_together"] = bool(len(set(nulls.values())) == 1)
    out["calendar_agreement"] = t2_site["calendar_agreement"]
    return out


def _structural(df):
    """Find 'undefined, stored as 0' features: a statistic whose value is 0 whenever a count is 0."""
    conds = {}
    for c in df.columns:
        s = df[c]
        if (s.dtype.kind in "i" and s.min() >= 0 and 0.005 < (s == 0).mean() < 0.995 and s.nunique() <= 400
                and not c.startswith("flag_") and c != "calendar_imputed" and not STAT_COLS.match(c)):
            conds[f"{c} = 0"] = s == 0
    for k in range(2, 6):
        conds[f"num_completed_today < {k}"] = df.num_completed_today < k
    found = []
    for c in df.columns:
        if not STAT_COLS.match(c) or df[c].dtype.kind not in "if":
            continue
        z = df[c] == 0
        if z.mean() < 0.005:
            continue
        best = None
        for name, m in conds.items():
            if name.split(" ")[0] == c or not m.any():
                continue
            prec, rec = float(z[m].mean()), float(m[z].mean())
            if prec >= STRUCT_MIN_PRECISION and rec >= STRUCT_MIN_RECALL and (best is None or prec * rec > best[1]):
                best = (name, prec * rec, prec, rec, m)
        if best:
            name, _, prec, rec, m = best
            found.append({"col": c, "family": _family(c), "condition": name, "precision": r(prec * 100, 1),
                          "recall": r(rec * 100, 1), "zero_share": r(z.mean() * 100, 1), "rows": int(m.sum()),
                          "share": r(m.mean() * 100, 1), "_mask": m})
    return found


def _mask_probs(kind, p, aux_rank, own_rank, rng, n):
    """Per-cell missing probability, mean ~= p.  MAR depends on an observed helper, MNAR on the value itself."""
    if kind == "MCAR":
        return np.full(n, p)
    u = aux_rank if kind == "MAR" else own_rank
    w = 0.2 + 1.6 * u            # 0.2..1.8, mean 1.0
    return np.clip(p * w, 0, 0.95)


def _impute(method, X_obs, col_idx, aux_idx):
    """X_obs: (n, k) array with NaN, columns = benchmark cols then AUX. Returns imputed copy."""
    n, k = X_obs.shape
    if method == "Column mean":
        return np.where(np.isnan(X_obs), np.nanmean(X_obs, 0), X_obs)
    if method == "Column median":
        return np.where(np.isnan(X_obs), np.nanmedian(X_obs, 0), X_obs)
    if method == "Carry last value":
        return pd.DataFrame(X_obs).ffill().bfill().to_numpy()
    if method == "Time interpolation":
        return pd.DataFrame(X_obs).interpolate(limit_direction="both").to_numpy()
    if method == "k-nearest rows":
        return KNNImputer(n_neighbors=5).fit_transform(X_obs)
    if method == "Regression (iterative)":
        lo, hi = np.nanmin(X_obs, 0), np.nanmax(X_obs, 0)
        return IterativeImputer(estimator=Ridge(alpha=1.0), max_iter=6, random_state=0, tol=1e-2,
                                min_value=lo, max_value=hi).fit_transform(X_obs)
    raise ValueError(method)


def _benchmark(df, bench_cols, seed):
    n0 = len(df) // 2 - BENCH_ROWS // 2
    blk = df.iloc[n0:n0 + BENCH_ROWS]                       # contiguous block: time order is kept
    cols = bench_cols + [c for c in AUX_COLS if c not in bench_cols]
    Xfull = blk[cols].to_numpy(dtype=float)
    Z = (Xfull - Xfull.mean(0)) / np.where(Xfull.std(0) == 0, 1, Xfull.std(0))   # z-units => NRMSE
    k = len(bench_cols)
    n = len(Z)
    aux_rank = pd.Series(Xfull[:, cols.index("line_count0")]).rank(pct=True).to_numpy()
    res = {m: {me: np.zeros((len(RATES), len(METHODS))) for me in ["nrmse", "sd"]} for m in MECHANISMS}
    cc = {m: [] for m in MECHANISMS}
    for mi, mech in enumerate(MECHANISMS):
        for ri, rate in enumerate(RATES):
            acc_n = np.zeros(len(METHODS)); acc_s = np.zeros(len(METHODS))
            keep_rows = []
            for rep in range(BENCH_REPEATS):
                rng = np.random.default_rng(seed + 1000 * mi + 10 * ri + rep)
                miss = np.zeros((n, k), dtype=bool)
                for j in range(k):
                    own = pd.Series(Z[:, j]).rank(pct=True).to_numpy()
                    p = _mask_probs(mech, rate / 100, aux_rank, own, rng, n)
                    miss[:, j] = rng.random(n) < p
                keep_rows.append(1 - miss.any(1).mean())
                Xo = Z.copy()
                Xo[:, :k][miss] = np.nan
                if (~np.isnan(Xo[:, :k])).sum(0).min() < 20:
                    continue
                for si, meth in enumerate(METHODS):
                    Xi = _impute(meth, Xo, None, None)
                    err = (Xi[:, :k] - Z[:, :k])[miss]
                    acc_n[si] += float(np.sqrt((err ** 2).mean()))
                    imp = Xi[:, :k][miss]
                    acc_s[si] += float(imp.std() / Z[:, :k][miss].std())
            res[mech]["nrmse"][ri] = acc_n / BENCH_REPEATS
            res[mech]["sd"][ri] = acc_s / BENCH_REPEATS
            cc[mech].append(float(np.mean(keep_rows)))
    return {
        "cols": bench_cols, "aux": [c for c in AUX_COLS if c not in bench_cols], "rows": BENCH_ROWS, "repeats": BENCH_REPEATS,
        "rates": RATES, "mechanisms": MECHANISMS, "methods": METHODS,
        "nrmse": {m: {METHODS[j]: [r(res[m]["nrmse"][i, j], 3) for i in range(len(RATES))] for j in range(len(METHODS))} for m in MECHANISMS},
        "sd_ratio": {m: {METHODS[j]: [r(res[m]["sd"][i, j], 3) for i in range(len(RATES))] for j in range(len(METHODS))} for m in MECHANISMS},
        "rows_kept_if_deleted": {m: [r(v * 100, 1) for v in cc[m]] for m in MECHANISMS},
    }


def _pick_bench_cols(df, kept, structural_cols):
    fam_order = [f for f in FAMILIES if f not in ("Target & timestamps", "Calendar & time of day")]
    picked = []
    for fam in fam_order:
        cand = [c for c in kept if _family(c) == fam and c not in structural_cols and df[c].nunique() > 30
                and c not in AUX_COLS and not STAT_COLS.match(c)]
        cand.sort(key=lambda c: -df[c].std() / (abs(df[c].mean()) + 1e-9))
        picked += cand[:BENCH_COLS_PER_FAMILY]
    return picked[:10]


# ------------------------------------------------------------------ entry point
def run(full: dict, t2_report: dict):
    report = {"sites": {}, "params": {
        "train_fraction": TRAIN_FRACTION, "r_collinear": R_COLLINEAR, "r_functional": R_FUNCTIONAL,
        "struct_min_precision": STRUCT_MIN_PRECISION * 100, "struct_min_recall": STRUCT_MIN_RECALL * 100}}
    decisions, out_frames = [], {}
    all_dropped = {}

    for f in FACILITIES:
        t0 = time.time()
        df = full[f]
        n_train = int(len(df) * TRAIN_FRACTION)
        train = df.iloc[:n_train]
        feats = _features(df)
        rep = {"features_start": len(feats), "cols_in_file_start": df.shape[1]}
        rep["records"] = _records(df, feats)

        dec, kept, clusters = _redundancy(df, train, feats)
        stages = {}
        for d in dec.values():
            stages[d["stage"]] = stages.get(d["stage"], 0) + 1
        rep["stages"] = [{"stage": s, "dropped": stages.get(s, 0)} for s in ["constant", "identical", "function", "collinear"]]
        rep["features_kept"] = len(kept)
        rep["decisions"] = [{"col": c, "family": _family(c), **{k: v for k, v in d.items()}} for c, d in dec.items()]
        rep["clusters"] = clusters
        all_dropped[f] = set(dec)

        # correlation heatmap (train window) in dendrogram order, before removal
        live = [c for c in feats if c not in {k for k, v in dec.items() if v["stage"] in ("constant", "identical")}]
        C = train[live].corr().fillna(0)
        Dm = 1 - C.abs().to_numpy(); np.fill_diagonal(Dm, 0)
        order = leaves_list(linkage(squareform((Dm + Dm.T) / 2, checks=False), "average"))
        cols_o = [live[i] for i in order]
        rep["heatmap"] = {"cols": cols_o, "status": [("kept" if c in kept else dec[c]["stage"]) for c in cols_o],
                          "r100": np.round(C.loc[cols_o, cols_o].to_numpy() * 100).astype(int).tolist()}

        # does removal cost accuracy?
        rep["model_before"] = _model_scores(df, feats, n_train)
        rep["model_after"] = _model_scores(df, kept, n_train)

        # ---- missing data
        rep["explicit_missing"] = _explicit_missing(t2_report["sites"][f], df)
        st = _structural(df)
        st_kept = [s for s in st if s["col"] in kept]
        masks = {s["col"]: s["_mask"] for s in st_kept}
        X0 = df[kept].copy()
        Xn = X0.copy()
        for c, m in masks.items():
            Xn.loc[m, c] = np.nan
        rep["structural"] = [{k: v for k, v in s.items() if k != "_mask"} for s in st]
        rep["structural_cells"] = int(sum(m.sum() for m in masks.values()))
        rep["structural_cols_kept"] = len(masks)
        rep["model_zero_coded"] = rep["model_after"]
        na = df.copy()
        for c, m in masks.items():
            na.loc[m, c] = np.nan
        rep["model_nan_marked"] = _model_scores(na, kept, n_train)

        bench_cols = _pick_bench_cols(df, kept, set(masks))
        rep["benchmark"] = _benchmark(df, bench_cols, seed=11 + len(f) + FACILITIES.index(f))

        # ---- write per-site output: T2 clean file minus dropped columns, structural zeros -> NaN
        out = df.drop(columns=[c for c in dec]).copy()
        for c, m in masks.items():
            out.loc[m, c] = np.nan
        out_frames[f] = out
        rep["cols_in_file_end"] = out.shape[1]
        report["sites"][f] = rep
        for c in feats:
            decisions.append({"facility": f, "column": c, "family": _family(c),
                              "decision": "dropped" if c in dec else "kept",
                              "stage": dec[c]["stage"] if c in dec else "",
                              "representative": dec[c]["rep"] if c in dec and dec[c]["rep"] else "",
                              "reason": dec[c]["reason"] if c in dec else "",
                              "structural_missing_rows": int(masks[c].sum()) if c in masks else 0})
        print(f"  T3 {f}: {len(feats)} -> {len(kept)} features, {rep['structural_cells']:,} undefined cells marked, {time.time() - t0:.0f}s")

    # consensus across sites
    dropped_counts = pd.Series([c for s in all_dropped.values() for c in s]).value_counts()
    report["consensus"] = {"dropped_everywhere": sorted(dropped_counts[dropped_counts == len(FACILITIES)].index),
                           "dropped_somewhere": int(len(dropped_counts))}

    PROCESSED.mkdir(parents=True, exist_ok=True)
    for f, o in out_frames.items():
        o.to_csv(PROCESSED / f"{f}_reduced.csv.gz", index=False)
    pd.DataFrame(decisions).to_csv(PROCESSED / "t3_column_decisions.csv", index=False)
    report["outputs"] = {f: {"rows": len(o), "cols": o.shape[1], "nan_cells": int(o.isna().sum().sum())} for f, o in out_frames.items()}
    return report
