/* T15 · Behavioural factors behind body weight in adults, part 2: models checked against the truth. Data: window.DATA.t15 */
(function () {
  const T = window.DATA.t15, { fmt } = Charts, { card, seg, sec, tbl, $id } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  let pd = "sleep_hrs";

  function view() {
    const cv = T.cv, lin = cv[0], gb = cv.find((m) => m.name === "Gradient boosting");
    return `
    <div class="hero">
      <div><h1>Behavioural factors behind weight in adults · part 2</h1>
        <p>Topic 15 of this project. Part 1 found effects, curves and an interaction. Part 2 builds models of increasing flexibility and asks the audit questions real studies cannot: does the extra complexity pay off, do variable rankings match the true mechanism, are curves and interactions recovered, and would the model give the right answer to “what if we changed this?”</p></div>
      <div><div class="hero-fig num">${fmt(lin.r2 * 100, 0)}% → ${fmt(gb.r2 * 100, 0)}%<small>cross-validated R² of BMI, straight-line model vs gradient boosting. The best any model could do with this noise is ${fmt(T.ceiling_r2 * 100, 0)}%.</small></div></div>
    </div>
    <div class="callout warn"><p><b>An audit only the simulation allows.</b> Data come from <span class="mono">pipeline/behaviour_data.py</span>, where the BMI formula is known (printed in 15.2). A model that recovers it here has earned some trust; one that fails here should not be trusted on real data. A good fit does not make an association causal, and the “what-if” numbers are correct here only because the simulated mechanism has no hidden confounder. Not medical advice.</p></div>

    <section class="block">${sec("15.1", "Does more complexity pay?", "Five regressions of BMI on the 18 behavioural and background variables, scored by 5-fold cross-validation on " + fmt(T.n) + " adults. Linear models are interpretable; forests and boosting can bend and interact.")}
      <div class="grid g2">
        ${card({ title: "Cross-validated R²", sub: "Higher is better; dashed ceiling = the true noiseless formula", id: "t15-r2" })}
        ${card({ title: "Reading it", body: `<div id="t15-r2-note" class="sub" style="margin:0"></div>` })}
      </div>
      <div id="t15-cv" style="margin-top:14px"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Data needed", sub: "Hold-out R² vs number of adults used for training", id: "t15-curve" })}
        ${card({ title: "Obesity (BMI ≥ 30) as a classification", sub: "Hold-out ROC AUC", id: "t15-auc" })}
      </div>
    </section>

    <section class="block">${sec("15.2", "Do the models find the right drivers?", "Importance is the share of BMI variance lost when a variable is shuffled. <b>Truth</b> shuffles it inside the real formula; <b>Boosting</b> and <b>Linear</b> shuffle it for each fitted model on 25 % held-out adults. Rank correlation with the truth: boosting " + fmt(T.rank_corr.gb, 2) + ", linear " + fmt(T.rank_corr.linear, 2) + "; true top five found: boosting " + T.top5_overlap.gb + "/5, linear " + T.top5_overlap.linear + "/5.")}
      <div class="grid g2">
        ${card({ title: "Importance (% of variance)", sub: "Sorted by truth", id: "t15-imp" })}
        <div class="card"><h3>The data-generating formula</h3><div class="sub">Invented effect sizes, BMI units</div><div class="scroll" style="max-height:340px">${tbl([{ h: "Variable" }, { h: "Direct effect on BMI" }], T.importance.map((i) => [i.label, i.effect]))}</div></div>
      </div>
      <div class="callout" id="t15-imp-note"></div>
    </section>

    <section class="block">${sec("15.3", "Curves", "Partial dependence: set one variable to each value for everyone, leave the rest as observed, and average the prediction. The truth line applies the same operation to the real formula.")}
      <div class="controls"><span id="t15-pd-seg"></span></div>
      ${card({ title: "Average BMI as one variable is changed", sub: "Truth vs boosting vs linear model", id: "t15-pd" })}
      <div class="callout" id="t15-pd-note"></div>
    </section>

    <section class="block">${sec("15.4", "Interactions and mediation", "Two forms of complexity that a list of main effects cannot express.")}
      <div class="grid g2">
        ${card({ title: "Effect of frequent high-calorie food, by exercise level", sub: "Average BMI increase; truth vs models", id: "t15-int" })}
        ${card({ title: "Which products add predictive power?", sub: "Gain in cross-validated R² (points) when one product term is added to the linear model", id: "t15-pairs" })}
      </div>
      <div class="callout" id="t15-int-note"></div>
      <h3 style="margin:26px 0 8px">Stress, snacking and weight (mediation)</h3>
      <div id="t15-med"></div>
    </section>

    <section class="block">${sec("15.5", "What if we changed behaviour?", "Each row changes one behaviour for every held-out adult and averages the predicted change in BMI. The truth column recomputes the real formula. Correct answers need a correct causal structure as well as a good fit; here the structure is known to hold.")}
      <div class="grid g2">
        ${card({ title: "Average change in BMI", sub: "Negative = lower BMI", id: "t15-iv" })}
        <div id="t15-iv-tbl"></div>
      </div>
      <div class="callout" id="t15-iv-note"></div>
    </section>

    <section class="block">${sec("15.6", "Who is the model wrong about?", "Mean absolute error and average bias of the boosting model in subgroups of the held-out adults.")}
      <div id="t15-sub"></div>
      <div class="callout warn"><p><b>Limits.</b> Simulated, additive-plus-two-interactions mechanism with independent Gaussian noise; real bodies have genetics, medication, illness, measurement error in self-reported behaviour and feedback (people change behaviour because of their weight). Cross-validation here is random, not by time or by clinic. Treat the <i>method</i> (compare complexity, audit against structure, test interventions) as the deliverable, not the numbers.</p></div>
    </section>`;
  }

  function mount() {
    const M = T.cv;
    Charts.hbarChart($id("t15-r2"), { labelW: 250, fmt: (v) => fmt(v * 100, 1) + "%", valueName: "R²", max: Math.max(T.ceiling_r2, ...M.map((m) => m.r2)) * 1.05, items: [...M.map((m, i) => ({ label: m.name, value: m.r2, color: ["var(--muted)", "var(--s4)", "var(--s5, #8a5cd6)", "var(--s3)", "var(--s1)"][i] })), { label: "True formula (ceiling)", value: T.ceiling_r2, color: "var(--ink)" }] });
    const lin = M[0], pw = M[1], rf = M[3], gb = M[4];
    $id("t15-r2-note").innerHTML = `Adding every pairwise product to the linear model changes R² by ${fmt((pw.r2 - lin.r2) * 100, 1)} points: <b>the missing structure is not mainly interactions</b> but curvature (sleep) and a threshold (the food × exercise interaction depends on exercise being under 2 h). Trees capture both without being told: the forest adds ${fmt((rf.r2 - lin.r2) * 100, 1)} points and boosting ${fmt((gb.r2 - lin.r2) * 100, 1)}. The remaining gap to the ceiling (${fmt((T.ceiling_r2 - gb.r2) * 100, 1)} points) is what finite data and tuning cost. Lasso behaves like the linear model: nothing is useless enough to drop.`;
    $id("t15-cv").innerHTML = tbl([{ h: "Model" }, { h: "R²", r: 1 }, { h: "RMSE (BMI)", r: 1 }, { h: "MAE (BMI)", r: 1 }], M.map((m) => [m.name, fmt(m.r2, 3), fmt(m.rmse, 2), fmt(m.mae, 2)]));
    const c = T.curve;
    Charts.lineChart($id("t15-curve"), { x: c.map((_, i) => i), xTicks: c.map((_, i) => i), xLabel: (v) => fmt(c[v].n), height: 230, yMax: 0.8, series: [{ name: "Linear", color: "var(--muted)", values: c.map((x) => x.linear) }, { name: "Gradient boosting", color: "var(--s1)", values: c.map((x) => x.gb) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 3), tipHeader: (i) => `${fmt(c[i].n)} training adults` });
    Charts.hbarChart($id("t15-auc"), { labelW: 150, fmt: (v) => fmt(v, 3), valueName: "AUC", max: 1, items: T.classification.map((x, i) => ({ label: x.name, value: x.auc, color: ["var(--muted)", "var(--s1)"][i] })) });

    Charts.hbarChart($id("t15-imp"), { labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: "Variance lost", items: T.importance.flatMap((i) => [{ label: i.label + " · truth", value: i.truth, color: "var(--ink)" }, { label: "· boosting", value: Math.max(0, i.gb), color: "var(--s1)" }, { label: "· linear", value: Math.max(0, i.linear), color: "var(--muted)" }]).slice(0, 36) });
    const sl = T.importance.find((i) => i.f === "sleep_hrs");
    $id("t15-imp-note").innerHTML = `<p>Both models rank the leading drivers correctly. The telling difference is <b>${sl.label.toLowerCase()}</b>: truth ${fmt(sl.truth, 1)}%, boosting ${fmt(sl.gb, 1)}%, linear ${fmt(sl.linear, 1)}%. A straight line cannot represent a U-shape, so the linear model reports sleep as nearly irrelevant, and a reader of its coefficients would conclude “sleep does not matter”. Variables with no direct effect (income, transport, water, meals, height) score about zero in both models, even though part 1 showed they correlate with BMI: adjustment has separated association from effect.</p>`;

    const keys = Object.keys(T.pdp);
    seg($id("t15-pd-seg"), keys.map((k) => ({ v: k, label: T.pdp[k].label })), pd, (v) => { pd = v; drawPd(); });
    drawPd();
    Charts.barChart($id("t15-int"), { categories: T.interaction.map((i) => `${i.band} (n=${i.n})`), height: 230, series: [{ name: "Truth", color: "var(--ink)", values: T.interaction.map((i) => i.truth) }, { name: "Boosting", color: "var(--s1)", values: T.interaction.map((i) => i.gb) }, { name: "Linear", color: "var(--muted)", values: T.interaction.map((i) => i.linear) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => "+" + fmt(v, 2) + " BMI" });
    Charts.hbarChart($id("t15-pairs"), { labelW: 250, fmt: (v) => fmt(v, 2), valueName: "R² gain (points)", items: T.pair_gain.map((p) => ({ label: `${p.a} × ${p.b}`, value: Math.max(0, p.gain), color: "var(--s2)" })) });
    const i0 = T.interaction[0], i2 = T.interaction[2];
    $id("t15-int-note").innerHTML = `<p>The cost of frequent high-calorie food is +${fmt(i0.truth, 1)} BMI for adults exercising under 2 h a week and +${fmt(i2.truth, 1)} for those exercising 4+ h. The linear model must give one number for everybody (+${fmt(i0.linear, 1)}); boosting finds the gradient (+${fmt(i0.gb, 1)} and +${fmt(i2.gb, 1)}). A product term of two variables ranked first by gain is not necessarily an interaction in the mechanism: sleep × stress scores highest because stress is itself driven by sleep, so the product partly stands in for the U-shape. Statistical screening suggests candidates; subject knowledge decides.</p>`;
    const m = T.mediation;
    $id("t15-med").innerHTML = `<div class="statrow">${[["Total effect of +1 stress point", "+" + fmt(m.total, 3), "BMI, controlling " + m.controls.join(", ").toLowerCase()], ["Stress → snacking", "+" + fmt(m.a, 3), "snacking levels per stress point (a)"], ["Snacking → BMI", "+" + fmt(m.b, 3), "BMI per snacking level, given stress (b)"], ["Direct effect", "+" + fmt(m.direct, 3), "after adding snacking"], ["Mediated share", fmt(m.share, 0) + "%", `indirect a×b = ${fmt(m.indirect, 3)}`]].map(([a, b, c]) => `<div class="card"><div class="sub">${a}</div><div class="big">${b}</div><div class="sub" style="margin:4px 0 0">${c}</div></div>`).join("")}</div>
      <div class="callout"><p>Most of stress's association with weight runs through snacking: once snacking is held fixed, the stress effect shrinks to ${fmt(m.direct, 2)}. In the simulation stress has a small direct term (0.1) plus the path through snacking, so a mediation estimate close to this is correct. It would be a policy mistake to “reduce stress” expecting the total effect without addressing eating, or to treat stress as irrelevant because its direct effect is small. Mediation analysis also rests on no unmeasured confounding of the stress → snacking → BMI chain, which a survey cannot guarantee.</p></div>`;

    const iv = T.interventions;
    Charts.hbarChart($id("t15-iv"), { labelW: 220, fmt: (v) => fmt(v, 2), valueName: "ΔBMI", items: iv.flatMap((x) => [{ label: x.name + " · truth", value: x.truth, color: "var(--ink)" }, { label: "· boosting", value: x.gb, color: "var(--s1)" }, { label: "· linear", value: x.linear, color: "var(--muted)" }]).slice(0, 21) });
    $id("t15-iv-tbl").innerHTML = tbl([{ h: "Change applied to everyone" }, { h: "Truth", r: 1 }, { h: "Boosting", r: 1 }, { h: "Linear", r: 1 }], iv.map((x) => [x.name, fmt(x.truth, 2), fmt(x.gb, 2), fmt(x.linear, 2)]));
    const sleep = iv.find((x) => x.name.startsWith("Sleep")), water = iv.find((x) => x.name.startsWith("Drink"));
    $id("t15-iv-note").innerHTML = `<p>For effects that are straight lines (diet, vegetables, screen time) both models give about the right answer. For <b>sleep</b> the linear model says ${fmt(sleep.linear, 2)} against the true ${fmt(sleep.truth, 2)}: it would under-sell the one intervention that depends on <i>where</i> a person starts. Neither model should predict a change from the water intervention (truth ${fmt(water.truth, 2)}); boosting and linear both report ${fmt(water.gb, 2)} and ${fmt(water.linear, 2)}, small values that remind us how much noise sits in an effect estimate.</p>`;
    $id("t15-sub").innerHTML = tbl([{ h: "Subgroup" }, { h: "Adults", r: 1 }, { h: "MAE (BMI)", r: 1 }, { h: "Bias (pred − obs)", r: 1 }], T.subgroups.map((g) => [g.group, fmt(g.n), fmt(g.mae, 2), (g.bias > 0 ? "+" : "") + fmt(g.bias, 2)]));
  }

  function drawPd() {
    const p = T.pdp[pd];
    Charts.lineChart($id("t15-pd"), { x: p.x, xTicks: p.x, xLabel: (v) => fmt(v, v % 1 ? 1 : 0), height: 260, series: [{ name: "Truth", color: "var(--ink)", values: p.truth }, { name: "Boosting", color: "var(--s1)", values: p.gb }, { name: "Linear", color: "var(--muted)", values: p.linear }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `${p.label} = ${fmt(p.x[i], 1)}` });
    const msg = { sleep_hrs: "The true curve is a U with its minimum at 7.5 h. Boosting follows it; the straight line slopes down and so tells short sleepers that more sleep is always better, including past 9 h.", activity_hrs_week: "Declining line, with the food-by-exercise interaction making the fall steeper for the first two hours. Both models follow reasonably.", screen_hrs_day: "Rises then flattens at 6 h. Boosting captures the plateau; the line keeps rising.", age: "Close to a line; both models match, as expected.", water_l_day: "Truth is flat. Any visible wobble in a model curve is noise, a reminder of how flexible models can invent small effects." };
    $id("t15-pd-note").innerHTML = `<p>${msg[pd]}</p>`;
  }
  App.add({ id: "t15", label: "T15 · Weight: model", view, mount });
})();
