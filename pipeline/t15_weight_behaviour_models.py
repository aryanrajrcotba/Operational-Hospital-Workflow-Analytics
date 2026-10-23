"""T15 - Behavioural factors behind body weight in adults, part 2: model the complexity, then check the model against the truth.

Because the data are simulated (behaviour_data.py), every claim can be audited: does a more flexible model fit better, do its
variable rankings match the true mechanism, does it recover the U-shape and the interaction, does it get the effect of an
intervention right?  Evaluation is 5-fold cross-validation (regression) with a held-out 25 % for the audits.
"""
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LassoCV, LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import KFold, cross_val_predict, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, PolynomialFeatures, StandardScaler
from scipy.stats import spearmanr

from .behaviour_data import EFFECT, FEATURES, LABEL, TRANSPORT, make_data, true_bmi
from .utils import r

NUM = [c for c in FEATURES if c != "transport"]


def lin_prep(poly=False):
    ct = ColumnTransformer([("n", StandardScaler(), NUM), ("t", OneHotEncoder(drop="first", categories=[TRANSPORT]), ["transport"])])
    return make_pipeline(ct, PolynomialFeatures(2, interaction_only=True, include_bias=False), StandardScaler()) if poly else ct


def tree_prep():
    return ColumnTransformer([("n", "passthrough", NUM), ("t", OrdinalEncoder(categories=[TRANSPORT]), ["transport"])])


def models():
    return {"Linear (main effects)": make_pipeline(lin_prep(), LinearRegression()),
            "Linear + all pairwise products (ridge)": make_pipeline(lin_prep(True), Ridge(alpha=300)),
            "Lasso (main effects)": make_pipeline(lin_prep(), LassoCV(cv=4, random_state=0)),
            "Random forest": make_pipeline(tree_prep(), RandomForestRegressor(300, min_samples_leaf=5, n_jobs=-1, random_state=0)),
            "Gradient boosting": make_pipeline(tree_prep(), HistGradientBoostingRegressor(max_iter=300, learning_rate=0.04, max_leaf_nodes=8, min_samples_leaf=20, random_state=0))}


def r2(y, p):
    return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()


def perm_importance(model, X, y, cols, reps=5, seed=0):
    g = np.random.RandomState(seed)
    base = r2(y, model.predict(X))
    out = {}
    for c in cols:
        drops = []
        for _ in range(reps):
            Xp = X.copy()
            Xp[c] = g.permutation(Xp[c].values)
            drops.append(base - r2(y, model.predict(Xp)))
        out[c] = float(np.mean(drops))
    return out


def true_importance(X, cols, seed=0):
    f = true_bmi(X).values
    g = np.random.RandomState(seed)
    out = {}
    for c in cols:
        v = []
        for _ in range(5):
            Xp = X.copy()
            Xp[c] = g.permutation(Xp[c].values)
            v.append(((true_bmi(Xp).values - f) ** 2).mean() / f.var())
        out[c] = float(np.mean(v))
    return out


def run():
    d = make_data(4000, seed=0)
    X, y = d[FEATURES], d.bmi.values
    kf = KFold(5, shuffle=True, random_state=0)
    ms = models()
    cv = []
    for name, m in ms.items():
        p = cross_val_predict(m, X, y, cv=kf)
        cv.append({"name": name, "r2": r(r2(y, p), 3), "rmse": r(np.sqrt(((y - p) ** 2).mean()), 2), "mae": r(np.abs(y - p).mean(), 2)})
    # best possible: the true noiseless function
    ceiling = r2(y, true_bmi(d).values - true_bmi(d).mean() + y.mean())
    Xtr, Xte, ytr, yte, dtr, dte = train_test_split(X, y, d, test_size=0.25, random_state=1)
    fit = {k: m.fit(Xtr, ytr) for k, m in ms.items()}
    gb, lin = fit["Gradient boosting"], fit["Linear (main effects)"]

    # variable importance vs the truth
    pi_gb = perm_importance(gb, Xte, yte, FEATURES)
    pi_lin = perm_importance(lin, Xte, yte, FEATURES)
    truth = true_importance(Xte, FEATURES)
    imp = [{"f": c, "label": LABEL[c], "truth": r(truth[c] * 100, 1), "gb": r(pi_gb[c] * 100, 1), "linear": r(pi_lin[c] * 100, 1), "effect": EFFECT.get(c, "")} for c in FEATURES]
    imp.sort(key=lambda t: -t["truth"])
    rho = {"gb": r(spearmanr([truth[c] for c in FEATURES], [pi_gb[c] for c in FEATURES])[0], 2), "linear": r(spearmanr([truth[c] for c in FEATURES], [pi_lin[c] for c in FEATURES])[0], 2)}
    top5 = set(sorted(truth, key=truth.get)[-5:])
    overlap = {"gb": len(top5 & set(sorted(pi_gb, key=pi_gb.get)[-5:])), "linear": len(top5 & set(sorted(pi_lin, key=pi_lin.get)[-5:]))}

    # partial dependence: model vs truth
    pdp = {}
    for c, grid in (("sleep_hrs", np.linspace(4.5, 9.5, 11)), ("activity_hrs_week", np.linspace(0, 8, 9)), ("screen_hrs_day", np.linspace(0, 10, 11)), ("age", np.linspace(20, 70, 11)), ("water_l_day", np.linspace(1, 3, 5))):
        rows = {"x": [r(v, 2) for v in grid], "gb": [], "linear": [], "truth": []}
        for v in grid:
            Xv = Xte.copy(); Xv[c] = v
            rows["gb"].append(r(gb.predict(Xv).mean(), 2)); rows["linear"].append(r(lin.predict(Xv).mean(), 2)); rows["truth"].append(r(true_bmi(Xv).mean() - true_bmi(Xte).mean() + yte.mean(), 2))
        pdp[c] = {"label": LABEL[c], **rows}

    # interaction: high-calorie food x exercise, and sex x age. mean predicted effect of high_cal_food at each activity level
    inter = []
    for lo, hi, lab in ((0, 2, "< 2 h/week"), (2, 4, "2-4 h/week"), (4, 11, "4+ h/week")):
        m = ((Xte.activity_hrs_week >= lo) & (Xte.activity_hrs_week < hi)).values
        eff = {}
        for k, mod in (("gb", gb), ("linear", lin)):
            a, b = Xte[m].copy(), Xte[m].copy(); a["high_cal_food"], b["high_cal_food"] = 1, 0
            eff[k] = r((mod.predict(a) - mod.predict(b)).mean(), 2)
        a, b = Xte[m].copy(), Xte[m].copy(); a["high_cal_food"], b["high_cal_food"] = 1, 0
        eff["truth"] = r((true_bmi(a) - true_bmi(b)).mean(), 2)
        inter.append({"band": lab, "n": int(m.sum()), **eff})
    # does adding a product term to the main-effect linear model help?  CV R2 gain for candidate pairs
    base = r2(y, cross_val_predict(make_pipeline(lin_prep(), LinearRegression()), X, y, cv=kf))
    pairs = []
    cand = ["high_cal_food", "activity_hrs_week", "male", "age", "family_history", "screen_hrs_day", "snacking", "veg_freq", "stress", "sleep_hrs", "water_l_day"]
    Xz = X.copy()
    for i, a in enumerate(cand):
        for b in cand[:i]:
            Xz["_p"] = (X[a] - X[a].mean()) * (X[b] - X[b].mean())
            ct = ColumnTransformer([("n", StandardScaler(), NUM + ["_p"]), ("t", OneHotEncoder(drop="first", categories=[TRANSPORT]), ["transport"])])
            p = cross_val_predict(make_pipeline(ct, LinearRegression()), Xz, y, cv=kf)
            pairs.append({"a": LABEL[a], "b": LABEL[b], "gain": r((r2(y, p) - base) * 100, 2)})
    pairs.sort(key=lambda t: -t["gain"])

    # mediation: stress -> snacking -> BMI
    def coef(cols, target):
        Z = np.c_[np.ones(len(d)), d[cols].values.astype(float)]
        return np.linalg.lstsq(Z, target, rcond=None)[0]
    ctrl = ["age", "male", "family_history", "sleep_hrs"]
    total = coef(["stress"] + ctrl, y)[1]
    direct = coef(["stress", "snacking"] + ctrl, y)[1]
    a_path = coef(["stress"] + ctrl, d.snacking.values.astype(float))[1]
    b_path = coef(["stress", "snacking"] + ctrl, y)[2]
    med = {"total": r(total, 3), "direct": r(direct, 3), "a": r(a_path, 3), "b": r(b_path, 3), "indirect": r(a_path * b_path, 3), "share": r(a_path * b_path / total * 100, 0), "controls": [LABEL[c] for c in ctrl]}

    # interventions: model-implied vs true average change in BMI
    iv = []
    def apply(X0, spec):
        X1 = X0.copy()
        for c, fn in spec.items():
            X1[c] = fn(X1[c])
        return X1
    for name, spec in (("No frequent high-calorie food", {"high_cal_food": lambda s: s * 0}), ("+2 h exercise per week", {"activity_hrs_week": lambda s: np.minimum(s + 2, 10)}),
                       ("Screen time capped at 3 h/day", {"screen_hrs_day": lambda s: np.minimum(s, 3)}), ("Vegetables at every meal (level 3)", {"veg_freq": lambda s: s * 0 + 3}),
                       ("Sleep moved to 7.5 h", {"sleep_hrs": lambda s: s * 0 + 7.5}), ("Drink 3 L water/day", {"water_l_day": lambda s: s * 0 + 3.0}), ("Stress reduced by 2 points", {"stress": lambda s: np.maximum(s - 2, 0)})):
        X1 = apply(Xte, spec)
        iv.append({"name": name, "truth": r((true_bmi(X1) - true_bmi(Xte)).mean(), 2), "gb": r((gb.predict(X1) - gb.predict(Xte)).mean(), 2), "linear": r((lin.predict(X1) - lin.predict(Xte)).mean(), 2)})

    # subgroup performance
    pg = gb.predict(Xte)
    groups = []
    for lab, m in (("Women", Xte.male == 0), ("Men", Xte.male == 1), ("Under 35", Xte.age < 35), ("35-55", (Xte.age >= 35) & (Xte.age < 55)), ("55+", Xte.age >= 55), ("Sleep < 6 h", Xte.sleep_hrs < 6), ("Obese (BMI 30+)", pd.Series(yte >= 30, index=Xte.index))):
        m = np.asarray(m)
        groups.append({"group": lab, "n": int(m.sum()), "mae": r(np.abs(yte[m] - pg[m]).mean(), 2), "bias": r((pg[m] - yte[m]).mean(), 2)})

    # sample size: linear vs boosting
    curve = []
    for n in (200, 400, 800, 1600, 3000):
        sc = {"n": n}
        for k in ("Linear (main effects)", "Gradient boosting"):
            idx = np.random.RandomState(n).choice(len(Xtr), min(n, len(Xtr)), replace=False)
            m = models()[k].fit(Xtr.iloc[idx], ytr[idx])
            sc["linear" if k.startswith("Linear") else "gb"] = r(r2(yte, m.predict(Xte)), 3)
        curve.append(sc)

    # classification of obesity (BMI >= 30)
    yc = (y >= 30).astype(int)
    Xc_tr, Xc_te, yc_tr, yc_te = train_test_split(X, yc, test_size=0.25, random_state=1, stratify=yc)
    clf = {"Logistic regression": make_pipeline(lin_prep(), LogisticRegression(max_iter=2000, C=1.0)),
           "Gradient boosting": make_pipeline(tree_prep(), HistGradientBoostingClassifier(max_iter=250, learning_rate=0.05, max_leaf_nodes=8, min_samples_leaf=20, random_state=0))}
    auc = [{"name": k, "auc": r(roc_auc_score(yc_te, m.fit(Xc_tr, yc_tr).predict_proba(Xc_te)[:, 1]), 3)} for k, m in clf.items()]
    # regression predictions turned into an obesity flag
    reg_auc = r(roc_auc_score(yc_te, gb.predict(Xc_te)), 3) if len(Xc_te) == len(Xte) else None
    # honest note: tiny in-sample vs CV gap
    return {"n": len(d), "obese_share": r(yc.mean() * 100, 1), "cv": cv, "ceiling_r2": r(ceiling, 3), "importance": imp, "rank_corr": rho, "top5_overlap": overlap, "pdp": pdp, "interaction": inter, "pair_gain": pairs[:8],
            "base_r2": r(base, 3), "mediation": med, "interventions": iv, "subgroups": groups, "curve": curve, "classification": auc, "effects": EFFECT, "held_out": int(len(Xte))}
