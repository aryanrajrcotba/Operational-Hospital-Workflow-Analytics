"""Shared helpers for the operational topics (T7-T9): hourly demand tables, Erlang-C queueing, staffing rules."""
import numpy as np
import pandas as pd

from .config import FACILITIES, PROCESSED

TRAIN_FRACTION = 0.70
SERVICE_MIN = {"F1": 30, "F2": 30, "F3": 30, "F4": 30}   # assumed mean exam duration (min): NOT in the workbook
WAIT_TARGET_MIN = 10.0                                    # staffing target: mean queue wait at most this long


def load_site(f, cols=None):
    d = pd.read_csv(PROCESSED / f"{f}_clean.csv.gz", usecols=cols, parse_dates=["arrival_dttm"] if cols is None or "arrival_dttm" in cols else None)
    return d


def hourly_grid(arrivals, min_share=0.01):
    """date x hour matrix of arrival counts over operating days (days with >= 1 arrival); zeros kept."""
    a = pd.Series(arrivals).dropna()
    date, hour = a.dt.normalize(), a.dt.hour
    share = hour.value_counts(normalize=True)
    hours = sorted(share[share >= min_share].index)
    t = pd.crosstab(date, hour).reindex(columns=hours, fill_value=0)
    return t


def erlang_c(c, a):
    """P(an arriving patient has to wait) with c servers and offered load a (erlangs); 1 if unstable."""
    if c <= a:
        return 1.0
    s, term = 0.0, 1.0
    for k in range(c):
        s += term
        term *= a / (k + 1)
    top = term * c / (c - a)
    return top / (s + top)


def mean_wait(c, lam_per_hr, service_min):
    """Mean queue wait (min) of an M/M/c queue; capped at 120 when unstable."""
    if lam_per_hr <= 0:
        return 0.0
    a = lam_per_hr * service_min / 60.0
    if c <= a:
        return 120.0
    mu = 60.0 / service_min
    return min(120.0, 60.0 * erlang_c(c, a) / (c * mu - lam_per_hr))


def servers_needed(lam_per_hr, service_min, target=WAIT_TARGET_MIN, cap=60):
    """Smallest number of servers whose mean M/M/c wait is within target."""
    if lam_per_hr <= 0:
        return 0
    c = max(1, int(np.ceil(lam_per_hr * service_min / 60.0 + 1e-9)))
    while c < cap and mean_wait(c, lam_per_hr, service_min) > target:
        c += 1
    return c
