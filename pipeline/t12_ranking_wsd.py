"""T12 - Ranking and word-sense disambiguation of clinical text.

Ranking, two ways:
 * documents - given a query ("pneumonia right lower lobe") rank reports; relevant = the report asserts that finding
   (present, not negated) at that site.  Boolean match, TF-IDF cosine, BM25, negation-aware BM25 and LSA are scored
   with P@10, MAP, nDCG@10.
 * terms - rank the words of one exam category by how characteristic they are: frequency, TF-IDF, chi-square, TextRank.
Word-sense disambiguation: short notes containing an ambiguous abbreviation ("MS", "PE", "cold" ...) are resolved with a
majority-sense baseline, a simplified Lesk (overlap with a dictionary gloss), naive Bayes and logistic regression.
"""
import re
from collections import defaultdict

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.feature_selection import chi2
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import MultinomialNB

from .clinical_text import ABBREV, ANAT, CATEGORIES, FIND, GEN_ANAT, GEN_FIND, SENSES, make_reports, make_wsd
from .t10_text_classification import tag_negation
from .utils import r

STOP = {"the", "of", "in", "is", "a", "with", "and", "there", "to", "at", "for", "an", "no", "was", "are", "as", "by", "on", "from", "has", "be", "or"}
TOK = re.compile(r"[a-z][a-z\-]+|\d+")


def toks(s):
    return [w for w in TOK.findall(s.lower()) if w not in STOP]


# ------------------------------------------------------------------ BM25
class BM25:
    def __init__(self, docs, k1=1.5, b=0.75):
        self.k1, self.b = k1, b
        self.tf = [defaultdict(int) for _ in docs]
        df = defaultdict(int)
        for i, d in enumerate(docs):
            for w in d:
                self.tf[i][w] += 1
            for w in set(d):
                df[w] += 1
        self.len = np.array([len(d) for d in docs], dtype=float)
        self.avg = self.len.mean()
        n = len(docs)
        self.idf = {w: np.log(1 + (n - c + 0.5) / (c + 0.5)) for w, c in df.items()}

    def score(self, q):
        s = np.zeros(len(self.tf))
        for w in set(q):
            if w not in self.idf:
                continue
            for i, t in enumerate(self.tf):
                f = t.get(w)
                if f:
                    s[i] += self.idf[w] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
        return s


def metrics(score, rel, k=10):
    order = np.argsort(-score, kind="stable")
    hit = rel[order]
    p = hit[:k].mean()
    ap = (np.cumsum(hit) / np.arange(1, len(hit) + 1) * hit).sum() / max(1, hit.sum())
    dcg = (hit[:k] / np.log2(np.arange(2, k + 2))).sum()
    ideal = (np.sort(rel)[::-1][:k] / np.log2(np.arange(2, k + 2))).sum()
    return p, ap, dcg / ideal if ideal else 0.0


def text_rank(sent_tokens, window=4, d=0.85, iters=40):
    vocab = sorted({w for s in sent_tokens for w in s})
    ix = {w: i for i, w in enumerate(vocab)}
    A = np.zeros((len(vocab), len(vocab)))
    for s in sent_tokens:
        for i, w in enumerate(s):
            for v in s[i + 1:i + window]:
                if v != w:
                    A[ix[w], ix[v]] += 1
                    A[ix[v], ix[w]] += 1
    col = A.sum(0)
    col[col == 0] = 1
    M = A / col
    pr = np.ones(len(vocab)) / len(vocab)
    for _ in range(iters):
        pr = (1 - d) / len(vocab) + d * M @ pr
    return dict(zip(vocab, pr))


def run_ranking():
    reps = make_reports(3000, seed=3)
    texts = [d["text"] for d in reps]
    docs = [toks(t) for t in texts]
    docs_neg = [toks(tag_negation(t)) for t in texts]
    # a query word counts if it appears un-negated; abbreviations are NOT expanded, which is part of the challenge
    tf = TfidfVectorizer(tokenizer=toks, lowercase=False, token_pattern=None, sublinear_tf=True).fit(texts)
    cv = CountVectorizer(tokenizer=toks, lowercase=False, token_pattern=None).fit(texts)
    Xd = tf.transform(texts)
    lsa = TruncatedSVD(100, random_state=0)
    Zd = lsa.fit_transform(Xd)
    Zd /= np.maximum(np.linalg.norm(Zd, axis=1, keepdims=True), 1e-9)
    bm = BM25(docs)
    bmn = BM25([[w for w in d] for d in docs_neg])

    # build queries
    rng = np.random.RandomState(0)
    cand = []
    pool = [(f, a) for c in CATEGORIES for f in FIND[c] for a in ANAT[c]]
    for f, a in [pool[i] for i in rng.permutation(len(pool))[:800]]:
        rel_fa = np.array([any(g["finding"] == f and g["anatomy"] == a and g["status"] == "present" for g in d["findings"]) for d in reps], dtype=int)
        if 5 <= rel_fa.sum() <= 150:
            cand.append(("finding + site", f"{f} {a}", rel_fa))
        if len(cand) >= 60:
            break
    fonly = sorted({f for c in CATEGORIES for f in FIND[c]})
    for f in [fonly[i] for i in rng.permutation(len(fonly))[:40]]:
        rel_f = np.array([any(g["finding"] == f and g["status"] == "present" for g in d["findings"]) for d in reps], dtype=int)
        if 5 <= rel_f.sum() <= 400:
            cand.append(("finding only", f, rel_f))
    cand = cand[:60] + [c for c in cand if c[0] == "finding only"][:30]
    methods = {}
    per = defaultdict(lambda: defaultdict(list))
    shown = None
    for kind, q, rel in cand:
        qt = toks(q)
        sc = {}
        sc["Boolean: count of query words"] = np.array([len(set(qt) & set(d)) for d in docs], dtype=float)
        qv = tf.transform([q])
        sc["TF-IDF cosine"] = (Xd @ qv.T).toarray().ravel()
        sc["BM25"] = bm.score(qt)
        sc["BM25 + negation tags"] = bmn.score(qt)
        zq = lsa.transform(qv)
        zq /= max(np.linalg.norm(zq), 1e-9)
        sc["LSA (100 dims)"] = Zd @ zq.ravel()
        for m, s in sc.items():
            p, ap, nd = metrics(s + 1e-9 * np.random.RandomState(1).rand(len(s)), rel)
            for key in ("all", kind):
                per[m][key].append((p, ap, nd))
        if shown is None and kind == "finding + site" and rel.sum() >= 10:
            o1, o2 = np.argsort(-sc["BM25"], kind="stable")[:5], np.argsort(-sc["BM25 + negation tags"], kind="stable")[:5]
            shown = {"query": q, "n_relevant": int(rel.sum()), "bm25": [{"text": texts[i][:260], "rel": int(rel[i])} for i in o1], "bm25neg": [{"text": texts[i][:260], "rel": int(rel[i])} for i in o2]}
    out = []
    for m, d in per.items():
        row = {"name": m}
        for key, lab in (("all", ""), ("finding + site", "_fs"), ("finding only", "_fo")):
            a = np.array(d[key])
            row["p10" + lab], row["map" + lab], row["ndcg" + lab] = (r(a[:, j].mean() * 100, 1) for j in range(3))
        out.append(row)

    # ---- term ranking per category
    cat_text = {c: " ".join(d["text"] for d in reps if d["category"] == c) for c in CATEGORIES}
    gen = {w for t in GEN_ANAT + GEN_FIND + list(ABBREV.values()) for w in toks(t)}
    gold_kw = {}
    for c in CATEGORIES:
        mine = {w for t in ANAT[c] + FIND[c] for w in toks(t)}
        others = {w for o in CATEGORIES if o != c for t in ANAT[o] + FIND[o] for w in toks(t)}
        gold_kw[c] = mine - others - gen
    names = np.array(cv.get_feature_names_out())
    Xc = cv.transform([cat_text[c] for c in CATEGORIES])
    ylab = np.array([CATEGORIES.index(d["category"]) for d in reps])
    Xdoc = cv.transform(texts)
    Xt = tf.transform(texts)                     # document-level TF-IDF (same vocabulary as cv)
    assert list(tf.get_feature_names_out()) == list(names)
    rank_scores = {k: [] for k in ("Frequency", "TF-IDF (category vs others)", "Chi-square", "TextRank")}
    examples = {}
    for ci, c in enumerate(CATEGORIES):
        freq = Xc[ci].toarray().ravel().astype(float)
        sc = {"Frequency": freq, "TF-IDF (category vs others)": np.asarray(Xt[ylab == ci].mean(0)).ravel() - np.asarray(Xt[ylab != ci].mean(0)).ravel()}
        ch, _ = chi2(Xdoc, (ylab == ci).astype(int))
        sc["Chi-square"] = np.nan_to_num(ch)
        sents = [toks(s) for d in reps if d["category"] == c for s in re.split(r"[.;:]", d["text"])][:2500]
        tr = text_rank([s for s in sents if len(s) > 1])
        sc["TextRank"] = np.array([tr.get(w, 0.0) for w in names])
        for m, s in sc.items():
            top = names[np.argsort(-s)[:10]].tolist()
            rank_scores[m].append(len(set(top) & gold_kw[c]) / 10)
            if c == "chest":
                examples[m] = top
    kw = [{"name": m, "p10": r(np.mean(v) * 100, 1), "per_category": [r(x * 100, 0) for x in v]} for m, v in rank_scores.items()]
    return {"n_docs": len(reps), "n_queries": len(cand), "queries_fs": sum(1 for c in cand if c[0] == "finding + site"), "queries_fo": sum(1 for c in cand if c[0] == "finding only"),
            "doc_ranking": out, "example": shown, "keyword_ranking": kw, "keyword_example": examples, "keyword_categories": CATEGORIES,
            "gold_kw_sizes": {c: len(gold_kw[c]) for c in CATEGORIES}}


# ------------------------------------------------------------------ WSD
def lesk(term, text, glosses, majority):
    ctx = {w[:5] for w in toks(text) if w != term.lower()}
    best, score = majority, 0
    for s, g in glosses.items():
        ov = len(ctx & {w[:5] for w in toks(g)})
        if ov > score:
            best, score = s, ov
    return best


def run_wsd():
    data = make_wsd(per_sense=140, seed=1)
    rng = np.random.RandomState(0)
    byterm = defaultdict(list)
    for d in data:
        byterm[d["term"]].append(d)
    res = defaultdict(lambda: defaultdict(list))
    curve = defaultdict(list)
    errs = []
    sizes = (3, 5, 10, 20, 50, 98)
    for term, items in byterm.items():
        idx = rng.permutation(len(items))
        cut = int(len(items) * 0.7)
        tr, te = [items[i] for i in idx[:cut]], [items[i] for i in idx[cut:]]
        senses = list(SENSES[term])
        maj = max(senses, key=lambda s: sum(d["sense"] == s for d in tr))
        gloss = {s: SENSES[term][s][0] for s in senses}
        vec = CountVectorizer(tokenizer=lambda s: [w for w in TOK.findall(s.lower()) if w != term.lower()], lowercase=False, token_pattern=None, binary=True).fit([d["text"] for d in tr])
        Xtr, Xte = vec.transform([d["text"] for d in tr]), vec.transform([d["text"] for d in te])
        ytr, yte = [d["sense"] for d in tr], [d["sense"] for d in te]
        preds = {"Majority sense": [maj] * len(te), "Simplified Lesk (gloss overlap)": [lesk(term, d["text"], gloss, maj) for d in te],
                 "Naive Bayes on context words": MultinomialNB(alpha=0.5).fit(Xtr, ytr).predict(Xte),
                 "Logistic regression on context words": LogisticRegression(max_iter=500, C=3).fit(Xtr, ytr).predict(Xte)}
        for m, p in preds.items():
            res[m][term] = float(np.mean([a == b for a, b in zip(p, yte)]) * 100)
            res[m]["_all"].extend([a == b for a, b in zip(p, yte)])
            res[m]["_n"] = len(senses)
        if len(errs) < 5:
            p = preds["Logistic regression on context words"]
            errs += [{"term": term, "text": d["text"], "gold": d["sense"], "pred": q} for d, q in zip(te, p) if d["sense"] != q][:1]
        for n in sizes:
            accs = []
            for rep in range(3):
                pick = rng.choice(len(tr), min(n * len(senses), len(tr)), replace=False)
                ys = [ytr[i] for i in pick]
                if len(set(ys)) < 2:
                    continue
                m = LogisticRegression(max_iter=500, C=3).fit(Xtr[pick], ys)
                accs.append(np.mean(m.predict(Xte) == np.array(yte)))
            curve[n].append(np.mean(accs) if accs else np.nan)
    terms = list(byterm)
    out = [{"name": m, "overall": r(np.mean(d["_all"]) * 100, 1), "by_term": {t: r(d[t], 1) for t in terms}} for m, d in res.items()]
    return {"terms": terms, "senses": {t: list(SENSES[t]) for t in terms}, "glosses": {t: {s: SENSES[t][s][0] for s in SENSES[t]} for t in terms}, "n_sentences": len(data),
            "results": out, "curve": [{"per_sense": n, "acc": r(np.nanmean(v) * 100, 1)} for n, v in curve.items()], "errors": errs[:5], "examples": [d for d in data[:6]]}


def run():
    return {"ranking": run_ranking(), "wsd": run_wsd()}
