"""T11 - Information extraction and entity recognition on clinical text.

Pipeline: tokenise -> recognise entities (ANATOMY, FINDING, SIZE) -> decide whether each finding is present, negated or
uncertain -> assemble a structured record per report.  Two recognisers are compared against the generator's gold spans:
a dictionary + regex matcher, whose lexicon is deliberately incomplete (each term is known with probability 0.7), and a
token classifier (linear SVM on word, neighbour, suffix and shape features).  Assertion is done by NegEx-style rules and by
a classifier on the words around the finding.  Scores are exact-span, entity-level, on the 30 % of reports held out.
"""
import re
from collections import Counter

import numpy as np
from sklearn.feature_extraction import DictVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC

from .clinical_text import ABBREV, ANAT, FIND, GEN_ANAT, GEN_FIND, bio_tags, make_reports, tokenize
from .utils import r

TYPES = ["ANATOMY", "FINDING", "SIZE"]
LEXICON_COVERAGE = 0.7
SIZE_RE = re.compile(r"\b\d+(?:\.\d+)?\s?(?:mm|cm)\b")
PRE_NEG = re.compile(r"\b(no|without|negative for|absence of)\b")
PRE_UNC = re.compile(r"\b(possible|cannot exclude|may represent|suspicious for)\b")
POST_NEG = re.compile(r"\b(has resolved)\b")


# --------------------------------------------------------------------------- span utilities
def spans_from_bio(toks, tags):
    out, cur = [], None
    for (w, s, e), t in zip(toks, tags):
        if t.startswith("B-") or (t.startswith("I-") and (cur is None or cur[0] != t[2:])):
            if cur:
                out.append(tuple(cur))
            cur = [t[2:], s, e]
        elif t.startswith("I-"):
            cur[2] = e
        else:
            if cur:
                out.append(tuple(cur))
            cur = None
    if cur:
        out.append(tuple(cur))
    return set(out)


def prf(gold, pred):
    tp = len(gold & pred)
    p, rec = tp / len(pred) if pred else 0.0, tp / len(gold) if gold else 0.0
    return {"p": r(p * 100, 1), "r": r(rec * 100, 1), "f1": r((2 * p * rec / (p + rec) if p + rec else 0) * 100, 1), "n_gold": len(gold), "n_pred": len(pred)}


# --------------------------------------------------------------------------- method 1: dictionary + regex
def build_lexicon(rng):
    terms = {}
    for cat in ANAT:
        for a in ANAT[cat]:
            terms[a.lower()] = "ANATOMY"
    for a in GEN_ANAT:
        terms[a.lower()] = "ANATOMY"
    for ab in ABBREV.values():
        terms[ab.lower()] = "ANATOMY"
    for cat in FIND:
        for f in FIND[cat]:
            terms[f.lower()] = "FINDING"
    for f in GEN_FIND:
        terms[f.lower()] = "FINDING"
    keys = sorted(terms)
    known = {k: terms[k] for k in keys if rng.random() < LEXICON_COVERAGE}
    return known, terms


def dict_tag(text, lex, use_regex=True):
    """Longest-match dictionary lookup over tokens; SIZE by regex.  Returns a set of (type, start, end)."""
    toks = tokenize(text)
    words = [t[0].lower() for t in toks]
    maxlen = max(len(k.split()) for k in lex)
    spans, i = set(), 0
    while i < len(toks):
        hit = None
        for n in range(min(maxlen, len(toks) - i), 0, -1):
            cand = " ".join(words[i:i + n])
            if cand in lex:
                hit = (lex[cand], toks[i][1], toks[i + n - 1][2], n)
                break
        if hit:
            spans.add(hit[:3])
            i += hit[3]
        else:
            i += 1
    if use_regex:
        for m in SIZE_RE.finditer(text):
            spans.add(("SIZE", m.start(), m.end()))
    return spans


# --------------------------------------------------------------------------- method 2: token classifier
def token_features(toks, lex):
    words = [t[0] for t in toks]
    low = [w.lower() for w in words]
    feats = []
    for i, w in enumerate(words):
        f = {"w": low[i], "suf3": low[i][-3:], "suf2": low[i][-2:], "pre3": low[i][:3], "shape": re.sub(r"[a-z]+", "a", re.sub(r"[A-Z]+", "A", re.sub(r"\d+", "9", w))),
             "dict": lex.get(low[i], "-"), "bias": 1}
        for d in (-2, -1, 1, 2):
            j = i + d
            f[f"w{d:+d}"] = low[j] if 0 <= j < len(low) else "<pad>"
        f["w-1_w"] = f["w-1"] + "|" + low[i]
        f["w_w+1"] = low[i] + "|" + f["w+1"]
        f["unit_next"] = int(i + 1 < len(low) and low[i + 1] in ("mm", "cm"))
        feats.append(f)
    return feats


# --------------------------------------------------------------------------- assertion
def sentence_of(text, start, end):
    a = max(text.rfind(".", 0, start), text.rfind(";", 0, start), text.rfind(":", 0, start)) + 1
    b_cands = [x for x in (text.find(".", end), text.find(";", end)) if x >= 0]
    b = min(b_cands) if b_cands else len(text)
    return text[a:b].lower(), start - a, end - a


def negex(text, s, e):
    sent, a, b = sentence_of(text, s, e)
    pre, post = sent[:a], sent[b:]
    if PRE_NEG.search(pre) or POST_NEG.search(post):
        return "negated"
    if PRE_UNC.search(pre):
        return "uncertain"
    return "present"


def ctx_features(text, s, e):
    sent, a, b = sentence_of(text, s, e)
    left = re.findall(r"[a-z]+", sent[:a])[-6:]
    right = re.findall(r"[a-z]+", sent[b:])[:4]
    f = {f"L_{w}": 1 for w in left}
    f.update({f"R_{w}": 1 for w in right})
    for k, w in enumerate(reversed(left[-3:])):
        f[f"L{k}_{w}"] = 1
    return f


def run():
    reps = make_reports(3000, seed=2)
    rng = np.random.RandomState(0)
    perm = rng.permutation(len(reps))
    cut = int(len(reps) * 0.7)
    train = [reps[i] for i in perm[:cut]]
    test = [reps[i] for i in perm[cut:]]
    lex, full_lex = build_lexicon(__import__("random").Random(0))
    n_terms = len(full_lex)

    # ----- entity recognition
    def gold_spans(d):
        return {(e["type"], e["start"], e["end"]) for e in d["entities"]}
    gold_all = [gold_spans(d) for d in test]
    preds = {}
    preds["Dictionary only"] = [dict_tag(d["text"], lex, use_regex=False) for d in test]
    preds["Dictionary + regex"] = [dict_tag(d["text"], lex) for d in test]

    Xtr, ytr = [], []
    for d in train:
        toks, tags = bio_tags(d["text"], d["entities"])
        Xtr += token_features(toks, lex)
        ytr += tags
    dv = DictVectorizer()
    clf = LinearSVC(C=0.5).fit(dv.fit_transform(Xtr), ytr)
    ml_pred = []
    for d in test:
        toks = tokenize(d["text"])
        tags = clf.predict(dv.transform(token_features(toks, lex)))
        ml_pred.append({(t, s, e) for t, s, e in spans_from_bio(toks, tags)})
    preds["Token classifier (+ dictionary feature)"] = ml_pred
    # classifier without the dictionary feature
    Xtr2 = [{k: v for k, v in f.items() if k != "dict"} for f in Xtr]
    dv2 = DictVectorizer()
    clf2 = LinearSVC(C=0.5).fit(dv2.fit_transform(Xtr2), ytr)
    p2 = []
    for d in test:
        toks = tokenize(d["text"])
        f = [{k: v for k, v in x.items() if k != "dict"} for x in token_features(toks, lex)]
        p2.append(spans_from_bio(toks, clf2.predict(dv2.transform(f))))
    preds["Token classifier (no dictionary)"] = p2

    scores = {}
    for name, pr in preds.items():
        per = {}
        for t in TYPES:
            per[t] = prf({(i, a, b, c) for i, g in enumerate(gold_all) for (a, b, c) in g if a == t},
                         {(i, a, b, c) for i, g in enumerate(pr) for (a, b, c) in g if a == t})
        allg = {(i, a, b, c) for i, g in enumerate(gold_all) for (a, b, c) in g}
        allp = {(i, a, b, c) for i, g in enumerate(pr) for (a, b, c) in g}
        per["all"] = prf(allg, allp)
        scores[name] = per

    # recall on terms never seen in training, and on terms missing from the lexicon
    seen = {e["text"].lower() for d in train for e in d["entities"]}
    unseen = []
    in_lex = {"in": [0, 0], "out": [0, 0]}
    for i, d in enumerate(test):
        for e in d["entities"]:
            if e["type"] == "SIZE":
                continue
            key = e["text"].lower()
            unseen.append((i, e, key not in seen))
            slot = in_lex["in" if key in lex else "out"]
            slot[1] += 1
            slot[0] += any((e["type"], e["start"], e["end"]) in pr[i] for pr in [preds["Dictionary + regex"]])
    rec_lex = {k: r(v[0] / max(1, v[1]) * 100, 1) for k, v in in_lex.items()}
    rec_lex["n_in"], rec_lex["n_out"] = in_lex["in"][1], in_lex["out"][1]
    typo_miss = {}
    for name in ("Dictionary + regex", "Token classifier (+ dictionary feature)", "Token classifier (no dictionary)"):
        pr = preds[name]
        hit = sum((e["type"], e["start"], e["end"]) in pr[i] for i, e, u in unseen if u)
        tot = sum(1 for _, _, u in unseen if u)
        typo_miss[name] = {"recall_unseen": r(hit / max(1, tot) * 100, 1), "n": tot}

    # ----- assertion
    def gold_findings(docs):
        out = []
        status = {}
        for i, d in enumerate(docs):
            st = {g["fid"]: g["status"] for g in d["findings"]}
            for e in d["entities"]:
                if e["type"] == "FINDING" and e["fid"] is not None:
                    out.append((i, e, st[e["fid"]]))
        return out
    gtr, gte = gold_findings(train), gold_findings(test)
    labs = ["present", "negated", "uncertain"]
    y_true = [s for _, _, s in gte]
    rule = [negex(test[i]["text"], e["start"], e["end"]) for i, e, _ in gte]
    dv3 = DictVectorizer()
    Xa = dv3.fit_transform([ctx_features(train[i]["text"], e["start"], e["end"]) for i, e, _ in gtr])
    lr = LogisticRegression(max_iter=1000, C=3).fit(Xa, [s for _, _, s in gtr])
    ml_a = lr.predict(dv3.transform([ctx_features(test[i]["text"], e["start"], e["end"]) for i, e, _ in gte]))
    majority = Counter(s for _, _, s in gtr).most_common(1)[0][0]

    def ass_scores(pred):
        acc = np.mean([a == b for a, b in zip(y_true, pred)])
        per = {}
        for c in labs:
            tp = sum(1 for a, b in zip(y_true, pred) if a == c and b == c)
            fp = sum(1 for a, b in zip(y_true, pred) if a != c and b == c)
            fn = sum(1 for a, b in zip(y_true, pred) if a == c and b != c)
            p, rc = tp / max(1, tp + fp), tp / max(1, tp + fn)
            per[c] = {"p": r(p * 100, 1), "r": r(rc * 100, 1), "f1": r((2 * p * rc / max(1e-9, p + rc)) * 100, 1)}
        return {"acc": r(acc * 100, 1), "per": per}
    assertion = {"Everything is 'present'": ass_scores([majority] * len(y_true)), "NegEx-style rules": ass_scores(rule), "Context classifier": ass_scores(list(ml_a))}
    wrong = [(i, e, a, b) for (i, e, a), b in zip(gte, rule) if a != b][:5]
    ass_err = [{"sentence": sentence_of(test[i]["text"], e["start"], e["end"])[0].strip(), "finding": e["text"], "gold": a, "rule": b} for i, e, a, b in wrong]
    counts = Counter(y_true)

    # ----- structured output + report-level use
    rows = Counter()
    flag_correct = 0
    for i, d in enumerate(test):
        toks = tokenize(d["text"])
        tags = clf.predict(dv.transform(token_features(toks, lex)))
        sp = sorted(spans_from_bio(toks, tags), key=lambda x: x[1])
        found = [(t, s, e) for t, s, e in sp if t == "FINDING"]
        pres = [(s, e) for _, s, e in found if negex(d["text"], s, e) == "present"]
        flag_correct += int(bool(pres)) == d["abnormal"]
        for _, s, e in found:
            if negex(d["text"], s, e) == "present":
                rows[d["text"][s:e].lower()] += 1
    abnormal_acc = r(flag_correct / len(test) * 100, 1)

    # ----- annotated examples
    ex = []
    for i in (0, 1, 3, 4):
        d = test[i]
        toks = tokenize(d["text"])
        pred = sorted(spans_from_bio(toks, clf.predict(dv.transform(token_features(toks, lex)))), key=lambda x: x[1])
        ex.append({"text": d["text"], "gold": [{"type": e["type"], "start": e["start"], "end": e["end"], "status": next((g["status"] for g in d["findings"] if g["fid"] == e["fid"]), None) if e["type"] == "FINDING" else None} for e in d["entities"]],
                   "dict": [{"type": t, "start": s, "end": e} for t, s, e in sorted(preds["Dictionary + regex"][i], key=lambda x: x[1])],
                   "ml": [{"type": t, "start": s, "end": e} for t, s, e in pred]})
    ent_counts = Counter(e["type"] for d in test for e in d["entities"])
    return {"n_train": len(train), "n_test": len(test), "lexicon": {"terms_total": n_terms, "terms_known": len(lex), "coverage": LEXICON_COVERAGE}, "entity_counts": dict(ent_counts), "types": TYPES,
            "scores": scores, "lexicon_recall": rec_lex, "unseen_recall": typo_miss, "assertion": assertion, "assertion_counts": dict(counts), "assertion_errors": ass_err,
            "assertion_labels": labs, "abnormal_from_extraction_acc": abnormal_acc, "top_present": [{"term": k, "n": v} for k, v in rows.most_common(12)], "examples": ex,
            "n_features": int(len(dv.feature_names_))}
