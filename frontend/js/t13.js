/* T13 · Dimensionality reduction for exploratory data analysis. Data: window.DATA.t13 */
(function () {
  const T = window.DATA.t13, { fmt } = Charts, { card, seg, sec, tbl, $id, SITES, siteOpts, dot, col } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const S = (f) => T.sites[f];
  const SEQ = ["#cfe3fa", "#7fb2ec", "#eda100", "#d6451f"];
  let site = "F1", method = "t-SNE (perplexity 30)", colorBy = "wait";

  function view() {
    const t = SITES.map((f) => S(f).scores.find((x) => x.name.startsWith("t-SNE")).trust), p = SITES.map((f) => S(f).scores.find((x) => x.name === "PCA").trust);
    return `
    <div class="hero">
      <div><h1>Dimensionality reduction for exploratory analysis</h1>
        <p>Topic 13 of this project. Each exam is described by 60–90 numbers at the moment of arrival. No one can look at 80 dimensions, so we project to two and ask the question that matters before trusting any picture: <b>did the projection keep the neighbourhoods, and did it keep the thing we care about (wait time)?</b> Five methods are compared on ${fmt(T.params.sample)} exams per site, plus a check on how many components a prediction model really needs.</p></div>
      <div><div class="hero-fig num">${fmt(Math.min(...p), 2)} → ${fmt(Math.max(...t), 2)}<small>neighbourhood trustworthiness (1 = perfect) of a 2-D PCA vs the best 2-D map (t-SNE), ranges across sites</small></div></div>
    </div>
    <div class="callout warn"><p><b>Pictures mislead.</b> t-SNE and similar maps keep <i>local</i> neighbours but distort distances between clusters, cluster sizes and global shape; PCA keeps global variance but squashes local structure. Nothing here says wait time is “explained” by two coordinates (it is not, see 13.3). Inputs: the T2 clean file, outcome and timestamp columns removed, standardised and clipped at ±6 σ; no records removed.</p></div>
    <div class="controls"><span id="t13-site"></span></div>

    <section class="block">${sec("13.1", "Principal components: how many dimensions are real?", "PCA rotates the data so that the first axis holds the most variance, the second the most of what remains, and so on. A slowly decaying scree means many features carry independent information.")}
      <div id="t13-kpi"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Variance per component", sub: "Percent of total variance, first 20 components", id: "t13-scree" })}
        ${card({ title: "Cumulative variance", sub: "Percent", id: "t13-cum" })}
      </div>
      <h3 style="margin:22px 0 8px">What the first two axes are made of</h3>
      <div class="grid g2" id="t13-pcs"></div>
    </section>

    <section class="block">${sec("13.2", "Five ways to draw the same data", "Choose a method and a colouring. Colour by wait quartile asks whether the map separates short from long waits; colour by arrival hour asks whether it recovers time of day.")}
      <div class="controls"><span id="t13-method"></span><span id="t13-color"></span></div>
      ${card({ title: "2-D map (900 of the " + fmt(T.params.sample) + " exams)", sub: "Axes are arbitrary; only closeness means something", id: "t13-map" })}
      <div class="legend" id="t13-leg"></div>
    </section>

    <section class="block">${sec("13.3", "Which map can be trusted?", "<b>Trustworthiness</b>: of the 10 nearest neighbours in the map, how many were really near in 80-D (no false neighbours). <b>Continuity</b>: of the true 10 nearest neighbours, how many stayed near in the map (nothing torn apart). <b>Wait R²</b>: predict wait from the 2-D coordinates alone with 15 nearest neighbours (5-fold CV); the dashed line is the same predictor on all features.")}
      <div class="grid g2">
        ${card({ title: "Neighbourhood preservation", sub: "Trustworthiness and continuity at k = " + T.params.neighbours, id: "t13-trust" })}
        ${card({ title: "Wait-time signal kept in two dimensions", sub: "Cross-validated R² of a 15-NN predictor", id: "t13-r2" })}
      </div>
      <div id="t13-score" style="margin-top:14px"></div>
      <div class="callout" id="t13-score-note"></div>
    </section>

    <section class="block">${sec("13.4", "Reduction for modelling: how many components does a model need?", "PCA is fitted on the earliest 70 % of the sample; ridge regression on the first k components predicts wait for the later 30 %. The error is compared with always predicting the training mean.")}
      <div class="grid g2">
        ${card({ title: "Hold-out error vs number of components", sub: "Mean absolute error (min); dashed reference = predicting the mean", id: "t13-curve" })}
        ${card({ title: "Reading it", body: `<div id="t13-curve-note" class="sub" style="margin:0"></div>` })}
      </div>
    </section>`;
  }

  function drawSite(f) {
    const s = S(f), idx = s.scree.map((_, i) => i + 1);
    $id("t13-kpi").innerHTML = `<div class="statrow">${[["Raw features", s.dims], ["Components for 90 % of variance", s.k90], ["Components for 95 %", s.k95], ["First two axes hold", fmt(s.cum[1], 0) + "%"]].map(([a, b]) => `<div class="card"><div class="sub">${a}</div><div class="big">${b}</div></div>`).join("")}</div>`;
    Charts.barChart($id("t13-scree"), { categories: idx, height: 210, series: [{ name: "Variance", color: col(f), values: s.scree }], yFmt: (v) => fmt(v, 0) + "%", tipFmt: (v) => fmt(v, 1) + "%" });
    Charts.lineChart($id("t13-cum"), { x: idx, xTicks: idx.filter((i) => i % 2 === 0 || i === 1), height: 210, yMax: 100, area: true, series: [{ name: "Cumulative", color: col(f), values: s.cum }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${idx[i]} components` });
    $id("t13-pcs").innerHTML = s.pcs.map((p) => `<div class="card"><h3>PC${p.pc} · ${fmt(p.var, 1)}% of variance</h3><div class="sub">Heaviest loadings (standardised features)</div>${p.top.map((t) => `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--grid)"><span class="mono">${t.col}</span><b class="num">${t.w > 0 ? "+" : ""}${fmt(t.w, 2)}</b></div>`).join("")}</div>`).join("");
    drawMap(); drawScores(f);
    const c = s.curve;
    Charts.lineChart($id("t13-curve"), { x: c.map((_, i) => i), xTicks: c.map((_, i) => i), xLabel: (v) => c[v].k, height: 230, yMax: Math.ceil(s.mean_baseline_mae + 1), series: [{ name: "Ridge on k components", color: col(f), values: c.map((x) => x.mae) }, { name: "Predict the mean", color: "var(--muted)", values: c.map(() => s.mean_baseline_mae) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 2) + " min", tipHeader: (i) => `${c[i].k} components (${fmt(c[i].var, 0)}% of variance)` });
    const full = c[c.length - 1], k2 = c.find((x) => x.k === 2), k20 = c.find((x) => x.k >= 20) || full;
    $id("t13-curve-note").innerHTML = `With 2 components the error is ${fmt(k2.mae, 2)} min against ${fmt(s.mean_baseline_mae, 2)} for the mean and ${fmt(full.mae, 2)} with all ${s.dims} features. About ${k20.k} components (${fmt(k20.var, 0)} % of variance) recover ${fmt(((s.mean_baseline_mae - k20.mae) / (s.mean_baseline_mae - full.mae)) * 100, 0)} % of the gain. Components are ordered by variance, not by relevance to wait, so predictive signal can sit in late components; compressing to 2–3 dimensions for <i>modelling</i> would throw most of it away even though a 2-D <i>picture</i> looks tidy.`;
  }

  function drawMap() {
    const s = S(site), pt = s.points[method];
    let grp, names;
    if (colorBy === "wait") { grp = s.wait_bin; const q = s.wait_quartiles; names = [`≤ ${fmt(q[0], 0)} min`, `${fmt(q[0], 0)}–${fmt(q[1], 0)}`, `${fmt(q[1], 0)}–${fmt(q[2], 0)}`, `> ${fmt(q[2], 0)} min`]; }
    else { const lo = Math.min(...s.hour), hi = Math.max(...s.hour), w = (hi - lo + 1) / 4; grp = s.hour.map((h) => Math.min(3, Math.floor((h - lo) / w))); names = [0, 1, 2, 3].map((k) => `${Math.round(lo + k * w)}:00–${Math.round(lo + (k + 1) * w)}:00`); }
    Charts.scatter($id("t13-map"), { x: pt.x, y: pt.y, group: grp, colors: SEQ, names, height: 360, tipFn: (i) => `<div class="th">${names[grp[i]]}</div><div>${colorBy === "wait" ? "wait quartile" : "arrival hour band"}</div>` });
    $id("t13-leg").innerHTML = names.map((n, i) => `<span class="pill"><i class="dot" style="background:${SEQ[i]}"></i>${n}</span>`).join("");
  }

  function drawScores(f) {
    const s = S(f), sc = s.scores;
    Charts.barChart($id("t13-trust"), { categories: sc.map((x) => x.name.split(" (")[0]), height: 240, yMax: 1, series: [{ name: "Trustworthiness", color: "var(--s1)", values: sc.map((x) => x.trust) }, { name: "Continuity", color: "var(--s3)", values: sc.map((x) => x.cont) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 3) });
    Charts.barChart($id("t13-r2"), { categories: sc.map((x) => x.name.split(" (")[0]), height: 240, series: [{ name: "Wait R² from 2-D map", color: col(f), values: sc.map((x) => Math.max(0, x.wait_r2)) }, { name: `All ${s.dims} features`, color: "var(--muted)", values: sc.map(() => s.knn_r2_full) }], yFmt: (v) => fmt(v, 2), tipFmt: (v) => fmt(v, 3) });
    $id("t13-score").innerHTML = tbl([{ h: "Method" }, { h: "Trustworthiness", r: 1 }, { h: "Continuity", r: 1 }, { h: "Wait R² (2-D)", r: 1 }, { h: "|ρ| axis 1 vs wait", r: 1 }, { h: "|ρ| axis 2 vs wait", r: 1 }], sc.map((x) => [x.name, fmt(x.trust, 3), fmt(x.cont, 3), fmt(x.wait_r2, 3), fmt(x.rho1, 2), fmt(x.rho2, 2)]));
    const best = sc.slice().sort((a, b) => b.trust - a.trust)[0];
    $id("t13-score-note").innerHTML = `<p><b>${f}.</b> ${best.name} keeps neighbourhoods best (trustworthiness ${fmt(best.trust, 3)}); a random projection is worst (${fmt(sc.find((x) => x.name.startsWith("Random")).trust, 3)}), showing that a cheap linear squash of 80 dimensions mostly invents false neighbours. Even so, two coordinates predict wait with R² ≤ ${fmt(Math.max(...sc.map((x) => x.wait_r2)), 2)} against ${fmt(s.knn_r2_full, 2)} using all features: <b>a clear-looking map is not evidence that the outcome is explained</b>. Trustworthiness is sampled at ${T.params.sample} exams and depends on k and, for t-SNE, on perplexity and the random start.</p>`;
  }

  function mount() {
    seg($id("t13-site"), siteOpts, site, (f) => { site = f; drawSite(f); });
    const ms = S(site).scores.map((x) => x.name);
    seg($id("t13-method"), ms.map((m) => ({ v: m, label: m.split(" (")[0] })), method, (m) => { method = m; drawMap(); });
    seg($id("t13-color"), [{ v: "wait", label: "Colour: wait quartile" }, { v: "hour", label: "Colour: arrival hour" }], colorBy, (c) => { colorBy = c; drawMap(); });
    drawSite(site);
  }
  App.add({ id: "t13", label: "T13 · Dimensionality reduction", view, mount });
})();
