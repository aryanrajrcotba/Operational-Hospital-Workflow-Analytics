"""T8 - Informed strategic planning, part 1: where are we, and where is demand heading?

Descriptive + forecasting layer for planners: demand level and trend per site, when capacity is tight
(offered load vs installed scanners by weekday and hour), how waits respond to load, and a 12-month
volume forecast that is backtested on the most recent months before being trusted.
"""
import numpy as np
import pandas as pd

from .config import FACILITIES
from .ops import SERVICE_MIN, hourly_grid, load_site
from .utils import r

COLS = ["arrival_dttm", "wait_min", "start_delay_min", "num_scanners_used_today"]
BACKTEST_MONTHS = 5
HORIZON = 12


def month_table(d):
    day = d.groupby(d.arrival_dttm.dt.normalize()).size()
    m = day.groupby(day.index.to_period("M")).agg(["sum", "count", "mean"])
    return m


def fit_trend(y, t):
    A = np.c_[np.ones_like(t), t]
    beta, *_ = np.linalg.lstsq(A, y, rcond=None)
    res = y - A @ beta
    return beta, res


def forecast(m):
    """Linear trend on exams per operating day; first/last month are partial calendar months but their per-day rate is fine."""
    m = m.iloc[1:-1] if len(m) > 4 else m                     # drop the first and last (partial) months
    y, t = m["mean"].values, np.arange(len(m), dtype=float)
    k = BACKTEST_MONTHS
    b, res = fit_trend(y[:-k], t[:-k])
    pred_lin = b[0] + b[1] * t[-k:]
    pred_mean = np.full(k, y[:-k].mean())
    last = np.full(k, y[-k - 1])
    mape = lambda p: r(np.mean(np.abs(p - y[-k:]) / y[-k:]) * 100, 1)
    beta, res = fit_trend(y, t)
    sd = res.std(ddof=2)
    ft = np.arange(len(m), len(m) + HORIZON, dtype=float)
    mid = beta[0] + beta[1] * ft
    widen = sd * np.sqrt(1 + 1 / len(m) + (ft - t.mean()) ** 2 / ((t - t.mean()) ** 2).sum())
    months = [str(p) for p in m.index]
    fut = [str(m.index[-1] + i) for i in range(1, HORIZON + 1)]
    return {"months": months, "per_day": [r(v, 2) for v in y], "fit": [r(beta[0] + beta[1] * v, 2) for v in t],
            "future_months": fut, "future": [r(v, 2) for v in mid], "lo": [r(a - 1.96 * w, 2) for a, w in zip(mid, widen)], "hi": [r(a + 1.96 * w, 2) for a, w in zip(mid, widen)],
            "slope_per_month": r(beta[1], 3), "growth_pct_per_year": r(beta[1] * 12 / max(1e-9, y.mean()) * 100, 1), "r2": r(1 - res.var() / y.var(), 3),
            "backtest": {"months": k, "linear_trend_mape": mape(pred_lin), "flat_mean_mape": mape(pred_mean), "last_value_mape": mape(last),
                         "actual": [r(v, 2) for v in y[-k:]], "linear": [r(v, 2) for v in pred_lin], "labels": months[-k:]},
            "growth_12m_pct": r((mid[-1] / y[-1 - 0] - 1) * 100, 1), "last_per_day": r(y[-3:].mean(), 2), "future_per_day_end": r(mid[-1], 2)}


def site(f):
    d = load_site(f, COLS)
    cap = int(d.num_scanners_used_today.max())
    s = SERVICE_MIN[f]
    grid = hourly_grid(d.arrival_dttm)
    dates = grid.index
    dow = dates.dayofweek
    hours = list(grid.columns)
    # offered load (erlangs) = mean arrivals per hour * service time / 60;  utilisation = load / installed scanners
    load = np.array([[grid.loc[dow == k, h].mean() * s / 60 for h in hours] for k in range(5)])
    util = load / cap
    d["date"], d["hour"] = d.arrival_dttm.dt.normalize(), d.arrival_dttm.dt.hour
    hourly_volume = d.groupby(["date", "hour"]).size().rename("n").reset_index()
    d = d.merge(hourly_volume, on=["date", "hour"])
    bins = [0, 2, 4, 6, 8, 10, 14, 20, 999]
    d["load_bin"] = pd.cut(d.n, bins, right=False)
    curve = d.groupby("load_bin", observed=True).agg(arrivals=("n", "mean"), exams=("n", "size"), delay=("start_delay_min", lambda x: x.clip(lower=0).mean()),
                                                      share_late=("start_delay_min", lambda x: (x > 15).mean() * 100))
    curve = [{"bin": str(i.left) + ("+" if i.right >= 999 else "–" + str(i.right - 1)), "exams": int(row.exams), "delay": r(row.delay, 1), "late": r(row.share_late, 1)} for i, row in curve.iterrows() if row.exams >= 100]
    by_hour = d.groupby("hour").agg(n=("n", "size"), delay=("start_delay_min", lambda x: x.clip(lower=0).mean()), late=("start_delay_min", lambda x: (x > 15).mean() * 100))
    m = month_table(d)
    out = {"installed": cap, "service_min": s, "days": int(len(dates)), "exams": int(len(d)), "per_day": r(len(d) / len(dates), 1), "peak_hour_per_day": r(grid.max(axis=1).mean(), 1),
           "hours": hours, "weekday_util": [[None if np.isnan(v) else r(v, 3) for v in row] for row in util], "peak_util": r(np.nanmax(util), 3), "peak_cell": [int(np.unravel_index(np.nanargmax(util), util.shape)[0]), hours[int(np.unravel_index(np.nanargmax(util), util.shape)[1])]],
           "hours_over_80": int(np.nansum(util >= 0.8)), "cells": int(util.size),
           "load_curve": curve, "hour_delay": {"hour": hours, "delay": [r(by_hour.delay.get(h), 1) for h in hours], "late": [r(by_hour.late.get(h), 1) for h in hours]},
           "kpi": {"mean_delay": r(d.start_delay_min.clip(lower=0).mean(), 1), "p90_wait": r(d.wait_min.quantile(0.9), 1), "late15": r((d.start_delay_min > 15).mean() * 100, 1), "wait_gt30": r((d.wait_min > 30).mean() * 100, 1)},
           "forecast": forecast(m)}
    return out


def run():
    out = {"sites": {}}
    for f in FACILITIES:
        print("T8", f)
        out["sites"][f] = site(f)
        fc = out["sites"][f]["forecast"]
        print("  growth %/yr", fc["growth_pct_per_year"], "backtest", fc["backtest"]["linear_trend_mape"], fc["backtest"]["flat_mean_mape"], "peak util", out["sites"][f]["peak_util"])
    return out
