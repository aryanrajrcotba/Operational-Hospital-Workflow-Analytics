"""T14 - Behavioural factors behind body weight in adults, part 1: look before you model.

Distribution of BMI, the crude association of every behaviour with BMI, the same association after adjusting for age,
sex, family history and income (confounding), shapes that a single correlation hides (U-shapes, saturation), joint
patterns (interaction), and how tangled the predictors are with each other.
"""
import numpy as np
import pandas as pd
from sklearn.feature_selection import mutual_info_regression
from scipy.stats import spearmanr

from .behaviour_data import BINARY, FEATURES, LABEL, NUMERIC, TRANSPORT, make_data
from .utils import r

ADJUST = ["age", "male", "family_history", "income_band"]
CAT = ["Underweight (<18.5)", "Normal (18.5-25)", "Overweight (25-30)", "Obese (30+)"]


def categorize(b):
    return np.digitize(b, [18.5, 25, 30])


def ols(X, y):
    X = np.c_[np.ones(len(X)), X]
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    res = y - X @ beta
    s2 = res @ res / (len(y) - X.shape[1])
    cov = s2 * np.linalg.inv(X.T @ X)
    return beta, np.sqrt(np.diag(cov))


def run():
    d = make_data(4000, seed=0)
    n = len(d)
    y = d.bmi.values
    bins = np.arange(14, 51, 1.0)
    h, _ = np.histogram(np.clip(y, 14, 49.99), bins)
    cats = categorize(y)
    by_sex = {s: [r(np.mean(cats[d.male == v] == k) * 100, 1) for k in range(4)] for s, v in (("Female", 0), ("Male", 1))}

    # --- factor table: crude vs adjusted effect per 1 SD (or vs reference group)
    rows = []
    mi = mutual_info_regression(pd.get_dummies(d[FEATURES], columns=["transport"]).astype(float).values, y, random_state=0, n_neighbors=5)
    mi_cols = list(pd.get_dummies(d[FEATURES], columns=["transport"]).columns)
    mi_of = {}
    for f in FEATURES:
        mi_of[f] = float(max(m for c, m in zip(mi_cols, mi) if c == f or c.startswith(f + "_")))
    for f in FEATURES:
        if f == "transport":
            continue
        x = d[f].values.astype(float)
        sd = x.std()
        z = (x - x.mean()) / sd
        crude, cse = ols(z.reshape(-1, 1), y)
        adj_cols = [c for c in ADJUST if c != f]
        Xa = np.c_[z, d[adj_cols].values.astype(float)] if adj_cols else z.reshape(-1, 1)
        adj, ase = ols(Xa, y)
        rows.append({"f": f, "label": LABEL[f], "kind": "binary" if f in BINARY else "numeric", "crude": r(crude[1], 2), "crude_se": r(cse[1], 2), "adj": r(adj[1], 2), "adj_se": r(ase[1], 2),
                     "pearson": r(np.corrcoef(x, y)[0, 1], 3), "spearman": r(spearmanr(x, y)[0], 3), "mi": r(mi_of[f], 3)})
    # transport: mean BMI by group, crude and adjusted for age/sex/family/income + activity-independent
    tr_rows = []
    D = pd.get_dummies(d.transport)[TRANSPORT[1:]].astype(float)
    Xc = D.values
    beta_c, se_c = ols(Xc, y)
    Xa = np.c_[Xc, d[ADJUST].values.astype(float)]
    beta_a, se_a = ols(Xa, y)
    for i, t in enumerate(TRANSPORT):
        tr_rows.append({"group": t, "n": int((d.transport == t).sum()), "mean_bmi": r(y[d.transport == t].mean(), 2),
                        "crude_vs_car": None if i == 0 else r(beta_c[i], 2), "adj_vs_car": None if i == 0 else r(beta_a[i], 2), "adj_se": None if i == 0 else r(se_a[i], 2),
                        "crude_se": None if i == 0 else r(se_c[i], 2)})
    # activity-adjusted transport (does transport still matter once exercise is known?)
    Xb = np.c_[Xc, d[ADJUST + ["activity_hrs_week"]].values.astype(float)]
    beta_b, _ = ols(Xb, y)
    for i, t in enumerate(TRANSPORT):
        tr_rows[i]["adj_activity_vs_car"] = None if i == 0 else r(beta_b[i], 2)

    # --- shapes: mean BMI by bins of a continuous factor
    shapes = {}
    for f, edges in (("sleep_hrs", [4, 5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 10.01]), ("screen_hrs_day", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12.01]), ("activity_hrs_week", [0, 1, 2, 3, 4, 5, 6, 8, 10.01]),
                     ("age", [18, 25, 30, 35, 40, 45, 50, 55, 60, 65, 75.01]), ("stress", [0, 2, 3, 4, 5, 6, 7, 8, 10.01]), ("water_l_day", [0.5, 1.2, 1.6, 2.0, 2.4, 2.8, 3.51])):
        x = d[f].values
        idx = np.digitize(x, edges[1:-1])
        pts = []
        for k in range(len(edges) - 1):
            m = idx == k
            if m.sum() >= 15:
                pts.append({"x": r(x[m].mean(), 2), "mean": r(y[m].mean(), 2), "se": r(y[m].std() / np.sqrt(m.sum()), 2), "n": int(m.sum())})
        r1 = np.corrcoef(x, y)[0, 1]
        # how much of the binned-mean variation a straight line misses
        xs = np.array([p["x"] for p in pts]); ms = np.array([p["mean"] for p in pts])
        lin = np.polyval(np.polyfit(xs, ms, 1), xs)
        shapes[f] = {"label": LABEL[f], "pts": pts, "pearson": r(r1, 3), "nonlinearity": r(1 - ((ms - lin) ** 2).sum() / max(1e-9, ((ms - ms.mean()) ** 2).sum()), 3)}
    # --- joint patterns: obesity share by exercise band x high-calorie food; mean BMI by age band x sex
    act_b = np.digitize(d.activity_hrs_week, [2, 4])
    grid = [{"act": a, "favc": int(f), "obese": r(d.obese[(act_b == a) & (d.high_cal_food == f)].mean() * 100, 1), "bmi": r(y[(act_b == a) & (d.high_cal_food == f)].mean(), 2), "n": int(((act_b == a) & (d.high_cal_food == f)).sum())} for a in range(3) for f in (0, 1)]
    age_b = np.digitize(d.age, [30, 40, 50, 60])
    age_sex = [{"band": k, "male": r(y[(age_b == k) & (d.male == 1)].mean(), 2), "female": r(y[(age_b == k) & (d.male == 0)].mean(), 2)} for k in range(5)]
    # --- predictors are entangled: correlation matrix and VIF
    num = [c for c in FEATURES if c != "transport"]
    C = d[num].corr(method="spearman").values
    Z = (d[num] - d[num].mean()) / d[num].std()
    vif = []
    for i, c in enumerate(num):
        others = np.delete(Z.values, i, axis=1)
        b, _ = ols(others, Z[c].values)
        res = Z[c].values - np.c_[np.ones(n), others] @ b
        vif.append(r(1 / max(1e-6, res.var() / Z[c].var()), 2))
    pairs = sorted([(abs(C[i, j]), num[i], num[j], C[i, j]) for i in range(len(num)) for j in range(i)], reverse=True)[:8]
    return {"n": n, "bmi_mean": r(y.mean(), 1), "bmi_sd": r(y.std(), 1), "bmi_hist": {"lo": 14, "step": 1, "counts": h.tolist()}, "categories": CAT, "cat_share": [r(np.mean(cats == k) * 100, 1) for k in range(4)], "by_sex": by_sex,
            "weight_mean": r(d.weight_kg.mean(), 1), "height_mean": r(d.height_cm.mean(), 1), "obese_share": r(d.obese.mean() * 100, 1), "factors": rows, "transport": tr_rows, "shapes": shapes, "grid": grid, "age_sex": age_sex,
            "age_bands": ["<30", "30-39", "40-49", "50-59", "60+"], "act_bands": ["< 2 h", "2-4 h", "4+ h"], "corr": {"cols": num, "labels": [LABEL[c] for c in num], "r100": [[int(round(v * 100)) for v in row] for row in C]},
            "vif": [{"f": c, "label": LABEL[c], "vif": v} for c, v in zip(num, vif)], "top_pairs": [{"a": LABEL[a], "b": LABEL[b], "r": r(c, 2)} for _, a, b, c in pairs], "adjust": [LABEL[c] for c in ADJUST]}
