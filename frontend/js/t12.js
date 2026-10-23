/* T12 · Ranking and word-sense disambiguation of clinical text. Data: window.DATA.t12 */
(function () {
  const T = window.DATA.t12, R = T.ranking, W = T.wsd, { fmt } = Charts, { card, seg, sec, tbl, $id } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const DC = { "Boolean: count of query words": "var(--muted)", "TF-IDF cosine": "var(--s4)", "BM25": "var(--s1)", "BM25 + negation tags": "var(--s3)", "LSA (100 dims)": "var(--s5, #8a5cd6)" };
  let qkind = "", metric = "ndcg", term = W.terms[0];

  function view() {
    const bm = R.doc_ranking.find((x) => x.name === "BM25"), bn = R.doc_ranking.find((x) => x.name === "BM25 + negation tags");
    const nb = W.results.find((x) => x.name.startsWith("Naive Bayes")), mj = W.results[0];
    return `
    <div class="hero">
      <div><h1>Ranking and word-sense disambiguation</h1>
        <p>Topic 12 of this project. <b>Ranking</b> decides what a clinician sees first: which reports answer a query, which words characterise an exam type. <b>Disambiguation</b> decides what a token means: “MS” is multiple sclerosis, mitral stenosis or morphine sulfate depending on its neighbours.</p></div>
      <div><div class="hero-fig num">${fmt(bm.ndcg, 0)}% → ${fmt(bn.ndcg, 0)}%<small>nDCG@10 of BM25 report search, without and with negation handling (${R.n_queries} queries over ${fmt(R.n_docs)} reports); sense accuracy ${fmt(mj.overall, 0)}% → ${fmt(nb.overall, 0)}% once context is used</small></div></div>
    </div>
    <div class="callout warn"><p><b>Synthetic text again.</b> Reports and ambiguous notes are generated (<span class="mono">pipeline/clinical_text.py</span>). Relevance for report search is known exactly: a report is relevant if it <i>asserts</i> the queried finding (and site), not merely mentions it. Sense labels come from the generator, with 55 % of context words drawn from the true sense, 12 % from a wrong sense and the rest noise, so the contexts are cleaner than hand-written notes.</p></div>

    <section class="block">${sec("12.1", "Ranking reports for a query", "Queries are either a finding alone (“pleural effusion”) or a finding at a site (“pleural effusion right lower lobe”). Each method scores every report; the list is judged on P@10 (share of the top 10 that are relevant), MAP (precision averaged along the list) and nDCG@10 (rewards relevant reports near the top).")}
      <div class="controls"><span id="t12-q"></span><span id="t12-m"></span></div>
      <div class="grid g2">
        ${card({ title: "Ranking quality", sub: "Mean over queries, percent", id: "t12-rank" })}
        ${card({ title: "Reading it", body: `<div id="t12-rank-note" class="sub" style="margin:0"></div>` })}
      </div>
      <div id="t12-rank-tbl" style="margin-top:14px"></div>
      <h3 style="margin:26px 0 8px">One query, two rankings</h3>
      <p class="lede" style="margin-bottom:12px">Query: <b>${R.example ? R.example.query : "–"}</b> (${R.example ? R.example.n_relevant : 0} relevant reports). Top five by plain BM25 against BM25 that treats a negated word as a different term.</p>
      <div class="grid g2" id="t12-ex"></div>
    </section>

    <section class="block">${sec("12.2", "Ranking words", "Which words best characterise an exam category? Each method ranks the vocabulary; the top 10 is scored against the words that occur <i>only</i> in that category's anatomy and finding lists (about ${Math.round(Object.values(R.gold_kw_sizes).reduce((a, b) => a + b, 0) / R.keyword_categories.length)} per category).")}
      <div class="grid g2">
        ${card({ title: "Precision@10 of word rankings", sub: "Mean over the 7 exam categories, percent", id: "t12-kw" })}
        ${card({ title: "Top 10 for chest reports", body: `<div id="t12-kw-ex"></div>` })}
      </div>
      <div class="callout"><p>Frequency and TextRank (graph centrality over word co-occurrence) surface words that are common <i>everywhere</i> (“left”, “right”, “year-old”, “seen”). Contrastive measures (TF-IDF averaged over a category minus other categories; χ²) ask how much more a word belongs to this category than to the rest, which is the question being asked. For single-document keyword extraction, where no contrast set exists, TextRank is the usual tool; here the category contrast is available and wins.</p></div>
    </section>

    <section class="block">${sec("12.3", "Word-sense disambiguation", "Eight ambiguous clinical tokens, " + W.terms.map(mono).join(" ") + ", each with two or three senses, " + fmt(W.n_sentences) + " short notes in total. Four resolvers are trained or applied per token on 70 % of its notes and scored on the other 30 %.")}
      <div class="grid g2">
        ${card({ title: "Accuracy by method", sub: "Percent of held-out notes assigned the right sense", id: "t12-wsd" })}
        ${card({ title: "How much labelled data?", sub: "Logistic regression accuracy vs labelled notes per sense", id: "t12-curve" })}
      </div>
      <div class="controls" style="margin-top:14px"><span id="t12-term"></span></div>
      <div class="grid g2">
        <div class="card"><h3 id="t12-term-h"></h3><div id="t12-senses"></div></div>
        ${card({ title: "Accuracy for this token", sub: "Percent", id: "t12-term-acc" })}
      </div>
      <h3 style="margin:26px 0 8px">Sample notes and mistakes</h3>
      <div class="grid g2"><div id="t12-samples"></div><div id="t12-wsd-err"></div></div>
      <div class="callout"><p><b>Reading it.</b> The majority-sense rule sits at chance for balanced senses. Simplified Lesk (overlap with a dictionary definition) is barely better because notes seldom repeat the words of a dictionary gloss. Models that learn which context words go with which sense recover most of the signal. The ceiling is set by contexts that carry a cue for the <i>other</i> sense, which no method can fix without more context.</p></div>
    </section>`;
  }

  function drawRank() {
    const suf = qkind === "fs" ? "_fs" : qkind === "fo" ? "_fo" : "";
    const key = { ndcg: "ndcg", p10: "p10", map: "map" }[metric] + suf;
    Charts.hbarChart($id("t12-rank"), { labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: metric, max: 100, items: R.doc_ranking.map((m) => ({ label: m.name, value: m[key], color: DC[m.name] })) });
    const g = (n) => R.doc_ranking.find((m) => m.name === n)[key];
    $id("t12-rank-note").innerHTML = `Plain BM25 beats TF-IDF cosine because it saturates repeated terms and normalises length, and both beat counting query words. The largest single gain is from <b>negation handling</b>: ${fmt(g("BM25"), 1)}% → ${fmt(g("BM25 + negation tags"), 1)}% on this selection, since reports that only <i>exclude</i> the finding contain the query words too. LSA smooths over vocabulary but blurs exact terms such as site names, and does worse. Queries with a site are harder: abbreviations (“RLL” for right lower lobe) and sites mentioned in other sentences defeat word matching.`;
    $id("t12-rank-tbl").innerHTML = tbl([{ h: "Method" }, { h: "P@10", r: 1 }, { h: "MAP", r: 1 }, { h: "nDCG@10", r: 1 }], R.doc_ranking.map((m) => [m.name, fmt(m["p10" + suf], 1), fmt(m["map" + suf], 1), fmt(m["ndcg" + suf], 1)])) +
      `<div class="legend-note">${R.queries_fs} finding-and-site queries and ${R.queries_fo} finding-only queries; ${qkind === "fs" ? "showing finding + site only" : qkind === "fo" ? "showing finding only" : "showing all"}.</div>`;
  }

  function drawTerm() {
    const t = term, S = W.senses[t];
    $id("t12-term-h").innerHTML = mono(t) + " can mean";
    $id("t12-senses").innerHTML = S.map((s) => `<div style="padding:7px 0;border-bottom:1px solid var(--grid)"><b>${s}</b><div class="sub" style="margin:2px 0 0">${W.glosses[t][s]}</div></div>`).join("");
    Charts.hbarChart($id("t12-term-acc"), { labelW: 220, fmt: (v) => fmt(v, 1) + "%", valueName: "Accuracy", max: 100, items: W.results.map((m, i) => ({ label: m.name, value: m.by_term[t], color: ["var(--muted)", "var(--s4)", "var(--s1)", "var(--s3)"][i] })) });
  }

  function mount() {
    seg($id("t12-q"), [{ v: "", label: "All queries" }, { v: "fs", label: "Finding + site" }, { v: "fo", label: "Finding only" }], qkind, (v) => { qkind = v; drawRank(); });
    seg($id("t12-m"), [{ v: "ndcg", label: "nDCG@10" }, { v: "p10", label: "P@10" }, { v: "map", label: "MAP" }], metric, (v) => { metric = v; drawRank(); });
    drawRank();
    if (R.example) {
      const col = (h, items) => `<div><h3 style="margin-bottom:8px">${h}</h3>${items.map((x, i) => `<div class="card" style="margin-bottom:8px;border-left:3px solid ${x.rel ? "var(--good, #1baf7a)" : "var(--div-neg)"}"><span class="pill">#${i + 1} · ${x.rel ? "relevant" : "not relevant"}</span><p style="font-size:13px;margin:8px 0 0">${x.text}…</p></div>`).join("")}</div>`;
      $id("t12-ex").innerHTML = col("BM25", R.example.bm25) + col("BM25 + negation tags", R.example.bm25neg);
    }
    const KC = ["var(--muted)", "var(--s1)", "var(--s3)", "var(--s4)"];
    Charts.hbarChart($id("t12-kw"), { labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: "P@10", max: 100, items: R.keyword_ranking.map((k, i) => ({ label: k.name, value: k.p10, color: KC[i % 4] })) });
    $id("t12-kw-ex").innerHTML = R.keyword_ranking.map((k) => `<div style="padding:7px 0;border-bottom:1px solid var(--grid)"><b>${k.name}</b><div class="chips" style="margin-top:6px">${R.keyword_example[k.name].map((w) => `<span class="chip mono">${w}</span>`).join("")}</div></div>`).join("");

    Charts.barChart($id("t12-wsd"), { categories: W.results.map((m) => m.name.replace(" on context words", "").replace(" (gloss overlap)", "")), height: 240, yMax: 100, valueLabels: true, series: [{ name: "Accuracy", color: "var(--s1)", values: W.results.map((m) => m.overall) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1) + "%" });
    Charts.lineChart($id("t12-curve"), { x: W.curve.map((_, i) => i), xTicks: W.curve.map((_, i) => i), xLabel: (v) => W.curve[v].per_sense, height: 240, yMax: 100, series: [{ name: "Accuracy", color: "var(--s3)", values: W.curve.map((c) => c.acc) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${W.curve[i].per_sense} labelled notes per sense` });
    seg($id("t12-term"), W.terms.map((t) => ({ v: t, label: t })), term, (t) => { term = t; drawTerm(); });
    drawTerm();
    $id("t12-samples").innerHTML = `<div class="card"><h3>Sample notes</h3>${W.examples.map((e) => `<div style="padding:6px 0;border-bottom:1px solid var(--grid)"><span class="mono">${e.text}</span><div class="sub" style="margin:2px 0 0">→ ${e.sense}</div></div>`).join("")}</div>`;
    $id("t12-wsd-err").innerHTML = `<div class="card"><h3>Logistic regression got these wrong</h3>${W.errors.map((e) => `<div style="padding:6px 0;border-bottom:1px solid var(--grid)"><span class="mono">${e.text}</span><div class="sub" style="margin:2px 0 0">true: ${e.gold} · predicted: ${e.pred}</div></div>`).join("")}</div>`;
  }
  App.add({ id: "t12", label: "T12 · Ranking & WSD", view, mount });
})();
