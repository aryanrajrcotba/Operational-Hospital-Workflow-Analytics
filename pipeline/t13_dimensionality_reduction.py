"""T13 - Dimensionality reduction for exploratory data analysis.

Each exam is a point in ~60-75 dimensions (queue state, flow, history, calendar).  Which low-dimensional picture is
trustworthy?  Per site, on a random sample of 2,500 exams: PCA (variance, loadings), random projection, kernel PCA,
Isomap, t-SNE.  Maps are scored by how well they keep each point's nearest neighbours (trustworthiness: no false
neighbours; continuity: no lost neighbours) and by how much of the wait-time signal survives in 2-D.  A modelling
check asks how many principal components a ridge model needs to predict wait on a later period.
"""
import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.decomposition import KernelPCA, PCA
from sklearn.linear_model import Ridge
from sklearn.manifold import TSNE, Isomap, trustworthiness
from sklearn.model_selection import KFold, cross_val_predict
from sklearn.neighbors import KNeighborsRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.random_projection import GaussianRandomProjection

from .config import FACILITIES, PROCESSED
from .ops import TRAIN_FRACTION
from .t7_staffing import LEAKS
from .utils import r

N = 2500
K = 10


def sample_site(f):
    d = pd.read_csv(PROCESSED / f"{f}_clean.csv.gz", parse_dates=["arrival_dttm"]).sort_values("arrival_dttm")
    d = d.iloc[np.sort(np.random.RandomState(0).choice(len(d), N, replace=False))].reset_index(drop=True)
    y = d.wait_min.values.astype(float)
    hour = d.arrival_dttm.dt.hour.values
    X = d.drop(columns=[c for c in d.columns if c in LEAKS]).select_dtypes("number")
    X = X.loc[:, X.nunique() > 1]
    X = X.fillna(X.median())
    return X, y, hour


def knn_r2(Z, y):
    p = cross_val_predict(KNeighborsRegressor(15), Z, y, cv=KFold(5, shuffle=True, random_state=0))
    return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()


def site(f):
    X, y, hour = sample_site(f)
    cols = list(X.columns)
    S = StandardScaler().fit_transform(X)
    S = np.clip(S, -6, 6)                                         # heavy tails would otherwise dominate distances
    pca_full = PCA(random_state=0).fit(S)
    ev = pca_full.explained_variance_ratio_
    cum = np.cumsum(ev)
    Zp = pca_full.transform(S)[:, :2]
    load = pca_full.components_[:2]
    pcs = [{"pc": k + 1, "var": r(ev[k] * 100, 1), "top": [{"col": cols[j], "w": r(load[k][j], 3)} for j in np.argsort(-np.abs(load[k]))[:8]]} for k in range(2)]

    emb = {"PCA": Zp,
           "Random projection": GaussianRandomProjection(2, random_state=0).fit_transform(S),
           "Kernel PCA (RBF)": KernelPCA(2, kernel="rbf", gamma=1.0 / S.shape[1], random_state=0).fit_transform(S),
           "Isomap (15 neighbours)": Isomap(n_neighbors=15, n_components=2).fit_transform(S),
           "t-SNE (perplexity 30)": TSNE(2, perplexity=30, init="pca", random_state=0, learning_rate="auto").fit_transform(S)}
    scores = []
    sub = np.random.RandomState(1).choice(N, 900, replace=False)
    pts = {}
    full_r2 = knn_r2(S, y)
    for name, Z in emb.items():
        Zs = (Z - Z.mean(0)) / (Z.std(0) + 1e-9)
        scores.append({"name": name, "trust": r(trustworthiness(S, Zs, n_neighbors=K), 3), "cont": r(trustworthiness(Zs, S, n_neighbors=K), 3), "wait_r2": r(knn_r2(Zs, y), 3),
                       "rho1": r(abs(spearmanr(Zs[:, 0], y)[0]), 2), "rho2": r(abs(spearmanr(Zs[:, 1], y)[0]), 2)})
        pts[name] = {"x": [r(v, 2) for v in Zs[sub, 0]], "y": [r(v, 2) for v in Zs[sub, 1]]}
    qy = np.digitize(y, np.quantile(y, [0.25, 0.5, 0.75]))
    # modelling check: PCA fitted on the early 70 %, ridge on k components, scored on the later 30 %
    cut = int(N * TRAIN_FRACTION)
    sc = StandardScaler().fit(X.iloc[:cut])
    A, B = np.clip(sc.transform(X.iloc[:cut]), -6, 6), np.clip(sc.transform(X.iloc[cut:]), -6, 6)
    pc = PCA(random_state=0).fit(A)
    curve = []
    for k in (1, 2, 3, 5, 8, 12, 20, 30, S.shape[1]):
        k = min(k, A.shape[1])
        m = Ridge(alpha=10).fit(pc.transform(A)[:, :k], y[:cut])
        curve.append({"k": int(k), "mae": r(np.abs(m.predict(pc.transform(B)[:, :k]) - y[cut:]).mean(), 2), "var": r(np.cumsum(pc.explained_variance_ratio_)[k - 1] * 100, 1)})
    base = r(np.abs(y[cut:] - y[:cut].mean()).mean(), 2)
    return {"n": N, "dims": len(cols), "knn_r2_full": r(full_r2, 3), "scree": [r(v * 100, 2) for v in ev[:20]], "cum": [r(v * 100, 1) for v in cum[:20]],
            "k90": int(np.searchsorted(cum, 0.90) + 1), "k95": int(np.searchsorted(cum, 0.95) + 1), "pcs": pcs, "scores": scores, "points": pts, "wait_bin": qy[sub].tolist(), "hour": hour[sub].tolist(),
            "wait_quartiles": [r(v, 1) for v in np.quantile(y, [0.25, 0.5, 0.75])], "curve": curve, "mean_baseline_mae": base}


def run():
    out = {"params": {"sample": N, "neighbours": K}, "sites": {}}
    for f in FACILITIES:
        print("T13", f)
        out["sites"][f] = site(f)
        s = out["sites"][f]
        print("   dims", s["dims"], "k90", s["k90"], [(x["name"][:8], x["trust"], x["wait_r2"]) for x in s["scores"]])
    return out
