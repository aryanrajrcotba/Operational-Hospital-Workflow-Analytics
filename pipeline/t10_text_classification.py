"""T10 - Classification and clustering of clinical text.

Task A (supervised): predict the exam category (7 classes) from the report text.
Task B (supervised): predict normal vs abnormal.  Negation makes this harder than it looks: "no pneumothorax"
and "pneumothorax" share their key word, so bag-of-words must be given context (n-grams, negation tags).
Task C (unsupervised): cluster the reports without labels and compare the clusters with the true categories.
Training uses a random 70 % of reports, evaluation the other 30 %.
"""
import re

import numpy as np
from sklearn.cluster import AgglomerativeClustering, KMeans
from sklearn.decomposition import NMF, TruncatedSVD
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, adjusted_rand_score, confusion_matrix, f1_score, normalized_mutual_info_score, silhouette_score
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import ComplementNB, MultinomialNB
from sklearn.svm import LinearSVC

from .clinical_text import CATEGORIES, make_reports
from .utils import r

N_REPORTS = 3000
NEG_CUE = re.compile(r"\b(no|without|negative|unremarkable|normal)\b", re.I)
STOP = {"the", "of", "in", "is", "a", "with", "and", "there", "to", "at", "for", "an"}


def tag_negation(text):
    """Prefix NEG_ to the words in the same sentence after a negation cue (a crude NegEx)."""
    out = []
    for sent in re.split(r"(?<=[.;:])\s+", text):
        neg = False
        for w in re.findall(r"[A-Za-z][A-Za-z\-]*|[.;:]", sent):
            wl = w.lower()
            if NEG_CUE.fullmatch(wl):
                neg = True
                out.append(wl)
            elif neg and wl not in STOP and w not in ".;:":
                out.append("NEG_" + wl)
            else:
                out.append(wl)
    return " ".join(out)


def run():
    reps = make_reports(N_REPORTS, seed=0)
    texts = [d["text"] for d in reps]
    cats = np.array([CATEGORIES.index(d["category"]) for d in reps])
    abn = np.array([d["abnormal"] for d in reps])
    idx = np.arange(len(reps))
    tr, te = train_test_split(idx, test_size=0.3, random_state=0, stratify=cats)
    T = np.array(texts, dtype=object)
    tagged = np.array([tag_negation(t) for t in texts], dtype=object)

    feats = {
        "Word counts (unigrams)": (lambda: CountVectorizer(lowercase=True, min_df=2), T),
        "TF-IDF unigrams": (lambda: TfidfVectorizer(min_df=2, sublinear_tf=True), T),
        "TF-IDF 1-2 grams": (lambda: TfidfVectorizer(min_df=2, ngram_range=(1, 2), sublinear_tf=True), T),
        "TF-IDF + negation tags": (lambda: TfidfVectorizer(min_df=2, sublinear_tf=True, lowercase=False, token_pattern=r"[A-Za-z_\-]+"), tagged),
    }
    models = {
        "Multinomial naive Bayes": lambda: MultinomialNB(alpha=0.3),
        "Complement naive Bayes": lambda: ComplementNB(alpha=0.3),
        "Logistic regression": lambda: LogisticRegression(max_iter=1000, C=8),
        "Linear SVM": lambda: LinearSVC(C=1.0),
    }
    res = {"category": [], "abnormal": []}
    keep = {}
    for fname, (mk, X) in feats.items():
        vec = mk().fit(X[tr])
        Xtr, Xte = vec.transform(X[tr]), vec.transform(X[te])
        for mname, mm in models.items():
            for task, y in (("category", cats), ("abnormal", abn)):
                m = mm().fit(Xtr, y[tr])
                p = m.predict(Xte)
                res[task].append({"features": fname, "model": mname, "acc": r(accuracy_score(y[te], p) * 100, 1), "f1": r(f1_score(y[te], p, average="macro") * 100, 1)})
                keep[(task, fname, mname)] = (m, vec, p)

    # error analysis for the best category model + the abnormal task with plain vs negation-aware features
    best_c = max(res["category"], key=lambda x: x["f1"])
    _, _, pc = keep[("category", best_c["features"], best_c["model"])]
    cm = confusion_matrix(cats[te], pc, labels=range(len(CATEGORIES)))
    wrong = [i for i in range(len(te)) if pc[i] != cats[te][i]][:4]
    errors = [{"text": texts[te[i]][:420], "true": CATEGORIES[cats[te][i]], "pred": CATEGORIES[pc[i]]} for i in wrong]
    best_a = max(res["abnormal"], key=lambda x: x["f1"])
    plain_a = next(x for x in res["abnormal"] if x["features"] == "TF-IDF unigrams" and x["model"] == "Logistic regression")

    # which words drive "abnormal" under plain vs negation-tagged features
    def top_coef(fname, mname, k=9):
        m, vec, _ = keep[("abnormal", fname, mname)]
        names = np.array(vec.get_feature_names_out()); c = m.coef_[0]
        o = np.argsort(c)
        return {"abnormal": names[o[::-1][:k]].tolist(), "normal": names[o[:k]].tolist()}
    drivers = {"plain": top_coef("TF-IDF unigrams", "Logistic regression"), "negation": top_coef("TF-IDF + negation tags", "Logistic regression")}

    # learning curve: accuracy vs labelled reports (best category model type, TF-IDF 1-2 grams + LR)
    curve = []
    vec = TfidfVectorizer(min_df=1, ngram_range=(1, 2), sublinear_tf=True).fit(T[tr])
    Xte = vec.transform(T[te])
    rng = np.random.RandomState(0)
    for n in (20, 50, 100, 200, 500, 1000, len(tr)):
        accs = []
        for rep in range(3):
            sub = rng.choice(tr, n, replace=False)
            if len(set(cats[sub])) < len(CATEGORIES):
                sub = np.r_[sub, [np.where(cats == c)[0][0] for c in range(len(CATEGORIES))]]
            m = LogisticRegression(max_iter=1000, C=8).fit(vec.transform(T[sub]), cats[sub])
            accs.append(accuracy_score(cats[te], m.predict(Xte)))
        curve.append({"n": int(n), "acc": r(np.mean(accs) * 100, 1)})

    # ----- clustering (no labels): TF-IDF -> truncated SVD -> k-means / agglomerative; NMF topics
    vec = TfidfVectorizer(min_df=2, sublinear_tf=True, stop_words="english")
    Xall = vec.fit_transform(T)
    terms = np.array(vec.get_feature_names_out())
    svd = TruncatedSVD(40, random_state=0)
    Z = svd.fit_transform(Xall)
    Zn = Z / np.maximum(np.linalg.norm(Z, axis=1, keepdims=True), 1e-9)

    def purity(lab):
        return sum(np.bincount(cats[lab == c], minlength=len(CATEGORIES)).max() for c in np.unique(lab)) / len(cats)
    sweep = []
    for k in range(2, 13):
        lab = KMeans(k, n_init=5, random_state=0).fit_predict(Zn)
        sweep.append({"k": k, "silhouette": r(silhouette_score(Zn, lab, sample_size=1500, random_state=0), 3), "ari": r(adjusted_rand_score(cats, lab), 3), "purity": r(purity(lab) * 100, 1)})
    K = len(CATEGORIES)
    km_raw = KMeans(K, n_init=5, random_state=0).fit_predict(Xall)
    km = KMeans(K, n_init=10, random_state=0).fit(Zn)
    ag = AgglomerativeClustering(K, linkage="ward").fit_predict(Zn)
    nmf = NMF(K, init="nndsvda", random_state=0, max_iter=400).fit(Xall)
    nm = nmf.transform(Xall).argmax(1)
    cl_models = []
    for name, lab in (("k-means on raw TF-IDF", km_raw), ("k-means on SVD (40 dims)", km.labels_), ("Ward agglomerative on SVD", ag), ("NMF topics (argmax)", nm)):
        cl_models.append({"name": name, "ari": r(adjusted_rand_score(cats, lab), 3), "nmi": r(normalized_mutual_info_score(cats, lab), 3), "purity": r(purity(lab) * 100, 1)})
    lab = km.labels_
    centers = np.asarray(svd.inverse_transform(km.cluster_centers_))
    clusters = []
    for c in range(K):
        mem = lab == c
        dist = np.bincount(cats[mem], minlength=K)
        top = terms[np.argsort(-centers[c])[:8]].tolist()
        clusters.append({"id": c, "size": int(mem.sum()), "top_terms": top, "mix": dist.tolist(), "main": CATEGORIES[int(dist.argmax())], "purity": r(dist.max() / dist.sum() * 100, 1)})
    # 2-D view
    sv2 = TruncatedSVD(2, random_state=0).fit_transform(Xall)
    sub = np.random.RandomState(1).choice(len(texts), 700, replace=False)
    scatter = {"x": [r(v, 3) for v in sv2[sub, 0]], "y": [r(v, 3) for v in sv2[sub, 1]], "true": cats[sub].tolist(), "cluster": lab[sub].tolist()}
    return {
        "n_reports": len(reps), "n_train": int(len(tr)), "n_test": int(len(te)), "categories": CATEGORIES, "abnormal_rate": r(abn.mean() * 100, 1),
        "vocab": int(len(terms)), "mean_tokens": r(np.mean([len(t.split()) for t in texts]), 1),
        "examples": [{"category": reps[i]["category"], "abnormal": reps[i]["abnormal"], "text": reps[i]["text"]} for i in (0, 1, 2)],
        "feature_names": list(feats), "model_names": list(models), "results": res, "best_category": best_c, "best_abnormal": best_a, "plain_abnormal": plain_a,
        "confusion": cm.tolist(), "errors": errors, "drivers": drivers, "learning_curve": curve,
        "clustering": {"k_sweep": sweep, "models": cl_models, "clusters": clusters, "scatter": scatter, "chosen_k": K},
    }
