"""T9 - Informed strategic planning, part 2: what should we do about it?

T8 described load and forecast demand.  T9 turns that into decisions: a what-if grid (demand growth x number of
staffed scanners) evaluated with the same M/M/c queue as T7, the growth each site can absorb before missing the
wait target, the month the 12-month forecast crosses that limit, rooms needed at the end of the horizon, and how
much the answer moves when the one assumed input (exam duration) is wrong.
"""
import numpy as np

from .config import FACILITIES
from .ops import SERVICE_MIN, WAIT_TARGET_MIN, hourly_grid, load_site, mean_wait, servers_needed
from .utils import r

GROWTH = [0, 10, 20, 30, 40, 50]          # % more arrivals than today
UTIL_LIMIT = 0.85                          # planning ceiling for scanner utilisation


def lam_table(f):
    """Mean arrivals per hour for each (weekday, hour) cell, plus the installed scanner count."""
    d = load_site(f, ["arrival_dttm", "num_scanners_used_today"])
    g = hourly_grid(d.arrival_dttm)
    dow = g.index.dayofweek
    hours = list(g.columns)
    lam = np.array([[g.loc[dow == k, h].mean() for h in hours] for k in range(5)])
    lam = np.nan_to_num(lam)
    return lam, hours, int(d.num_scanners_used_today.max())


def evaluate(lam, rooms, growth, s):
    """Patient-weighted mean wait, share of busy hours over target, peak utilisation."""
    L = lam * (1 + growth / 100.0)
    w = np.vectorize(lambda l: mean_wait(rooms, float(l), s))(L)
    patients = L.sum()
    util = L * s / 60.0 / rooms
    return {"wait": float((w * L).sum() / patients), "over": float(((w > WAIT_TARGET_MIN) & (L > 0.5)).sum() / max(1, (L > 0.5).sum()) * 100),
            "peak_util": float(util.max()), "util80": float((util >= UTIL_LIMIT).sum())}


def headroom(lam, rooms, s):
    """Largest growth (%) at which the patient-weighted wait stays within target, by bisection."""
    lo, hi = 0.0, 400.0
    if evaluate(lam, rooms, 0, s)["wait"] > WAIT_TARGET_MIN:
        return 0.0
    for _ in range(25):
        mid = (lo + hi) / 2
        if evaluate(lam, rooms, mid, s)["wait"] <= WAIT_TARGET_MIN:
            lo = mid
        else:
            hi = mid
    return lo


def site(f, t8):
    lam, hours, installed = lam_table(f)
    s = SERVICE_MIN[f]
    fc = t8["sites"][f]["forecast"]
    now, end = fc["last_per_day"], fc["future_per_day_end"]
    growth_end = (end / now - 1) * 100 if now else 0.0
    room_opts = [max(1, installed - 1), installed, installed + 1, installed + 2]

    grid = []
    for rooms in room_opts:
        for g in GROWTH:
            e = evaluate(lam, rooms, g, s)
            grid.append({"rooms": rooms, "growth": g, "wait": r(e["wait"], 1), "over": r(e["over"], 1), "peak_util": r(e["peak_util"], 2), "util_hours": int(e["util80"])})
    # rooms the *peak* weekday-hour needs for the wait target, by growth
    need = [{"growth": g, "rooms": max(servers_needed(float(lam.max() * (1 + g / 100)), s), 1),
             "avg_hour_rooms": max(servers_needed(float(lam[lam > 0].mean() * (1 + g / 100)), s), 1)} for g in GROWTH]
    head = {str(rooms): r(headroom(lam, rooms, s), 0) for rooms in room_opts}

    # month-by-month: the first forecast month the installed scanners cannot hold the target
    months = fc["future_months"]
    path = []
    cross = None
    for m, v in zip(months, fc["future"]):
        g = (v / now - 1) * 100
        e = evaluate(lam, installed, g, s)
        path.append({"month": m, "growth": r(g, 1), "wait": r(e["wait"], 1), "peak_util": r(e["peak_util"], 2)})
        if cross is None and e["wait"] > WAIT_TARGET_MIN:
            cross = m
    rooms_end = next((c for c in range(installed, installed + 12) if evaluate(lam, c, growth_end, s)["wait"] <= WAIT_TARGET_MIN), installed + 12)

    # how wrong can the assumed exam duration be?
    sens = []
    for sm in (20, 25, 30, 35, 40, 45):
        e0, e1 = evaluate(lam, installed, 0, sm), evaluate(lam, installed, growth_end, sm)
        sens.append({"service_min": sm, "wait_now": r(e0["wait"], 1), "wait_end": r(e1["wait"], 1), "headroom": r(headroom(lam, installed, sm), 0),
                     "rooms_end": next((c for c in range(1, installed + 12) if evaluate(lam, c, growth_end, sm)["wait"] <= WAIT_TARGET_MIN), installed + 12)})
    return {"installed": installed, "service_min": s, "growth_end": r(growth_end, 1), "per_day_now": r(now, 1), "per_day_end": r(end, 1), "grid": grid, "need": need,
            "headroom": head, "headroom_installed": head[str(installed)], "path": path, "crossing_month": cross, "rooms_end": int(rooms_end),
            "rooms_extra": int(rooms_end - installed), "sens": sens, "peak_lambda": r(lam.max(), 1)}


def run(t8):
    out = {"params": {"growth": GROWTH, "wait_target_min": WAIT_TARGET_MIN, "util_limit": UTIL_LIMIT}, "sites": {}}
    for f in FACILITIES:
        print("T9", f)
        out["sites"][f] = site(f, t8)
        s = out["sites"][f]
        print("   headroom", s["headroom_installed"], "% crossing", s["crossing_month"], "rooms_end", s["rooms_end"], "installed", s["installed"])
    return out
