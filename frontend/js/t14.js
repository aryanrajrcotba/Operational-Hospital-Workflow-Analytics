/* T14 · Behavioural factors behind body weight in adults, part 1: exploration. Data: window.DATA.t14 (simulated survey) */
(function () {
  const T = window.DATA.t14, { fmt } = Charts, { card, seg, sec, tbl, $id } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const CC = ["var(--s1)", "var(--s3)", "var(--s4)", "var(--s2)"];
  let shape = "sleep_hrs", sortBy = "adj";

  function view() {
    const top = T.factors.slice().sort((a, b) => Math.abs(b.adj) - Math.abs(a.adj))[0];
    return `
    <div class="hero">
      <div><h1>Behavioural factors behind weight in adults · part 1</h1>
        <p>Topic 14 of this project. Weight is shaped by many behaviours that are tangled with each other and with age, sex and income. Before fitting a model, look: how is BMI distributed, which behaviours move with it, how much of that survives once the obvious confounders are held fixed, and which relationships a single correlation number hides?</p></div>
      <div><div class="hero-fig num">${fmt(T.obese_share, 0)}%<small>of ${fmt(T.n)} simulated adults have BMI ≥ 30; mean BMI ${fmt(T.bmi_mean, 1)}, SD ${fmt(T.bmi_sd, 1)}. Largest adjusted single effect: ${top.label.toLowerCase()} (${top.adj > 0 ? "+" : ""}${fmt(top.adj, 2)} BMI per SD)</small></div></div>
    </div>
    <div class="callout warn"><p><b>Simulated data, not people.</b> The workbook says nothing about body weight, so ${fmt(T.n)} adults are generated in the shape of a lifestyle survey (<span class="mono">pipeline/behaviour_data.py</span>): eating, activity, screen time, sleep, stress, transport, income, family history. Effect sizes are invented. The advantage is that the true mechanism is known, so in T15 every model can be checked against it. Nothing on this page is a finding about real populations or medical advice.</p></div>

    <section class="block">${sec("14.1", "The outcome: BMI", "Body-mass index is weight in kg divided by height in metres squared. Categories use the standard cut-offs (18.5, 25, 30). Weight itself is mostly height; BMI is the outcome used throughout.")}
      <div class="grid g2">
        ${card({ title: "BMI distribution", sub: "Adults per 1-unit bin (right-skewed, as real BMI is)", id: "t14-hist" })}
        ${card({ title: "Weight categories by sex", sub: "Percent of each group", id: "t14-cat" })}
      </div>
    </section>

    <section class="block">${sec("14.2", "One behaviour at a time, then adjusted", "Effect on BMI of a one-standard-deviation increase (binary factors: presence vs absence in SD units), with 95 % intervals. <b>Crude</b> uses the factor alone; <b>adjusted</b> also holds fixed " + T.adjust.join(", ").toLowerCase() + ". Where the two differ, confounding is at work.")}
      <div class="controls"><span id="t14-sort"></span></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
        ${card({ title: "Effect of +1 SD on BMI", sub: "Crude (grey) and adjusted (blue), BMI units", id: "t14-eff" })}
        ${card({ title: "Reading it", body: `<div id="t14-eff-note" class="sub" style="margin:0"></div>` })}
      </div>
      <div id="t14-tbl" style="margin-top:14px"></div>
    </section>

    <section class="block">${sec("14.3", "Confounding in one example: how people get to work", "Transport has <i>no direct effect</i> on weight in this simulation, but it is related to income, age and how much people exercise. Compare groups with the car-users as reference.")}
      <div class="grid g2">
        ${card({ title: "BMI difference vs car users", sub: "Crude, adjusted for age/sex/family history/income, and additionally for exercise", id: "t14-tr" })}
        ${card({ title: "Reading it", body: `<div id="t14-tr-note" class="sub" style="margin:0"></div>` })}
      </div>
      <div id="t14-tr-tbl" style="margin-top:14px"></div>
    </section>

    <section class="block">${sec("14.4", "Shapes a correlation hides", "A Pearson coefficient measures only straight-line association. Mean BMI by bin shows the shape; “non-linearity” is the share of the binned variation a straight line does <i>not</i> capture (0 = perfectly straight, 1 = none of it).")}
      <div class="controls"><span id="t14-shape-seg"></span></div>
      <div class="grid" style="grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)">
        ${card({ title: "Mean BMI by level", sub: "Points with ≥ 15 adults; hover for n", id: "t14-shape" })}
        ${card({ title: "Reading it", body: `<div id="t14-shape-note" class="sub" style="margin:0"></div>` })}
      </div>
    </section>

    <section class="block">${sec("14.5", "Behaviours combine", "Two behaviours together can matter more than the sum of their parts. Obesity share by weekly exercise band and frequent high-calorie food; and BMI by age band and sex.")}
      <div class="grid g2">
        ${card({ title: "Obesity share (BMI ≥ 30) by exercise × food", sub: "Percent of adults in each cell", id: "t14-grid" })}
        ${card({ title: "Mean BMI by age band and sex", sub: "BMI units", id: "t14-agesex" })}
      </div>
      <div class="callout" id="t14-int-note"></div>
    </section>

    <section class="block">${sec("14.6", "How tangled are the predictors?", "Correlated predictors make single-factor stories unreliable. Spearman correlation among behaviours, and the variance inflation factor (VIF: how well each predictor is reproduced by the others; above ~5 is a warning).")}
      <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
        ${card({ title: "Rank correlation matrix", sub: "Spearman ρ × 100, hover for names", id: "t14-corr" })}
        <div class="card"><h3>Strongest pairs</h3><div class="sub">Spearman ρ</div><div id="t14-pairs"></div><h3 style="margin-top:14px">Highest VIF</h3><div id="t14-vif"></div></div>
      </div>
      <div class="callout"><p><b>What to carry into T15.</b> (1) Several effects survive adjustment and look real; (2) sleep and age curve rather than slope, so a linear model will understate them; (3) exercise and high-calorie food interact; (4) transport and income look associated with weight through other variables; (5) the predictors are not seriously collinear, so the individual effects can be separated. T15 builds models and then checks each of these against the known mechanism.</p></div>
    </section>`;
  }

  function mount() {
    const B = T.bmi_hist;
    Charts.histBars($id("t14-hist"), { counts: B.counts, color: "var(--s1)", binLabel: (i) => `BMI ${B.lo + i * B.step}–${B.lo + (i + 1) * B.step}`, tickLabel: (i) => B.lo + i * B.step, height: 220 });
    Charts.barChart($id("t14-cat"), { categories: T.categories.map((c) => c.split(" (")[0]), height: 220, series: [{ name: "Female", color: "var(--s2)", values: T.by_sex.Female }, { name: "Male", color: "var(--s1)", values: T.by_sex.Male }], yFmt: (v) => fmt(v, 0) + "%", tipFmt: (v) => fmt(v, 1) + "%" });
    seg($id("t14-sort"), [{ v: "adj", label: "Sort by adjusted effect" }, { v: "crude", label: "Sort by crude effect" }, { v: "mi", label: "Sort by mutual information" }], sortBy, (v) => { sortBy = v; drawFactors(); });
    drawFactors();
    const tr = T.transport;
    Charts.barChart($id("t14-tr"), { categories: tr.slice(1).map((t) => t.group), height: 230, series: [{ name: "Crude", color: "var(--muted)", values: tr.slice(1).map((t) => t.crude_vs_car) }, { name: "Adjusted (age, sex, family, income)", color: "var(--s1)", values: tr.slice(1).map((t) => t.adj_vs_car) }, { name: "…and exercise", color: "var(--s3)", values: tr.slice(1).map((t) => t.adj_activity_vs_car) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 2) + " BMI" });
    $id("t14-tr-note").innerHTML = `Walkers look no different from drivers in the crude comparison (${fmt(tr[2].crude_vs_car, 2)}) because they are also older or poorer on average, which pushes BMI the other way. Adjusting for age, sex, family history and income reveals ${fmt(tr[2].adj_vs_car, 2)}. Adding weekly exercise brings it to ${fmt(tr[2].adj_activity_vs_car, 2)}: the difference travels <b>through exercise</b>, not through the mode of transport itself. Crude and adjusted answers can differ in size <i>and</i> sign; which one is “the effect” depends on the question (and on whether exercise is a mediator or a confounder).`;
    $id("t14-tr-tbl").innerHTML = tbl([{ h: "Group" }, { h: "Adults", r: 1 }, { h: "Mean BMI", r: 1 }, { h: "Crude vs car", r: 1 }, { h: "Adjusted vs car (± SE)", r: 1 }, { h: "+ exercise", r: 1 }], tr.map((t) => [t.group, fmt(t.n), fmt(t.mean_bmi, 2), t.crude_vs_car == null ? "–" : fmt(t.crude_vs_car, 2), t.adj_vs_car == null ? "–" : `${fmt(t.adj_vs_car, 2)} ± ${fmt(t.adj_se, 2)}`, t.adj_activity_vs_car == null ? "–" : fmt(t.adj_activity_vs_car, 2)]));
    const keys = Object.keys(T.shapes);
    seg($id("t14-shape-seg"), keys.map((k) => ({ v: k, label: T.shapes[k].label })), shape, (v) => { shape = v; drawShape(); });
    drawShape();
    const G = T.grid;
    Charts.matrix($id("t14-grid"), { rows: ["Normal food", "Frequent high-calorie"], cols: T.act_bands.map((b) => "Exercise " + b), values: [0, 1].map((f) => [0, 1, 2].map((a) => G.find((g) => g.act === a && g.favc === f).obese)), fmt: (v) => fmt(v, 0) + "%", labelW: 140, cell: 46,
      tipFn: (i, j, v) => `<div class="th">${i ? "Frequent high-calorie food" : "Normal food"}, exercise ${T.act_bands[j]}</div><div>${fmt(v, 1)}% obese</div><div>n = ${fmt(G.find((g) => g.act === j && g.favc === i).n)}</div>` });
    Charts.barChart($id("t14-agesex"), { categories: T.age_bands, height: 230, yMax: 30, series: [{ name: "Women", color: "var(--s2)", values: T.age_sex.map((a) => a.female) }, { name: "Men", color: "var(--s1)", values: T.age_sex.map((a) => a.male) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 2) });
    const a0 = G.find((g) => g.act === 0 && g.favc === 1), a2 = G.find((g) => g.act === 2 && g.favc === 1), b0 = G.find((g) => g.act === 0 && g.favc === 0), b2 = G.find((g) => g.act === 2 && g.favc === 0);
    $id("t14-int-note").innerHTML = `<p>Among adults who exercise under 2 h a week, frequent high-calorie food takes obesity from ${fmt(b0.obese, 1)}% to ${fmt(a0.obese, 1)}% (+${fmt(a0.obese - b0.obese, 1)} points, BMI +${fmt(a0.bmi - b0.bmi, 1)}); among those exercising 4+ h, from ${fmt(b2.obese, 1)}% to ${fmt(a2.obese, 1)}% (+${fmt(a2.obese - b2.obese, 1)} points, BMI +${fmt(a2.bmi - b2.bmi, 1)}). The same diet costs more when inactive: an <b>interaction</b>. Men's BMI also rises faster with age than women's (gap ${fmt(T.age_sex[0].male - T.age_sex[0].female, 1)} under 30, ${fmt(T.age_sex[4].male - T.age_sex[4].female, 1)} at 60+).</p>`;
    Charts.matrix($id("t14-corr"), { rows: T.corr.labels, cols: T.corr.cols.map((_, i) => i + 1), values: T.corr.r100, vmax: 100, diverging: true, fmt: (v) => "", labelW: 190, cell: 20,
      tipFn: (i, j, v) => `<div class="th">${T.corr.labels[i]}</div><div>${T.corr.labels[j]}</div><div>ρ = ${(v / 100).toFixed(2)}</div>` });
    $id("t14-pairs").innerHTML = T.top_pairs.slice(0, 6).map((p) => `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--grid);font-size:13px"><span>${p.a} · ${p.b}</span><b class="num">${fmt(p.r, 2)}</b></div>`).join("");
    $id("t14-vif").innerHTML = T.vif.slice().sort((a, b) => b.vif - a.vif).slice(0, 4).map((v) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--grid);font-size:13px"><span>${v.label}</span><b class="num">${fmt(v.vif, 2)}</b></div>`).join("");
  }

  function drawFactors() {
    const rows = T.factors.slice().sort((a, b) => (sortBy === "mi" ? b.mi - a.mi : Math.abs(b[sortBy]) - Math.abs(a[sortBy])));
    Charts.hbarChart($id("t14-eff"), { labelW: 220, fmt: (v) => (v > 0 ? "+" : "") + fmt(v, 2), valueName: "BMI per SD", divergeNeg: false, items: rows.flatMap((f) => sortBy === "mi" ? [{ label: f.label, value: f.mi, color: "var(--s3)" }] : [{ label: f.label + " · crude", value: f.crude, color: "var(--muted)" }, { label: f.label + " · adjusted", value: f.adj, color: "var(--s1)" }]).slice(0, 24) });
    $id("t14-eff-note").innerHTML = sortBy === "mi" ? `Mutual information measures any dependence, linear or not (units: nats). It ranks <b>sleep</b> far above its correlation with BMI would suggest because the sleep effect is U-shaped; age and activity rank lower than their slopes because the relation is a gentle straight line against a lot of noise.` :
      `Bars are the BMI change for a one-SD increase. Age (${fmt(T.factors.find((f) => f.f === "age").crude, 2)} crude, ${fmt(T.factors.find((f) => f.f === "age").adj, 2)} adjusted) and screen time strengthen after adjustment because the young use more screens; height shrinks to nothing once sex is held fixed (taller people are mostly male). Binary factors (family history, frequent high-calorie food) are the largest single effects. Intervals are in the table.`;
    $id("t14-tbl").innerHTML = `<div class="scroll" style="max-height:420px">${tbl([{ h: "Factor" }, { h: "Crude ± SE", r: 1 }, { h: "Adjusted ± SE", r: 1 }, { h: "Pearson r", r: 1 }, { h: "Spearman ρ", r: 1 }, { h: "Mutual info", r: 1 }], rows.map((f) => [f.label, `${fmt(f.crude, 2)} ± ${fmt(1.96 * f.crude_se, 2)}`, `${fmt(f.adj, 2)} ± ${fmt(1.96 * f.adj_se, 2)}`, fmt(f.pearson, 2), fmt(f.spearman, 2), fmt(f.mi, 3)]))}</div><div class="legend-note">Intervals are ±1.96 standard errors from ordinary least squares (n = ${fmt(T.n)}). Transport is a four-level category and is shown separately.</div>`;
  }

  function drawShape() {
    const s = T.shapes[shape], pts = s.pts;
    Charts.lineChart($id("t14-shape"), { x: pts.map((p) => p.x), xTicks: pts.map((p) => p.x), xLabel: (v) => fmt(v, v % 1 ? 1 : 0), height: 250, series: [{ name: "Mean BMI", color: "var(--s1)", values: pts.map((p) => p.mean) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `${s.label} ≈ ${fmt(pts[i].x, 1)} · n = ${fmt(pts[i].n)} · ±${fmt(1.96 * pts[i].se, 2)}` });
    const msg = { sleep_hrs: "Both short and long sleep go with higher BMI: a U-shape with a minimum near 7.5 h. The straight-line correlation is weak and negative, because most adults sleep 6–8 h and the long-sleep arm is small.", screen_hrs_day: "BMI rises with screen time then flattens beyond about 6 h: a saturating effect a straight line overstates at the high end.", activity_hrs_week: "More exercise goes with lower BMI, with diminishing returns at the top.", age: "BMI climbs steadily with age; the pattern is close to a line.", stress: "A weak positive relation, largely carried by snacking (see T15 on mediation).", water_l_day: "No pattern: water intake is a noise variable in this simulation, and the flat line is what “no effect” looks like." };
    $id("t14-shape-note").innerHTML = `${msg[shape]}<br><br>Pearson r = ${fmt(s.pearson, 2)}; non-linearity ${fmt(s.nonlinearity, 2)}.`;
  }
  App.add({ id: "t14", label: "T14 · Weight: explore", view, mount });
})();
