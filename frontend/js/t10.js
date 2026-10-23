/* T10 · Classification and clustering of clinical text. Data: window.DATA.t10 (synthetic radiology reports) */
(function () {
  const T = window.DATA.t10, { fmt } = Charts, { card, seg, sec, tbl, $id } = UI, PAL = Charts.PALETTE;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const C = T.categories, CL = T.clustering;
  let task = "category", scat = "true";

  function view() {
    const bc = T.best_category, pa = T.plain_abnormal, ba = T.best_abnormal;
    return `
    <div class="hero">
      <div><h1>Classification and clustering of clinical text</h1>
        <p>Topic 10 of this project. Free-text reports hold what structured fields do not. Two questions are asked of ${fmt(T.n_reports)} reports: <b>supervised</b>, which exam type is this and is it abnormal; <b>unsupervised</b>, what groups emerge if no labels are given. Models are fitted on ${fmt(T.n_train)} reports and scored on ${fmt(T.n_test)} others.</p></div>
      <div><div class="hero-fig num">${fmt(bc.f1, 1)}%<small>macro-F1 for the exam type (7 classes); abnormal vs normal ${fmt(pa.f1, 1)}% with plain unigrams, ${fmt(ba.f1, 1)}% with the best feature set</small></div></div>
    </div>
    <div class="callout warn"><p><b>Synthetic text.</b> The workbook has no free text, so the reports are generated from templates (<span class="mono">pipeline/clinical_text.py</span>): ~${fmt(T.mean_tokens, 0)} words each, a ${fmt(T.vocab)}-word vocabulary, occasional typos, abbreviations, incidental findings from other exam types and negated or uncertain statements. Real dictated reports are messier, so absolute accuracy here is optimistic; what transfers is <i>which choices matter</i> (n-grams, negation, label count, unsupervised structure).</p></div>

    <section class="block">${sec("10.1", "What a report looks like", "Each report has a history, an optional technique line, findings and an optional impression. “Abnormal” means at least one finding is asserted present; many reports mention the same findings only to rule them out.")}
      <div class="grid g3">${T.examples.map((e) => `<div class="card"><div class="tag" style="font-size:12px;font-weight:600">${e.category.toUpperCase()} · ${e.abnormal ? "ABNORMAL" : "NORMAL"}</div><p style="font-size:13.5px;margin:6px 0 0">${e.text}</p></div>`).join("")}</div>
    </section>

    <section class="block">${sec("10.2", "Supervised classification", "Four ways of turning text into numbers × four classifiers. Pick a task; cells are macro-F1 (%) on the held-out reports.")}
      <div class="controls"><span id="t10-task"></span></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
        ${card({ title: "Features × classifier", sub: "Macro-F1 (%) on held-out reports", id: "t10-mat" })}
        ${card({ title: "Reading the grid", body: `<div id="t10-note" class="sub" style="margin:0"></div>` })}
      </div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "How many labelled reports are needed?", sub: "Exam-type accuracy vs training-set size (logistic regression, 1–2-gram TF-IDF, mean of 3 draws)", id: "t10-curve" })}
        ${card({ title: "Confusion: exam type", sub: "Best exam-type model (" + T.best_category.features + " + " + T.best_category.model + "). Rows true, columns predicted, counts", id: "t10-conf" })}
      </div>
      <h3 style="margin:26px 0 8px">The negation problem</h3>
      <p class="lede" style="margin-bottom:12px">For “abnormal”, the word that matters (“pneumothorax”) appears in normal and abnormal reports alike. A bag of words must find other clues. Tagging every word after a negation cue (“no”, “without”, “negative”, “normal”) as <span class="mono">NEG_word</span> lets the model separate “fracture” from “NEG_fracture”.</p>
      <div class="grid g2">
        <div class="card"><h3>Plain unigrams: strongest words</h3><div class="sub">Logistic regression weights</div>
          <p><b>Abnormal:</b> ${T.drivers.plain.abnormal.map(mono).join(" ")}</p><p><b>Normal:</b> ${T.drivers.plain.normal.map(mono).join(" ")}</p></div>
        <div class="card"><h3>With negation tags: strongest words</h3><div class="sub">Logistic regression weights</div>
          <p><b>Abnormal:</b> ${T.drivers.negation.abnormal.map(mono).join(" ")}</p><p><b>Normal:</b> ${T.drivers.negation.normal.map(mono).join(" ")}</p></div>
      </div>
      <h3 style="margin:26px 0 8px">Mistakes worth reading</h3>
      <div id="t10-err"></div>
    </section>

    <section class="block">${sec("10.3", "Clustering without labels", "Reports are embedded as TF-IDF vectors (optionally compressed to 40 dimensions with truncated SVD) and grouped. The true exam type is used only afterwards, to score the groups: adjusted Rand index (1 = identical partition, 0 = chance), normalised mutual information, and purity.")}
      <div class="grid g2">
        ${card({ title: "How many clusters?", sub: "k-means on 40-dim SVD: silhouette (×100, no labels needed) and ARI vs true types (needs labels)", id: "t10-sweep" })}
        ${card({ title: "Method comparison at k = " + CL.chosen_k, body: `<div id="t10-cl"></div>` })}
      </div>
      <h3 style="margin:26px 0 8px">The k-means clusters</h3>
      <div id="t10-clusters"></div>
      <h3 style="margin:26px 0 8px">A 2-D view (700 reports)</h3>
      <div class="controls"><span id="t10-sc-seg"></span></div>
      ${card({ title: "First two SVD components", sub: "Hover a point for its group", id: "t10-scatter" })}
      <div class="legend" id="t10-sc-leg"></div>
      <div class="callout"><p><b>Take-away.</b> Exam type is recoverable without labels because vocabulary differs by body region, but the silhouette score stays low: the clusters are not geometrically well separated, so an unsupervised cut at 7 only works because we knew to ask for 7. In the sweep both silhouette and ARI peak at 7, but a silhouette of about 0.14 on its own would never convince anyone the groups are real; only the labels (ARI) show how much structure there is. Pediatric reports straddle other regions by construction, which is where clusters and labels disagree.</p></div>
    </section>`;
  }

  function drawTask() {
    const rows = T.feature_names, cols = T.model_names, res = T.results[task];
    const vals = rows.map((r) => cols.map((c) => res.find((x) => x.features === r && x.model === c).f1));
    const flat = vals.flat();
    Charts.matrix($id("t10-mat"), { rows, cols: cols.map((c) => c.replace("Multinomial naive Bayes", "Multinomial NB").replace("Complement naive Bayes", "Complement NB").replace("Logistic regression", "Logistic reg.")), values: vals, fmt: (v) => fmt(v, 1), labelW: 170, cell: 38, vmin: Math.min(...flat) - 2, vmax: 100,
      tipFn: (i, j, v) => `<div class="th">${rows[i]}</div><div>${cols[j]}: macro-F1 ${fmt(v, 1)}%</div>` });
    const best = res.slice().sort((a, b) => b.f1 - a.f1)[0], worst = res.slice().sort((a, b) => a.f1 - b.f1)[0];
    $id("t10-note").innerHTML = task === "category"
      ? `All 16 combinations are within ${fmt(best.f1 - worst.f1, 1)} points: vocabulary differs by body region, so almost any reasonable pipeline works. Best: <b>${best.features} + ${best.model}</b> (${fmt(best.f1, 1)}%). Adding 2-grams helps a little (phrases such as “left atrium” or “growth plate”); negation tags do not help here and slightly dilute the vocabulary.`
      : `Spread ${fmt(best.f1 - worst.f1, 1)} points. The pattern to look for is the <b>negation-tag</b> row beating the plain-unigram row for the same classifier. Best: <b>${best.features} + ${best.model}</b> (${fmt(best.f1, 1)}%) against ${fmt(T.plain_abnormal.f1, 1)}% for plain TF-IDF unigrams + logistic regression. The remaining errors come from negation forms the tagger does not know (“free of”, “not seen”, “has resolved”).`;
  }

  function mount() {
    seg($id("t10-task"), [{ v: "category", label: "Exam type (7 classes)" }, { v: "abnormal", label: "Abnormal vs normal" }], task, (t) => { task = t; drawTask(); });
    drawTask();
    const lc = T.learning_curve;
    Charts.lineChart($id("t10-curve"), { x: lc.map((_, i) => i), xTicks: lc.map((_, i) => i), xLabel: (v) => fmt(lc[v].n), height: 230, yMax: 100, series: [{ name: "Accuracy", color: "var(--s1)", values: lc.map((c) => c.acc) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${fmt(lc[i].n)} training reports` });
    const max = Math.max(...T.confusion.flat());
    Charts.matrix($id("t10-conf"), { rows: C, cols: C.map((c) => c.slice(0, 4)), values: T.confusion, fmt: (v) => fmt(v), labelW: 70, cell: 28, vmin: 0, vmax: max, tipFn: (i, j, v) => `<div class="th">true ${C[i]} → predicted ${C[j]}</div><div>${fmt(v)} reports</div>` });
    $id("t10-err").innerHTML = T.errors.length ? T.errors.map((e) => `<div class="card" style="margin-bottom:8px"><span class="pill">true ${e.true}</span> <span class="pill">predicted ${e.pred}</span><p style="font-size:13.5px;margin:8px 0 0">${e.text}</p></div>`).join("") : `<div class="card"><p class="sub" style="margin:0">The best exam-type model made no mistakes on this held-out set.</p></div>`;

    const sw = CL.k_sweep;
    Charts.lineChart($id("t10-sweep"), { x: sw.map((s) => s.k), xTicks: sw.map((s) => s.k), height: 240, yMax: 100, series: [{ name: "Silhouette ×100", color: "var(--muted)", values: sw.map((s) => s.silhouette * 100) }, { name: "ARI ×100", color: "var(--s1)", values: sw.map((s) => s.ari * 100) }, { name: "Purity %", color: "var(--s3)", values: sw.map((s) => s.purity) }],
      yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 1), tipHeader: (i) => `k = ${sw[i].k}`, vlines: [{ x: CL.chosen_k, label: "7 true types" }] });
    $id("t10-cl").innerHTML = tbl([{ h: "Method" }, { h: "ARI", r: 1 }, { h: "NMI", r: 1 }, { h: "Purity", r: 1 }], CL.models.map((m) => [m.name, fmt(m.ari, 3), fmt(m.nmi, 3), fmt(m.purity, 1) + "%"]));
    $id("t10-clusters").innerHTML = tbl([{ h: "Cluster" }, { h: "Reports", r: 1 }, { h: "Main exam type" }, { h: "Purity", r: 1 }, { h: "Top terms (nearest the cluster centre)" }, { h: "Composition by true type" }],
      CL.clusters.map((c) => [`<i class="dot" style="background:${PAL[c.id]}"></i>${c.id + 1}`, fmt(c.size), c.main, fmt(c.purity, 1) + "%", c.top_terms.map(mono).join(" "), C.map((n, i) => (c.mix[i] ? `${n.slice(0, 4)} ${fmt(c.mix[i])}` : null)).filter(Boolean).join(", ")]));
    const draw = () => {
      const s = CL.scatter, g = scat === "true" ? s.true : s.cluster, names = scat === "true" ? C : CL.clusters.map((c) => "Cluster " + (c.id + 1) + " (" + c.main + ")");
      Charts.scatter($id("t10-scatter"), { x: s.x, y: s.y, group: g, colors: PAL, names, height: 340 });
      $id("t10-sc-leg").innerHTML = names.map((n, i) => `<span class="pill"><i class="dot" style="background:${PAL[i]}"></i>${n}</span>`).join("");
    };
    seg($id("t10-sc-seg"), [{ v: "true", label: "Coloured by true exam type" }, { v: "cluster", label: "Coloured by k-means cluster" }], scat, (v) => { scat = v; draw(); });
    draw();
  }
  App.add({ id: "t10", label: "T10 · Text classification", view, mount });
})();
