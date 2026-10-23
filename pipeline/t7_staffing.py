"""T7 - Patient prediction for improved staffing.

Two predictions feed a staffing decision:
 1. Demand: how many patients arrive in each hour?  (hourly count, chronological 70/30 split)
 2. Risk:   will *this* patient wait long?  (classifier on the department state at arrival)
Demand forecasts are turned into a required number of staffed scanner rooms with an M/M/c queue
(Erlang C) and four rosters are compared on the hold-out period against the roster an oracle would
have chosen.  Exam duration is NOT in the workbook, so it is an explicit assumption (see ops.py).
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .config import FACILITIES
from .ops import SERVICE_MIN, TRAIN_FRACTION, WAIT_TARGET_MIN, hourly_grid, load_site, mean_wait, servers_needed
from .utils import r

LEAKS = {"wait_min", "wait_source_min", "start_delay_min", "begin_dttm", "flag_wait_outlier", "flag_started_gt_2h_early", "record_id", "facility", "arrival_dttm", "scheduled_dttm"}


def long_form(grid, split_idx):
    """One row per (date, hour) with calendar and lag features that only look backwards."""
    cal = pd.date_range(grid.index.min(), grid.index.max(), freq="D")
    full = grid.reindex(cal)                                   # NaN on days the site was closed
    rows = []
    lag1 = full.shift(1); lag7 = full.shift(7)
    last4 = pd.concat([full.shift(7 * k) for k in (1, 2, 3, 4)]).groupby(level=0).mean()
    day_prev = full.sum(axis=1, min_count=1).shift(1)
    for h in grid.columns:
        d = pd.DataFrame({"date": cal, "hour": h, "y": full[h].values, "lag7": lag7[h].values, "lag_prev_day": lag1[h].values,
                          "last4wk": last4[h].reindex(cal).values, "prev_day_total": day_prev.values})
        rows.append(d)
    d = pd.concat(rows, ignore_index=True)
    d = d[d.y.notna()].sort_values(["date", "hour"]).reset_index(drop=True)
    d["dow"] = d.date.dt.dayofweek
    d["month"] = d.date.dt.month
    d["trend"] = (d.date - d.date.min()).dt.days
    return d


def feature_matrix(d, hours, linear):
    X = pd.DataFrame({"trend": d.trend, "lag7": d.lag7, "lag_prev_day": d.lag_prev_day, "last4wk": d.last4wk, "prev_day_total": d.prev_day_total})
    if linear:
        for h in hours:
            X[f"h{h}"] = (d.hour == h).astype(float)
        for k in range(5):
            X[f"dow{k}"] = (d.dow == k).astype(float)
        X["weekend"] = (d.dow >= 5).astype(float)
    else:
        X["hour"], X["dow"], X["month"] = d.hour, d.dow, d.month
    return X


def staff(pred, f):
    return np.array([servers_needed(max(0.0, p), SERVICE_MIN[f]) for p in pred])


def demand(f):
    a = load_site(f, ["arrival_dttm"]).arrival_dttm
    grid = hourly_grid(a)
    dates = grid.index.sort_values(); cut = dates[int(len(dates) * TRAIN_FRACTION)]
    d = long_form(grid, cut)
    tr, te = d[d.date < cut], d[d.date >= cut].copy()
    hours = list(grid.columns)

    # baselines and models, all fitted on the training window only
    how = tr.groupby(["dow", "hour"]).y.mean()
    base = te.apply(lambda x: how.get((x.dow, x.hour), tr.y.mean()), axis=1).values
    naive = te.lag7.fillna(pd.Series(base, index=te.index)).values
    Xtr_l, Xte_l = feature_matrix(tr, hours, True), feature_matrix(te, hours, True)
    fill = Xtr_l.mean()
    ridge = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(Xtr_l.fillna(fill), tr.y)
    p_ridge = np.clip(ridge.predict(Xte_l.fillna(fill)), 0, None)
    hgb = HistGradientBoostingRegressor(loss="poisson", max_iter=250, learning_rate=0.05, max_leaf_nodes=15, random_state=0)
    hgb.fit(feature_matrix(tr, hours, False), tr.y)
    p_hgb = hgb.predict(feature_matrix(te, hours, False))
    te["actual"] = te.y.values
    preds = {"Same hour last week": naive, "Average for that weekday and hour": base, "Ridge regression": p_ridge, "Gradient boosting (Poisson)": p_hgb}

    te = te.assign(**{k: v for k, v in preds.items()})
    models = []
    for k, v in preds.items():
        daily = te.assign(p=v).groupby("date")[["y", "p"]].sum()
        models.append({"name": k, "mae": r(mean_absolute_error(te.y, v), 3), "rmse": r(np.sqrt(mean_squared_error(te.y, v)), 3),
                       "daily_mae": r((daily.y - daily.p).abs().mean(), 2), "daily_mape": r(((daily.y - daily.p).abs() / daily.y.clip(lower=1)).mean() * 100, 1),
                       "bias": r((v - te.y).mean(), 3)})
    # residual spread by hour on the training window (out-of-sample proxy: last 20% of training days)
    cut2 = tr.date.iloc[int(len(tr) * 0.8)]
    ridge2 = make_pipeline(StandardScaler(), Ridge(alpha=10.0)).fit(Xtr_l[tr.date < cut2].fillna(fill), tr.y[tr.date < cut2])
    res = tr[tr.date >= cut2].y.values - np.clip(ridge2.predict(Xtr_l[tr.date >= cut2].fillna(fill)), 0, None)
    sd = res.std()

    # staffing rosters, scored on the hold-out
    lam_true = te.y.values
    need = staff(lam_true, f)
    train_need = staff(tr.y.values, f)
    plans = {"One fixed roster (90th percentile of past need)": np.full(len(te), int(np.ceil(np.percentile(train_need, 90)))),
             "Weekday-and-hour average": staff(base, f),
             "Gradient-boosting forecast": staff(p_hgb, f),
             "Gradient-boosting forecast + safety margin": staff(p_hgb + 0.84 * sd, f)}
    plan_rows = []
    for name, c in plans.items():
        wait = np.array([mean_wait(int(ci), float(l), SERVICE_MIN[f]) for ci, l in zip(c, lam_true)])
        patient_wait = (wait * lam_true).sum() / max(1, lam_true.sum())
        plan_rows.append({"name": name, "staff_hours": int(c.sum()), "short_hours_pct": r((c < need).mean() * 100, 1),
                          "shortfall": int(np.maximum(need - c, 0).sum()), "surplus": int(np.maximum(c - need, 0).sum()),
                          "patient_wait_min": r(patient_wait, 2), "waits_over_target_pct": r((wait > WAIT_TARGET_MIN).mean() * 100, 1)})
    oracle_hours = int(need.sum())

    # one representative hold-out week for the chart
    wk = te.date.drop_duplicates().iloc[10:15]
    ex = te[te.date.isin(wk)]
    weekly = {"label": [f"{d.strftime('%a')} {h}:00" for d, h in zip(ex.date, ex.hour)], "actual": ex.y.round(0).tolist(),
              "gbm": ex["Gradient boosting (Poisson)"].round(2).tolist(), "base": ex["Average for that weekday and hour"].round(2).tolist()}
    profile = {"hour": hours, "mean": [r(tr[tr.hour == h].y.mean(), 2) for h in hours], "need_p90": [int(np.percentile(staff(tr[tr.hour == h].y.values, f), 90)) for h in hours]}
    dow = [r(tr[tr.dow == k].groupby("date").y.sum().mean(), 1) for k in range(5)]
    imp = permutation_importance(hgb, feature_matrix(te, hours, False), te.y, n_repeats=3, random_state=0, scoring="neg_mean_absolute_error")
    fi = sorted(zip(feature_matrix(te, hours, False).columns, imp.importances_mean), key=lambda t: -t[1])
    return {"hours": hours, "train_days": int(tr.date.nunique()), "test_days": int(te.date.nunique()), "test_start": str(cut.date()), "mean_per_hour": r(d.y.mean(), 2),
            "models": models, "plans": plan_rows, "oracle_staff_hours": oracle_hours, "weekly": weekly, "profile": profile, "weekday_daily_mean": dow,
            "importance": [{"feature": k, "mae_increase": r(v, 3)} for k, v in fi], "resid_sd": r(sd, 2)}


def wait_risk(f):
    d = pd.read_csv(f"data/processed/{f}_clean.csv.gz", parse_dates=["arrival_dttm"]).sort_values("arrival_dttm").reset_index(drop=True)
    cut = int(len(d) * TRAIN_FRACTION)
    thr = float(d.wait_min.iloc[:cut].quantile(0.75))
    y = (d.wait_min > thr).astype(int)
    X = d.drop(columns=[c for c in d.columns if c in LEAKS]).select_dtypes("number")
    X = X.loc[:, X.iloc[:cut].nunique() > 1]
    Xtr, Xte, ytr, yte = X.iloc[:cut], X.iloc[cut:], y.iloc[:cut], y.iloc[cut:]
    gb = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.06, max_leaf_nodes=15, random_state=0).fit(Xtr, ytr)
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=500, C=0.3)).fit(Xtr.fillna(0), ytr)
    p, pl = gb.predict_proba(Xte)[:, 1], lr.predict_proba(Xte.fillna(0))[:, 1]
    # alert table: flag the top-k % of arrivals by predicted risk
    order = np.argsort(-p); alerts = []
    for k in (5, 10, 20, 30):
        n = int(len(p) * k / 100); hit = yte.values[order[:n]].mean()
        alerts.append({"top_pct": k, "precision": r(hit * 100, 1), "recall": r(yte.values[order[:n]].sum() / yte.sum() * 100, 1), "lift": r(hit / yte.mean(), 2)})
    q = pd.qcut(pd.Series(p), 10, labels=False, duplicates="drop")
    calib = [{"decile": int(i) + 1, "pred": r(p[q == i].mean() * 100, 1), "obs": r(yte.values[q == i].mean() * 100, 1)} for i in sorted(q.unique())]
    sub = np.random.RandomState(0).choice(len(Xte), min(2500, len(Xte)), replace=False)
    pi = permutation_importance(gb, Xte.iloc[sub], yte.iloc[sub], n_repeats=3, random_state=0, scoring="roc_auc")
    top = sorted(zip(X.columns, pi.importances_mean), key=lambda t: -t[1])[:10]
    return {"threshold_min": r(thr, 1), "base_rate": r(yte.mean() * 100, 1), "n_train": int(cut), "n_test": int(len(yte)), "n_features": int(X.shape[1]),
            "auc_gbm": r(roc_auc_score(yte, p), 3), "auc_logit": r(roc_auc_score(yte, pl), 3), "alerts": alerts, "calibration": calib,
            "importance": [{"feature": k, "auc_drop": r(v, 4)} for k, v in top]}


def run():
    out = {"params": {"service_min": SERVICE_MIN, "wait_target_min": WAIT_TARGET_MIN, "train_fraction": TRAIN_FRACTION}, "sites": {}}
    for f in FACILITIES:
        print("T7", f)
        out["sites"][f] = {"demand": demand(f), "risk": wait_risk(f)}
        s = out["sites"][f]
        print("  ", [(m["name"][:12], m["mae"]) for m in s["demand"]["models"]], s["risk"]["auc_gbm"])
    # sensitivity of the answer to the one number we had to assume
    sens = []
    for f in FACILITIES:
        a = hourly_grid(load_site(f, ["arrival_dttm"]).arrival_dttm)
        peak = float(a.stack().quantile(0.95))
        sens.append({"site": f, "peak_arrivals_per_hr": r(peak, 1), "rooms": {str(s): servers_needed(peak, s) for s in (20, 30, 45, 60)}})
    out["sensitivity"] = sens
    return out
