/* T3 · Preprocessing of EHR data: redundant data removal + missing data. Data: window.DATA.t3 */
(function () {
  const T3 = window.DATA.t3, { fmt, table } = Charts, { card, seg, sec, tbl, dot, col, siteOpts, $id, SITES } = UI;
  const S = (f) => T3.sites[f];
  const STAGES = [
    { id: "collinear", label: "Near-duplicate (|r| ≥ " + T3.params.r_collinear + ")", color: "var(--s2)" },
    { id: "function", label: "Copy of another column", color: "var(--s4)" },
    { id: "constant", label: "Constant at this site", color: "var(--muted)" },
    { id: "identical", label: "Identical column", color: "var(--s1)" },
  ];
  const KEPT = "var(--s3)";
  const stageLabel = (id) => (STAGES.find((s) => s.id === id) || {}).label || id;
  const stageColor = (id) => (STAGES.find((s) => s.id === id) || {}).color || "var(--ink-2)";
  const METHOD_COLOR = { "Column mean": "var(--muted)", "Column median": "var(--ink-2)", "Carry last value": "var(--s4)", "Time interpolation": "var(--s3)", "k-nearest rows": "var(--s1)", "Regression (iterative)": "var(--s2)" };
  const pct = (a, b) => fmt((a / b) * 100, 1) + "%";
  const sum = (fn) => SITES.reduce((a, f) => a + fn(f), 0);
  const mono = (c) => `<span class="mono">${c}</span>`;

  // ------------------------------------------------------------------ view
  function view() {
    const f1 = S("F1"), cells = sum((f) => S(f).structural_cells), removed = sum((f) => S(f).features_start - S(f).features_kept);
    const maeShift = Math.max(...SITES.map((f) => Math.abs(S(f).model_after.hgb.mae - S(f).model_before.hgb.mae)));
    const bm4 = S("F4").explicit_missing.by_month.slice().sort((a, b) => b.missing - a.missing).slice(0, 3).sort((a, b) => (a.month < b.month ? -1 : 1));
    const topMonths = { n: bm4.reduce((a, m) => a + m.missing, 0), label: bm4.map((m) => ml(m.month)).join(", ") };
    const concept = [
      ["Redundant records", "The same event stored twice: exact duplicates, re-sent messages, one patient registered under two IDs. Removing them stops double counting. <b>Only remove what is provably the same event.</b>", ["exact duplicate", "same key", "near-duplicate"]],
      ["Redundant features", "Columns that carry no new information: constant, a copy or transform of another column, or so correlated with one that they are interchangeable. They inflate dimensionality and make coefficients unstable.", ["constant", "copy", "collinear"]],
      ["Missing data", "MCAR: gaps unrelated to anything. MAR: gaps depend on other recorded values. MNAR: gaps depend on the missing value itself. <b>The mechanism decides which fixes are safe.</b>", ["MCAR", "MAR", "MNAR"]],
      ["Hidden missingness", "A value that is <i>undefined</i> but stored as 0, −1 or 999. An average of nobody is not 0. These never show up as blanks, so a null count says the file is clean when it is not.", ["sentinel", "structural zero"]],
    ].map(([h, p, chips]) => `<div class="card concept"><div class="tag">Concept</div><h3>${h}</h3><p>${p}</p><div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div></div>`).join("");

    const recRows = SITES.map((f) => { const r = S(f).records; return [`${dot(f)}${f}`, fmt(r.rows), fmt(r.exact_duplicate_rows), fmt(r.duplicate_time_keys), `${fmt(r.shared_arrival_rows)} <span class="legend-note">(${fmt(r.shared_arrival_groups)} pairs)</span>`, r.shared_arrival_distinct_wait_share == null ? "–" : fmt(r.shared_arrival_distinct_wait_share, 0) + "%", fmt(r.identical_state_rows)]; });

    return `
    <div class="hero">
      <div><h1>Preprocessing EHR data: redundancy and missing values</h1>
        <p>Topic 3 of this project. T2 made the four sheets comparable and repaired obvious errors. T3 asks two harder questions: what can be <b>removed</b> without losing information, and what is <b>missing</b> once you look past the blank cells.</p></div>
      <div><div class="hero-fig num">${fmt(cells)}<small>cells that are undefined but were stored as 0, across the four sites (the file has only ${fmt(sum((f) => S(f).explicit_missing.cells))} blank cells)</small></div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="k">Records removed</div><div class="v">0</div><div class="s">no exact or key duplicates at any site</div></div>
      <div class="tile"><div class="k">Feature columns removed</div><div class="v">${fmt(removed)} <small style="font-size:14px;color:var(--muted)">of ${fmt(sum((f) => S(f).features_start))}</small></div><div class="s">F1 ${f1.features_start} → ${f1.features_kept}</div></div>
      <div class="tile"><div class="k">Largest accuracy change</div><div class="v">${fmt(maeShift, 2)} min</div><div class="s">wait-time MAE, gradient boosting, 30 % hold-out</div></div>
      <div class="tile"><div class="k">Best imputer (time-ordered)</div><div class="v" style="font-size:20px;padding-top:3px">Interpolation</div><div class="s">mean fill is worst, and flattens variance</div></div>
    </div>

    <section class="block" id="t3-concepts">${sec("3.1", "Two problems, four ideas",
      "Cleaning (T2) fixes values that are wrong. Preprocessing for analysis also decides which values are <i>needed</i> and which are <i>absent</i>. Both decisions should leave evidence behind, so each step below reports what it found and what removing it cost.")}
      <div class="grid g4">${concept}</div></section>

    <section class="block" id="t3-records">${sec("3.2", "Redundant records: nothing to delete",
      "Before touching columns, check whether any <i>rows</i> repeat. Three tests, from strictest to loosest. Only the first two justify deleting a row.")}
      ${tbl([{ h: "Facility" }, { h: "Rows", r: 1 }, { h: "Exact duplicate rows", r: 1 }, { h: "Same three timestamps", r: 1 }, { h: "Rows sharing an arrival time", r: 1 }, { h: "…with different waits", r: 1 }, { h: "Repeat another row's features", r: 1 }], recRows)}
      <div class="callout"><p><b>Why the loosest test does not delete anything.</b> ${fmt(sum((f) => S(f).records.shared_arrival_rows))} rows share an arrival timestamp with exactly one other row. In every pair the two exams have different waits, so they began at different times: two exams that were logged in the same second, not one event logged twice. The ${fmt(sum((f) => S(f).records.identical_state_rows))} rows whose predictors exactly repeat another row's all sit inside those pairs (the department state at that instant is the same for both; only the outcome differs). T2 flagged them with <span class="mono">flag_dup_arrival_ts</span>; they stay.</p></div>
    </section>

    <section class="block" id="t3-cols">${sec("3.3", "Redundant columns",
      `Each site has ${SITES.map((f) => S(f).features_start).join(", ")} candidate predictors. Columns are removed in four stages, strictest first, always keeping one representative so no information source disappears. Correlations use only the first ${Math.round(T3.params.train_fraction * 100)}% of each site's timeline so nothing is decided using the hold-out.`)}
      <div class="grid g2">
        ${card({ title: "What was removed, and why", sub: "Feature columns per site, split by the stage that removed them", id: "stg-chart", tableHTML: tbl([{ h: "Facility" }, { h: "Start", r: 1 }, ...STAGES.map((s) => ({ h: s.label, r: 1 })), { h: "Kept", r: 1 }], SITES.map((f) => [`${dot(f)}${f}`, S(f).features_start, ...STAGES.map((s) => (S(f).stages.find((x) => x.stage === s.id) || { dropped: 0 }).dropped), S(f).features_kept])) })}
        ${card({ title: "Stage definitions", sub: "Applied in this order", body: `<dl class="kv" style="row-gap:10px">
          <dt>1 · Constant</dt><dd>One value in every row. It means "not applicable here", e.g. thoracic and cardiac counts are always 0 at F1.</dd>
          <dt>2 · Identical</dt><dd>Every value equals an earlier column. None found: the constants above already covered them.</dd>
          <dt>3 · Copy</dt><dd>Spearman |ρ| ≥ ${T3.params.r_functional}: the column is a monotone function of another. <span class="mono">start_hour²</span>, <span class="mono">³</span>, <span class="mono">⁴</span> and <span class="mono">start_hour</span> itself are transforms of <span class="mono">arrival_hour</span>.</dd>
          <dt>4 · Near-duplicate</dt><dd>Complete-linkage clusters where <i>every</i> pair has |r| ≥ ${T3.params.r_collinear}. The member that tracks <span class="mono">wait_min</span> best (training window) is kept.</dd></dl>` })}
      </div>

      <h3 style="margin:26px 0 8px">Correlation structure <span class="pill" id="hm-site-lbl"></span></h3>
      <div class="controls"><span id="hm-seg"></span><span class="legend-note" style="margin:0">Columns ordered so correlated features sit together. Blue = positive, red = negative. The bar on the left shows each column's fate. Hover a cell for the pair.</span></div>
      <div class="grid g2" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
        <div class="card"><div id="hm-host"></div><div class="chips" id="hm-legend" style="margin-top:10px"></div></div>
        <div class="card"><h3>Near-duplicate clusters</h3><div class="sub">Kept column first, then the columns it replaces (r with the kept column)</div><div id="cl-list" class="scroll" style="max-height:430px"></div></div>
      </div>

      <h3 style="margin:26px 0 8px">Every decision</h3>
      <div class="controls"><input type="search" id="dq" placeholder="Search column or reason…" aria-label="Search decisions"><select id="ds" aria-label="Stage"><option value="">All stages</option>${STAGES.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}</select><span class="legend-note" id="dcount" style="margin:0"></span></div>
      <div id="dtable"></div>

      <h3 style="margin:26px 0 8px">Did removing columns cost accuracy?</h3>
      <p class="lede" style="margin-bottom:12px">A wait-time model is trained on the first 70 % of each site's timeline and scored on the last 30 %, once with all candidate columns and once with the reduced set. If the reduced set were losing signal, error would rise.</p>
      <div class="grid g2">
        ${card({ title: "Gradient boosting: hold-out MAE", sub: "Minutes, lower is better", id: "md-hgb" })}
        ${card({ title: "Ridge regression: hold-out MAE", sub: "Minutes, lower is better", id: "md-ridge" })}
      </div>
      ${tbl([{ h: "Facility" }, { h: "Columns", r: 1 }, { h: "GB MAE before → after", r: 1 }, { h: "GB R² before → after", r: 1 }, { h: "Ridge MAE before → after", r: 1 }, { h: "Ridge R² before → after", r: 1 }],
        SITES.map((f) => { const b = S(f).model_before, a = S(f).model_after; return [`${dot(f)}${f}`, `${S(f).features_start} → ${S(f).features_kept}`, `${fmt(b.hgb.mae, 2)} → ${fmt(a.hgb.mae, 2)}`, `${fmt(b.hgb.r2, 3)} → ${fmt(a.hgb.r2, 3)}`, `${fmt(b.ridge.mae, 2)} → ${fmt(a.ridge.mae, 2)}`, `${fmt(b.ridge.r2, 3)} → ${fmt(a.ridge.r2, 3)}`]; }))}
      <div class="callout"><p><b>Reading it.</b> Gradient-boosting error moves by at most ${fmt(Math.max(...SITES.map((f) => Math.abs(S(f).model_after.hgb.mae - S(f).model_before.hgb.mae))), 2)} min and ridge error by at most ${fmt(Math.max(...SITES.map((f) => Math.abs(S(f).model_after.ridge.mae - S(f).model_before.ridge.mae))), 2)} min, at most ${fmt(Math.max(...SITES.flatMap((f) => ["hgb", "ridge"].map((m) => (Math.abs(S(f).model_after[m].mae - S(f).model_before[m].mae) / S(f).model_before[m].mae) * 100))), 1)}% of the error itself, and not always upward. So the removed columns carried little that the kept ones do not already. That is a statement about <i>this</i> model, target and split; a threshold like 0.95 is a judgement call, and the full decision table is written to <span class="mono">t3_column_decisions.csv</span> so it can be revisited. ${T3.consensus.dropped_everywhere.length} columns are removed at all four sites (${T3.consensus.dropped_everywhere.map(mono).join(", ")}).</p></div>
    </section>

    <section class="block" id="t3-missing">${sec("3.4", "Missing data",
      "Three separate things get called missing data here: the blank cells, the zeros that mean \"undefined\", and the values we choose to hide to test an imputer.")}

      <h3 style="margin:8px 0 8px">Explicit gaps: blank cells</h3>
      <div class="grid g2">
        ${card({ title: "Where the blanks are", sub: "Rows with empty calendar fields, by month of arrival (dates as published)", id: "ex-chart" })}
        ${card({ title: "What the pattern says", body: `<dl class="kv" style="row-gap:10px">
          <dt>Extent</dt><dd>${SITES.map((f) => `${dot(f)}${f}: ${fmt(S(f).explicit_missing.cells)} cells in ${fmt(S(f).explicit_missing.rows)} row${S(f).explicit_missing.rows === 1 ? "" : "s"}`).join("<br>")}</dd>
          <dt>Which fields</dt><dd>Only <span class="mono">DayOfWeek</span>, <span class="mono">Month</span> and <span class="mono">DayOfYear</span>, always all three together in a row. Never a timestamp, never a measurement.</dd>
          <dt>Random?</dt><dd>Not obviously. At F4, ${topMonths.n} of ${S("F4").explicit_missing.rows} fall in ${topMonths.label}, and those rows waited longer (${fmt(S("F4").explicit_missing.wait_mean_missing, 1)} vs ${fmt(S("F4").explicit_missing.wait_mean_other, 1)} min mean). With ${S("F4").explicit_missing.rows} rows that is a hint of a logging gap, not proof, but deleting them would drop a slice of longer-waiting exams.</dd>
          <dt>Fix</dt><dd><b>Derive, don't estimate.</b> The calendar fields are fully determined by the arrival timestamp; the derivation reproduces the source on ${fmt(S("F4").explicit_missing.calendar_agreement.rows_checked)} known F4 rows with ${fmt(S("F4").explicit_missing.calendar_agreement.day_of_year, 1)}% agreement, so the values were filled exactly in T2. Imputation would be strictly worse.</dd></dl>` })}
      </div>

      <h3 style="margin:30px 0 8px">Hidden gaps: zeros that mean "undefined"</h3>
      <p class="lede" style="margin-bottom:12px">Many features are statistics over a set: the average age of people waiting, the last five waits, the day's longest wait. When the set is empty (nobody in line, nothing finished yet today) the statistic has no value, but the file stores 0. The search below looks, per site, for a count that is 0 exactly when a statistic is 0, and only accepts a rule if it holds on ≥ ${T3.params.struct_min_precision}% of rows where the count is 0 and explains ≥ ${T3.params.struct_min_recall}% of the statistic's zeros.</p>
      <div class="controls"><span id="st-seg"></span></div>
      <div class="grid g2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
        <div id="st-table"></div>
        ${card({ title: "Share of rows where the value is undefined", sub: "Per statistic, at the selected site", id: "st-chart" })}
      </div>
      <div class="callout"><p><b>What changes.</b> In <span class="mono">data/processed/F*_reduced.csv.gz</span> those cells are now blank (NaN) instead of 0, on exactly the rows the rule selects. Genuine zeros elsewhere (an average wait that really was 0) stay. Columns such as <span class="mono">none_in_line</span>, <span class="mono">none_completed</span> and <span class="mono">num_completed_today</span> already record <i>why</i> a value is blank, so no extra indicator columns are added. Discovered rules are inferences from the data; semantics such as "day_max_wait is undefined when nothing is in progress" should be confirmed with the source system's owner.</p></div>
      <div id="st-model"></div>

      <h3 style="margin:30px 0 8px">Choosing an imputer: hide values, then win them back</h3>
      <p class="lede" style="margin-bottom:12px">Real missingness has no ground truth. So take fully observed columns, delete values under a known mechanism, impute, and measure the error against the values we hid. Each cell is a mean of ${S("F1").benchmark.repeats} random masks on a ${fmt(S("F1").benchmark.rows)}-row time-ordered block. Error is normalised (RMSE ÷ column std), so <b>1.0 means "no better than knowing the mean"</b>.</p>
      <div class="controls"><span id="bm-site"></span><span id="bm-mech"></span></div>
      <div class="grid g2">
        ${card({ title: "Error of the imputed values", sub: "Normalised RMSE by fraction of values hidden", id: "bm-err" })}
        ${card({ title: "Is the spread of the data preserved?", sub: "Std of imputed values ÷ std of true values (1.0 is ideal)", id: "bm-sd" })}
      </div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Or just delete incomplete rows?", sub: "Share of rows left if every row with any hidden value is dropped", id: "bm-cc" })}
        ${card({ title: "How the mechanisms differ", body: `<dl class="kv" style="row-gap:10px">
          <dt>MCAR</dt><dd>Every value equally likely to vanish.</dd>
          <dt>MAR</dt><dd>Vanishing depends on the queue length (an observed column): busy periods lose more values.</dd>
          <dt>MNAR</dt><dd>High values are more likely to vanish than low ones. Nothing observed can fully repair this.</dd></dl><div class="legend-note" id="bm-cols"></div>` })}
      </div>
      <div class="callout warn"><p><b>Two cautions.</b> <i>Time interpolation</i> wins because these features are smooth through the day, but it uses the <i>next</i> row, so it is only valid for retrospective analysis; a live wait predictor must use carry-last-value or a model that accepts blanks. And <i>mean/median fill</i> looks harmless in a table of means yet collapses the spread (std ratio near 0 for the mean), which makes later variance, correlation and outlier estimates wrong.</p></div>

      <h3 style="margin:30px 0 8px">Policy applied to this dataset</h3>
      <div class="steps" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="step"><div class="n">1 · Derive</div><h3>Exact rules first</h3><p>Calendar fields come from the timestamp. No estimate involved.</p></div>
        <div class="step"><div class="n">2 · Mark</div><h3>Undefined ≠ 0</h3><p>Rule-selected zeros become blank; genuine zeros stay.</p></div>
        <div class="step"><div class="n">3 · Impute later</div><h3>Per use case</h3><p>Leave blanks for tree models; interpolate offline; carry forward online. Never mean-fill.</p></div>
        <div class="step"><div class="n">4 · Keep rows</div><h3>No deletion</h3><p>Deleting incomplete rows loses most of the data at even 10 % gaps.</p></div>
      </div>

      <h3 style="margin:30px 0 8px">Outputs (in <span class="mono">data/processed/</span>)</h3>
      ${tbl([{ h: "File", mono: 1 }, { h: "Contents" }, { h: "Rows", r: 1 }, { h: "Columns", r: 1 }, { h: "Blank cells", r: 1 }], [
        ...SITES.map((f) => [`${f}_reduced.csv.gz`, `${f}: T2 clean file minus ${S(f).features_start - S(f).features_kept} redundant columns; undefined statistics blank`, fmt(T3.outputs[f].rows), T3.outputs[f].cols, fmt(T3.outputs[f].nan_cells)]),
        ["t3_column_decisions.csv", "One row per site and candidate column: kept or dropped, stage, representative, reason, rows marked undefined", "", "", ""]])}
    </section>`;
  }
  const ml = (m) => { const [y, mo] = m.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo - 1] + " " + y.slice(2); };

  // ------------------------------------------------------------------ correlation heatmap (canvas)
  function drawCorr(host, hm) {
    host.innerHTML = "";
    const n = hm.cols.length, strip = 12, side = Math.min(host.clientWidth || 620, 640), cell = (side - strip) / n;
    const cv = document.createElement("canvas"), dpr = window.devicePixelRatio || 1;
    cv.width = side * dpr; cv.height = side * dpr; cv.style.cssText = `width:${side}px;height:${side}px;max-width:100%;display:block;cursor:crosshair`;
    host.appendChild(cv);
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const cs = getComputedStyle(document.documentElement), c = (v) => cs.getPropertyValue(v).trim();
    const pos = c("--accent"), neg = c("--div-neg");
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const P = hex(pos.length === 7 ? pos : "#2a78d6"), N = hex(neg.length === 7 ? neg : "#e34948");
    const surf = hex(c("--surface").length === 7 ? c("--surface") : "#fcfcfb");
    const mix = (rgb, a) => `rgb(${rgb.map((v, k) => Math.round(surf[k] + (v - surf[k]) * a))})`;
    for (let i = 0; i < n; i++) {
      g.fillStyle = hm.status[i] === "kept" ? c("--s3") : stageColor(hm.status[i]);
      g.fillRect(0, strip + i * cell, strip - 3, Math.max(1, cell - 0.5));
      g.fillRect(strip + i * cell, 0, Math.max(1, cell - 0.5), strip - 3);
      for (let j = 0; j < n; j++) {
        const r = hm.r100[i][j] / 100;
        g.fillStyle = mix(r >= 0 ? P : N, Math.min(1, Math.abs(r)));
        g.fillRect(strip + j * cell, strip + i * cell, Math.max(1, cell - 0.3), Math.max(1, cell - 0.3));
      }
    }
    const at = (e) => { const b = cv.getBoundingClientRect(), k = side / b.width; return [Math.floor(((e.clientY - b.top) * k - strip) / cell), Math.floor(((e.clientX - b.left) * k - strip) / cell)]; };
    cv.onmousemove = (e) => {
      const [i, j] = at(e);
      if (i < 0 || j < 0 || i >= n || j >= n) return Charts.tip(null);
      Charts.tip(`<div class="th">r = ${(hm.r100[i][j] / 100).toFixed(2)}</div><div style="color:var(--ink-2)">${hm.cols[i]}<br>${hm.cols[j]}</div>`, e);
    };
    cv.onmouseleave = () => Charts.tip(null);
  }

  // ------------------------------------------------------------------ mount
  function mount() {
    // stage stacked bars
    Charts.hbarChart($id("stg-chart"), { labelW: 50, max: Math.max(...SITES.map((f) => S(f).features_start)), items: SITES.map((f) => ({
      label: f, note: `${S(f).features_start} candidates`,
      parts: [{ name: "Kept", value: S(f).features_kept, color: KEPT }, ...STAGES.map((s) => ({ name: s.label, value: (S(f).stages.find((x) => x.stage === s.id) || { dropped: 0 }).dropped, color: s.color }))] })) });
    $id("stg-chart").insertAdjacentHTML("afterend", `<div class="legend" style="pointer-events:none"><span class="pill"><i class="dot" style="background:${KEPT}"></i>Kept</span>${STAGES.slice(0, 3).map((s) => `<span class="pill"><i class="dot" style="background:${s.color}"></i>${s.label}</span>`).join("")}</div>`);

    // correlation heatmap + clusters
    const drawHm = (f) => {
      const s = S(f);
      $id("hm-site-lbl").textContent = `${f} · ${s.heatmap.cols.length} columns`;
      drawCorr($id("hm-host"), s.heatmap);
      $id("hm-legend").innerHTML = `<span class="pill"><i class="dot" style="background:${KEPT}"></i>kept</span>` + STAGES.slice(0, 3).map((x) => `<span class="pill"><i class="dot" style="background:${x.color}"></i>${x.label}</span>`).join("");
      $id("cl-list").innerHTML = s.clusters.length ? s.clusters.map((c) => `<div style="padding:8px 0;border-bottom:1px solid var(--grid)"><div><b class="mono">${c.rep}</b> <span class="pill">kept</span></div><div class="chips">${c.members.map((m) => `<span class="chip mono" title="r with kept column">${m.col} · ${fmt(m.r, 2)}</span>`).join("")}</div></div>`).join("") : `<p class="sub">No near-duplicate clusters at this site.</p>`;
      drawTable(f);
    };
    let hmSite = "F1";
    seg($id("hm-seg"), siteOpts, hmSite, (f) => { hmSite = f; drawHm(f); });

    const drawTable = (f) => {
      const q = ($id("dq").value || "").toLowerCase(), st = $id("ds").value;
      const rows = S(f).decisions.filter((d) => (!st || d.stage === st) && (!q || (d.col + " " + d.reason + " " + d.family).toLowerCase().includes(q)));
      $id("dcount").textContent = `${f}: ${rows.length} of ${S(f).decisions.length} dropped columns`;
      $id("dtable").innerHTML = `<div class="scroll" style="max-height:380px">${tbl([{ h: "Column", mono: 1 }, { h: "Family" }, { h: "Stage" }, { h: "Replaced by", mono: 1 }, { h: "r", r: 1 }, { h: "Reason" }],
        rows.map((d) => [d.col, d.family, `<span class="pill"><i class="dot" style="background:${stageColor(d.stage)}"></i>${stageLabel(d.stage).split(" (")[0]}</span>`, d.rep || "–", d.r == null ? "–" : fmt(d.r, 3), d.reason]))}</div>`;
    };
    $id("dq").oninput = () => drawTable(hmSite); $id("ds").onchange = () => drawTable(hmSite);
    drawHm(hmSite);

    // model before / after
    const mo = (id, key) => Charts.barChart($id(id), { categories: SITES, height: 210, valueLabels: true, series: [
      { name: "All columns", color: "var(--muted)", values: SITES.map((f) => S(f).model_before[key].mae) },
      { name: "Reduced set", color: "var(--ink)", values: SITES.map((f) => S(f).model_after[key].mae) }], yFmt: (v) => fmt(v, v % 1 ? 1 : 0), tipFmt: (v) => fmt(v, 2) + " min" });
    mo("md-hgb", "hgb"); mo("md-ridge", "ridge");

    // explicit gaps (F4 by month, share of rows)
    const bm = S("F4").explicit_missing.by_month;
    Charts.barChart($id("ex-chart"), { categories: bm.map((m) => ml(m.month)), height: 220, valueLabels: true, series: [{ name: "F4 rows with blank calendar fields", color: "var(--s4)", values: bm.map((m) => m.missing) }], yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v) + " rows" });

    // structural rules
    const drawSt = (f) => {
      const s = S(f);
      $id("st-table").innerHTML = `<div class="scroll" style="max-height:440px">${tbl([{ h: "Statistic", mono: 1 }, { h: "Undefined when", mono: 1 }, { h: "Holds", r: 1 }, { h: "Explains zeros", r: 1 }, { h: "Rows", r: 1 }], s.structural.map((x) => [x.col, x.condition, fmt(x.precision, 1) + "%", fmt(x.recall, 1) + "%", fmt(x.share, 1) + "%"]))}</div>`;
      const items = s.structural.slice().sort((a, b) => b.share - a.share).slice(0, 14).map((x) => ({ label: x.col, value: x.share, color: "var(--s1)", note: x.condition }));
      Charts.hbarChart($id("st-chart"), { items, labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: "Undefined rows" });
      const nz = s.model_zero_coded, nn = s.model_nan_marked;
      $id("st-model").innerHTML = `<div class="legend-note" style="margin-top:0">${f}: ${fmt(s.structural_cells)} cells marked undefined across ${s.structural_cols_kept} kept columns. Hold-out wait-time error with the value stored as 0 vs left blank: gradient boosting ${fmt(nz.hgb.mae, 2)} → ${fmt(nn.hgb.mae, 2)} min; ridge (blanks filled with the training median) ${fmt(nz.ridge.mae, 2)} → ${fmt(nn.ridge.mae, 2)} min. Accuracy does not move; the point is that the data now says what it means.</div>`;
    };
    seg($id("st-seg"), siteOpts, "F1", drawSt); drawSt("F1");

    // imputation benchmark
    let bmSite = "F1", bmMech = "MCAR";
    const drawBm = () => {
      const b = S(bmSite).benchmark, x = b.rates;
      const mk = (src, yFmt, yMax) => b.methods.map((m) => ({ name: m, color: METHOD_COLOR[m], values: src[bmMech][m] }));
      Charts.lineChart($id("bm-err"), { x, xTicks: x, xLabel: (v) => v + "%", height: 250, yMax: 1.4, series: mk(b.nrmse), yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `${x[i]}% hidden · ${bmMech}` });
      Charts.lineChart($id("bm-sd"), { x, xTicks: x, xLabel: (v) => v + "%", height: 250, yMax: 1.2, series: mk(b.sd_ratio), yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `${x[i]}% hidden · ${bmMech}` });
      Charts.lineChart($id("bm-cc"), { x, xTicks: x, xLabel: (v) => v + "%", height: 220, yMax: 100, area: true, series: [{ name: `${bmMech}: rows kept`, color: "var(--ink)", values: b.rows_kept_if_deleted[bmMech] }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${x[i]}% of values hidden in each of ${b.cols.length} columns` });
      $id("bm-cols").innerHTML = `Columns masked (${b.cols.length}): ${b.cols.map(mono).join(", ")}. Always-observed helpers offered to the k-NN and regression imputers: ${b.aux.map(mono).join(", ")}.`;
    };
    seg($id("bm-site"), siteOpts, bmSite, (f) => { bmSite = f; drawBm(); });
    seg($id("bm-mech"), T3.sites.F1.benchmark.mechanisms.map((m) => ({ v: m, label: m })), bmMech, (m) => { bmMech = m; drawBm(); });
    drawBm();
  }

  App.add({ id: "t3", label: "T3 · EHR preprocessing", view, mount });
})();
