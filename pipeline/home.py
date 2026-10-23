"""Home workspace: exports the small models the Home tab runs in the browser (no server needed).

 * report reader: lexicon (anatomy / finding terms) + naive-Bayes exam-type model trained on synthetic reports
 * lifestyle what-if: linear model of BMI with a sleep curve and a food x exercise term, fitted on the simulated survey
"""
import numpy as np
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.model_selection import cross_val_predict
from sklearn.linear_model import LinearRegression
from sklearn.naive_bayes import MultinomialNB

from .behaviour_data import LABEL, make_data
from .clinical_text import ABBREV, ANAT, CATEGORIES, FIND, GEN_ANAT, GEN_FIND, make_reports
from .utils import r

FEATS = ["age", "male", "family_history", "high_cal_food", "veg_freq", "snacking", "activity_hrs_week", "screen6", "sleep_sq", "favc_inactive", "alcohol", "smoker", "calorie_monitor", "stress"]


def design(d):
    X = d[["age", "male", "family_history", "high_cal_food", "veg_freq", "snacking", "activity_hrs_week", "alcohol", "smoker", "calorie_monitor", "stress"]].copy()
    X["screen6"] = np.minimum(d.screen_hrs_day, 6)
    X["sleep_sq"] = (d.sleep_hrs - 7.5) ** 2
    X["favc_inactive"] = d.high_cal_food * (d.activity_hrs_week < 2)
    return X[FEATS]


def run():
    reps = make_reports(3000, seed=5)
    texts = [d["text"] for d in reps]
    y = np.array([CATEGORIES.index(d["category"]) for d in reps])
    cv = CountVectorizer(min_df=3, token_pattern=r"[a-z][a-z\-]+")
    X = cv.fit_transform(texts)
    nb = MultinomialNB(alpha=0.5).fit(X, y)
    acc = float(np.mean(cross_val_predict(MultinomialNB(alpha=0.5), X, y, cv=5) == y))
    anat = sorted({a for c in ANAT.values() for a in c} | set(GEN_ANAT) | set(ABBREV.values()))
    find = sorted({f for c in FIND.values() for f in c} | set(GEN_FIND))
    text = {"categories": CATEGORIES, "vocab": cv.get_feature_names_out().tolist(), "logprior": [r(v, 3) for v in nb.class_log_prior_], "logprob": [[r(v, 3) for v in row] for row in nb.feature_log_prob_],
            "anatomy": anat, "findings": find, "cv_accuracy": r(acc * 100, 1), "examples": [reps[i]["text"] for i in (0, 1, 2, 3, 4) if True][:4]}
    d = make_data(4000, seed=0)
    D = design(d)
    m = LinearRegression().fit(D, d.bmi)
    pred = cross_val_predict(LinearRegression(), D, d.bmi, cv=5)
    r2 = 1 - ((d.bmi - pred) ** 2).sum() / ((d.bmi - d.bmi.mean()) ** 2).sum()
    weight = {"features": FEATS, "coef": [r(v, 4) for v in m.coef_], "intercept": r(m.intercept_, 3), "ref": {f: r(D[f].mean(), 3) for f in FEATS}, "resid_sd": r(np.std(d.bmi - m.predict(D)), 2), "cv_r2": r(r2, 3), "n": len(d),
              "labels": {**LABEL, "screen6": "Screen time (h/day, capped at 6)", "sleep_sq": "Sleep away from 7.5 h (squared)", "favc_inactive": "High-calorie food while exercising < 2 h/week"}}
    return {"text": text, "weight": weight}
