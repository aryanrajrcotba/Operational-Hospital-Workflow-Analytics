/* Home · working tools for clinicians and unit managers. Everything runs in the browser from the exported models in
   window.DATA.home plus T7-T9 results. Three tools: department load & staffing, report reader, lifestyle & weight what-if. */
(function () {
  const H = window.DATA.home, T7 = window.DATA.t7, T8 = window.DATA.t8, T9 = window.DATA.t9, { fmt } = Charts, { card, seg, sec, $id, SITES, siteOpts, dot, col } = UI;
  const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const TARGET = T7.params.wait_target_min;

  // ------------------------------------------------------------------ queueing (same maths as pipeline/ops.py)
  function erlangC(c, a) { if (c <= a) return 1; let s = 0, term = 1; for (let k = 0; k < c; k++) { s += term; term *= a / (k + 1); } const top = (term * c) / (c - a); return top / (s + top); }
  function meanWait(c, lam, svc) { if (lam <= 0) return 0; const a = (lam * svc) / 60; if (c <= a) return Infinity; return (60 * erlangC(c, a)) / (c * (60 / svc) - lam); }
  function roomsNeeded(lam, svc) { if (lam <= 0) return 0; let c = Math.max(1, Math.ceil((lam * svc) / 60 + 1e-9)); while (c < 60 && meanWait(c, lam, svc) > TARGET) c++; return c; }

  // ------------------------------------------------------------------ report reader
  const esc_re = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const LEX = {};
  H.text.anatomy.forEach((t) => (LEX[t.toLowerCase()] = "ANATOMY")); H.text.findings.forEach((t) => (LEX[t.toLowerCase()] = "FINDING"));
  const TERM_RE = new RegExp("\\b(" + Object.keys(LEX).sort((a, b) => b.length - a.length).map(esc_re).join("|") + ")\\b", "gi");
  const SIZE_RE = /\b\d+(?:\.\d+)?\s?(?:mm|cm)\b/gi;
  const PRE_NEG = /\b(no|without|negative for|absence of|free of|no evidence of|denies)\b/, POST_NEG = /\b(has resolved|was ruled out|is not seen|are not seen|not seen|ruled out|absent)\b/;
  const PRE_UNC = /\b(possible|cannot exclude|may represent|suspicious for|likely|questionable|probable|suggestive of|concern for)\b/;
  const VIX = Object.fromEntries(H.text.vocab.map((w, i) => [w, i]));
  function sentenceBounds(text, s, e) {
    const a = Math.max(text.lastIndexOf(".", s - 1), text.lastIndexOf(";", s - 1), text.lastIndexOf(":", s - 1)) + 1;
    const cands = [text.indexOf(".", e), text.indexOf(";", e)].filter((x) => x >= 0); return [a, cands.length ? Math.min(...cands) : text.length];
  }
  function analyse(text) {
    const ents = [];
    for (const m of text.matchAll(TERM_RE)) ents.push({ type: LEX[m[0].toLowerCase()], start: m.index, end: m.index + m[0].length, text: m[0] });
    for (const m of text.matchAll(SIZE_RE)) ents.push({ type: "SIZE", start: m.index, end: m.index + m[0].length, text: m[0] });
    ents.sort((a, b) => a.start - b.start);
    ents.filter((e) => e.type === "FINDING").forEach((e) => {
      const [a, b] = sentenceBounds(text, e.start, e.end), pre = text.slice(a, e.start).toLowerCase(), post = text.slice(e.end, b).toLowerCase();
      e.status = PRE_NEG.test(pre) || POST_NEG.test(post) ? "negated" : PRE_UNC.test(pre) ? "uncertain" : "present";
      e.sentence = [a, b];
    });
    const rows = ents.filter((e) => e.type === "FINDING").map((f) => {
      const inS = (x) => x.start >= f.sentence[0] && x.end <= f.sentence[1];
      const an = ents.find((x) => x.type === "ANATOMY" && inS(x)), sz = ents.find((x) => x.type === "SIZE" && inS(x));
      return { finding: f.text.toLowerCase(), status: f.status, site: an ? an.text : "–", size: sz ? sz.text : "–" };
    });
    const words = (text.toLowerCase().match(/[a-z][a-z\-]+/g) || []).filter((w) => w in VIX);
    let sc = H.text.logprior.slice();
    words.forEach((w) => H.text.logprob.forEach((row, k) => (sc[k] += row[VIX[w]])));
    const mx = Math.max(...sc), ex = sc.map((v) => Math.exp(v - mx)), z = ex.reduce((a, b) => a + b, 0);
    const cls = H.text.categories.map((c, i) => ({ c, p: ex[i] / z })).sort((a, b) => b.p - a.p);
    return { ents, rows, cls, known: words.length };
  }
  function drawReport() {
    const text = $id("rr-text").value, out = analyse(text);
    let html = "", pos = 0;
    out.ents.forEach((e) => { if (e.start < pos) return; html += esc(text.slice(pos, e.start)) + `<mark class="ent ${e.type}" title="${e.type}">${esc(e.text)}${e.status ? `<sup>${e.status}</sup>` : ""}</mark>`; pos = e.end; });
    html += esc(text.slice(pos));
    $id("rr-annot").innerHTML = text.trim() ? html : `<span class="sub">Paste or type a report above.</span>`;
    const present = out.rows.filter((r) => r.status === "present"), unc = out.rows.filter((r) => r.status === "uncertain");
    $id("rr-flag").innerHTML = !text.trim() ? "" : present.length ? `<span class="pill" style="background:color-mix(in srgb,var(--div-neg) 22%,transparent)">Abnormal: ${present.length} finding${present.length > 1 ? "s" : ""} asserted present</span>${unc.length ? ` <span class="pill">${unc.length} uncertain, needs review</span>` : ""}` :
      `<span class="pill" style="background:color-mix(in srgb,var(--s3) 25%,transparent)">No finding asserted present</span>${unc.length ? ` <span class="pill">${unc.length} uncertain, needs review</span>` : ""}`;
    $id("rr-rows").innerHTML = out.rows.length ? UI.tbl([{ h: "Finding" }, { h: "Status" }, { h: "Site" }, { h: "Size" }], out.rows.map((r) => [r.finding, `<span class="pill">${r.status}</span>`, r.site, r.size])) : `<p class="sub">No known findings recognised.</p>`;
    $id("rr-cls").innerHTML = out.known < 4 ? `<p class="sub">Too few known words to guess the exam type.</p>` : out.cls.slice(0, 3).map((c) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--grid)"><span>${c.c}</span><b class="num">${fmt(c.p * 100, 0)}%</b></div>`).join("");
  }

  // ------------------------------------------------------------------ lifestyle what-if
  const W = H.weight, FIELDS = [
    ["age", "Age (years)", 18, 80, 1, 40], ["height_cm", "Height (cm)", 140, 205, 1, 170], ["male", "Sex", null, null, null, 0, ["Female", "Male"]], ["family_history", "Family history of overweight", null, null, null, 0, ["No", "Yes"]],
    ["high_cal_food", "Frequent high-calorie food", null, null, null, 0, ["No", "Yes"]], ["veg_freq", "Vegetables with meals (1 rarely – 3 always)", 1, 3, 1, 2], ["snacking", "Snacking between meals (0 never – 3 always)", 0, 3, 1, 1],
    ["activity_hrs_week", "Exercise (hours / week)", 0, 10, 0.5, 3], ["screen_hrs_day", "Screen time (hours / day)", 0, 12, 0.5, 4], ["sleep_hrs", "Sleep (hours / night)", 4, 10, 0.25, 7],
    ["stress", "Stress (0 – 10)", 0, 10, 1, 5], ["alcohol", "Alcohol (0 none – 3 often)", 0, 3, 1, 1], ["smoker", "Smoker", null, null, null, 0, ["No", "Yes"]], ["calorie_monitor", "Monitors calories", null, null, null, 0, ["No", "Yes"]]];
  const val = {}; FIELDS.forEach((f) => (val[f[0]] = f[5]));
  const xvec = (v) => ({ age: v.age, male: v.male, family_history: v.family_history, high_cal_food: v.high_cal_food, veg_freq: v.veg_freq, snacking: v.snacking, activity_hrs_week: v.activity_hrs_week, alcohol: v.alcohol, smoker: v.smoker, calorie_monitor: v.calorie_monitor, stress: v.stress,
    screen6: Math.min(v.screen_hrs_day, 6), sleep_sq: (v.sleep_hrs - 7.5) ** 2, favc_inactive: v.high_cal_food * (v.activity_hrs_week < 2 ? 1 : 0) });
  const bmiOf = (v) => { const x = xvec(v); return W.intercept + W.features.reduce((s, f, i) => s + W.coef[i] * x[f], 0); };
  const catOf = (b) => (b < 18.5 ? "underweight" : b < 25 ? "normal range" : b < 30 ? "overweight range" : "obese range");
  function drawWeight() {
    const b = bmiOf(val), x = xvec(val), h = val.height_cm / 100;
    $id("lw-out").innerHTML = `<div class="statrow"><div class="card"><div class="sub">Predicted BMI</div><div class="big">${fmt(b, 1)}</div><div class="sub" style="margin:4px 0 0">${catOf(b)} · typical error ± ${fmt(W.resid_sd * 1.96, 1)}</div></div>
      <div class="card"><div class="sub">At ${val.height_cm} cm</div><div class="big">${fmt(b * h * h, 0)} kg</div><div class="sub" style="margin:4px 0 0">implied weight</div></div></div>`;
    const contrib = W.features.map((f, i) => ({ label: W.labels[f], v: W.coef[i] * (x[f] - W.ref[f]) })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 8);
    Charts.hbarChart($id("lw-contrib"), { labelW: 250, divergeNeg: true, fmt: (v) => (v > 0 ? "+" : "") + fmt(v, 2), valueName: "BMI vs average adult", items: contrib.map((c) => ({ label: c.label, value: c.v, color: "var(--s2)" })) });
    const tries = [["+2 hours exercise per week", { activity_hrs_week: Math.min(10, val.activity_hrs_week + 2) }], ["Sleep 7.5 hours", { sleep_hrs: 7.5 }], ["Stop frequent high-calorie food", { high_cal_food: 0 }], ["Vegetables at every meal", { veg_freq: 3 }],
      ["Screen time at most 3 hours", { screen_hrs_day: Math.min(3, val.screen_hrs_day) }], ["Stress down by 2", { stress: Math.max(0, val.stress - 2) }], ["No snacking between meals", { snacking: 0 }]];
    const rows = tries.map(([n, ch]) => ({ n, d: bmiOf({ ...val, ...ch }) - b })).filter((r) => Math.abs(r.d) > 0.005).sort((a, c) => a.d - c.d);
    $id("lw-what").innerHTML = rows.length ? UI.tbl([{ h: "Change one thing" }, { h: "Predicted change in BMI", r: 1 }], rows.map((r) => [r.n, (r.d > 0 ? "+" : "") + fmt(r.d, 2)])) : `<p class="sub">Already at the favourable setting for every change tested.</p>`;
  }

  // ------------------------------------------------------------------ department load
  const st = { site: "F1", dow: 0, hour: null, rooms: null, svc: 30, growth: 0 };
  function drawOps() {
    const s8 = T8.sites[st.site], s9 = T9.sites[st.site], hours = s8.hours;
    if (st.hour == null || !hours.includes(st.hour)) st.hour = hours[Math.floor(hours.length / 2)];
    if (st.rooms == null) st.rooms = s8.installed;
    const lamOf = (d, hi) => ((s8.weekday_util[d][hi] || 0) * s8.installed * 60) / s8.service_min * (1 + st.growth / 100);
    const hi = hours.indexOf(st.hour), lam = lamOf(st.dow, hi), a = (lam * st.svc) / 60, w = meanWait(st.rooms, lam, st.svc), need = roomsNeeded(lam, st.svc), pw = erlangC(st.rooms, a);
    const status = w > TARGET ? ["Short-staffed", "var(--div-neg)"] : w > TARGET * 0.6 ? ["Tight", "var(--s4)"] : ["Comfortable", "var(--s3)"];
    $id("op-kpi").innerHTML = `<div class="statrow">${[["Expected arrivals this hour", fmt(lam, 1)], ["Chance a patient waits", Number.isFinite(w) ? fmt(Math.min(1, pw) * 100, 0) + "%" : "100%"], ["Expected queue wait", Number.isFinite(w) ? fmt(w, 1) + " min" : "grows without limit"], ["Rooms needed for ≤ " + TARGET + " min", need]]
      .map(([k, v]) => `<div class="card"><div class="sub">${k}</div><div class="big">${v}</div></div>`).join("")}<div class="card" style="border-left:3px solid ${status[1]}"><div class="sub">Status with ${st.rooms} room${st.rooms > 1 ? "s" : ""}</div><div class="big">${status[0]}</div></div></div>`;
    const waits = hours.map((h, i) => { const x = meanWait(st.rooms, lamOf(st.dow, i), st.svc); return Number.isFinite(x) ? Math.min(x, 60) : 60; });
    Charts.lineChart($id("op-day"), { x: hours, xTicks: hours, xLabel: (v) => v + ":00", height: 220, yMax: Math.max(TARGET * 2, ...waits), series: [{ name: "Expected wait with " + st.rooms + " rooms", color: col(st.site), values: waits }, { name: "Target", color: "var(--s4)", values: hours.map(() => TARGET) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1) + " min", tipHeader: (i) => `${DOW[st.dow]} ${hours[i]}:00` });
    Charts.barChart($id("op-rooms"), { categories: hours.map((h) => h + ":00"), height: 200, series: [{ name: "Rooms needed", color: col(st.site), values: hours.map((h, i) => roomsNeeded(lamOf(st.dow, i), st.svc)) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 0) + " rooms" });
    const al = T7.sites[st.site].risk.alerts.find((x) => x.top_pct === 10), cross = s9.headroom_installed === 0 ? "already misses the target in the model" : s9.crossing_month ? "first misses the target around " + s9.crossing_month : "holds the target for the next 12 months";
    $id("op-note").innerHTML = `<b>${st.site}.</b> The forecast trend is ${s9.growth_end >= 0 ? "+" : ""}${fmt(s9.growth_end, 1)}% in 12 months; with ${s8.installed} rooms the unit ${cross} (T9). The wait-risk model (T7) flags the top 10% of arrivals; ${fmt(al.precision, 0)}% of those really wait long and they cover ${fmt(al.recall, 0)}% of all long waits. Expected arrivals come from the typical ${DOW[st.dow]} pattern, not a live feed.`;
  }
  function opControls() {
    const s8 = T8.sites[st.site];
    const sel = (id, opts, v, cb) => { const e = $id(id); e.innerHTML = opts.map(([k, l]) => `<option value="${k}" ${String(k) === String(v) ? "selected" : ""}>${l}</option>`).join(""); e.onchange = () => cb(e.value); };
    sel("op-dow", DOW.map((d, i) => [i, d]), st.dow, (v) => { st.dow = +v; drawOps(); });
    sel("op-hour", s8.hours.map((h) => [h, h + ":00"]), st.hour, (v) => { st.hour = +v; drawOps(); });
    sel("op-rooms-sel", Array.from({ length: 14 }, (_, i) => [i + 1, i + 1]), st.rooms, (v) => { st.rooms = +v; drawOps(); });
    sel("op-svc", [20, 25, 30, 35, 40, 45, 60].map((m) => [m, m + " min"]), st.svc, (v) => { st.svc = +v; drawOps(); });
    sel("op-growth", [-10, 0, 10, 20, 30].map((g) => [g, (g > 0 ? "+" : "") + g + "%"]), st.growth, (v) => { st.growth = +v; drawOps(); });
  }

  // ------------------------------------------------------------------ view
  function view() {
    const nav = (id, t, d) => `<div class="card"><h3>${t}</h3><p class="sub" style="margin:4px 0 10px">${d}</p><button class="mini" data-go="${id}">Open ${id.toUpperCase()}</button></div>`;
    return `
    <div class="hero">
      <div><h1>Clinical &amp; operations workspace</h1>
        <p>One place to use what this project built. Three working tools, driven by the models in the analysis tabs: see how loaded a scanner department is and how many rooms it needs, read a free-text imaging report into structured findings, and explore how daily habits move body weight. The tabs after this page (T1–T15) explain how each result was produced.</p></div>
      <div><div class="hero-fig num">3 tools<small>department staffing · report reader · lifestyle what-if, all running in your browser with no data leaving the page</small></div></div>
    </div>
    <div class="callout warn"><p><b>Decision support demonstration, not a medical device.</b> Wait and staffing figures come from the published wait-time workbook plus an <i>assumed</i> exam length (the workbook does not record it). The report reader was trained and tested on <i>synthetic</i> reports and has not seen real clinical text. The lifestyle tool uses a <i>simulated</i> survey with invented effect sizes. None of it should drive diagnosis or treatment, and no patient data should be pasted into it without local approval.</p></div>

    <section class="block">${sec("A", "Department load and staffing", "Pick a site, weekday and hour. The tool estimates arrivals from the typical pattern at that site (T8), and a queueing model (T7/T9) gives the expected wait for the rooms you staff and the rooms needed to keep waits under " + TARGET + " minutes.")}
      <div class="controls"><span id="op-site"></span></div>
      <div class="controls" style="gap:14px"><label class="sub">Weekday <select id="op-dow"></select></label><label class="sub">Hour <select id="op-hour"></select></label><label class="sub">Rooms staffed <select id="op-rooms-sel"></select></label><label class="sub">Exam length <select id="op-svc"></select></label><label class="sub">Demand vs typical <select id="op-growth"></select></label></div>
      <div id="op-kpi"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Expected wait across the day", sub: "Minutes, with the rooms staffed above", id: "op-day" })}
        ${card({ title: "Rooms needed across the day", sub: "Smallest number keeping mean wait within target", id: "op-rooms" })}
      </div>
      <div class="callout"><p id="op-note"></p></div>
    </section>

    <section class="block">${sec("B", "Report reader", "Paste an imaging report. The tool highlights anatomy, findings and sizes (T11), decides for each finding whether it is present, negated or uncertain, flags the report abnormal if any finding is present, and guesses the exam type (T10).")}
      <div class="controls"><span class="sub">Try:</span><span id="rr-ex"></span></div>
      <textarea id="rr-text" rows="5" style="width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--ink);font:14px/1.5 inherit"></textarea>
      <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);margin-top:14px">
        <div class="card"><h3>Reading</h3><div id="rr-flag" style="margin:8px 0"></div><div class="annot" id="rr-annot"></div>
          <div class="legend"><span class="pill"><i class="dot" style="background:var(--s1)"></i>Anatomy</span><span class="pill"><i class="dot" style="background:var(--s2)"></i>Finding</span><span class="pill"><i class="dot" style="background:var(--s3)"></i>Size</span></div></div>
        <div class="card"><h3>Most likely exam type</h3><div class="sub">Naive Bayes, ${H.text.cv_accuracy}% correct on held-out synthetic reports</div><div id="rr-cls"></div></div>
      </div>
      <div style="margin-top:14px" id="rr-rows"></div>
      <div class="legend-note">Uses a fixed vocabulary of ${H.text.anatomy.length + H.text.findings.length} terms and negation cues (including "free of", "not seen", "ruled out", "likely"). Unknown terms are ignored; a negation the cue list does not know will be read as present, so always check the highlighted text.</div>
    </section>

    <section class="block">${sec("C", "Lifestyle and weight what-if", "Enter an adult's habits to see the predicted BMI, which habits push it up or down compared with the average adult in the survey, and the predicted effect of changing one habit (T14–T15).")}
      <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
        <div class="card"><h3>Habits</h3><div id="lw-form"></div></div>
        <div><div id="lw-out"></div>
          ${card({ title: "What moves this prediction", sub: "BMI points above (+) or below (−) the survey average", id: "lw-contrib" })}
          <div class="card" style="margin-top:14px"><h3>If one thing changed</h3><div id="lw-what"></div></div></div>
      </div>
      <div class="legend-note">Linear model with a sleep curve and a food × exercise term, R² ${fmt(W.cv_r2, 2)} (5-fold CV) on ${fmt(W.n)} simulated adults. Associations in simulated data, not clinical advice or proof that a change would work for an individual.</div>
    </section>

    <section class="block">${sec("D", "How the project fits together", "Each tool rests on tabs further along. Click through for the evidence, assumptions and the tests that were run.")}
      <div class="grid g3">
        ${nav("t7", "Staffing · T7, T8, T9", "Hourly demand forecasts, utilisation, long-wait risk, 12-month outlook and what-if scenarios behind tool A.")}
        ${nav("t11", "Report reading · T10, T11, T12", "Text classification, entity and negation extraction, ranking and word-sense disambiguation behind tool B.")}
        ${nav("t15", "Weight and habits · T14, T15", "Exploration, confounding, and models audited against a known mechanism behind tool C.")}
        ${nav("t1", "Data foundations · T1, T2, T3", "What the wait-time workbook contains, how it was standardised, cleaned and de-duplicated, and how missing data was handled.")}
        ${nav("t4", "Imaging methods · T4, T5, T6", "Enhancement, restoration, segmentation, registration, a CNN and an interactive CT viewer on a synthetic phantom.")}
        ${nav("t13", "Exploring high-dimensional data · T13", "Which 2-D map of an exam's 80 numbers can be trusted, and how many dimensions a model needs.")}
      </div>
    </section>`;
  }

  function mount() {
    document.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => App.go(b.dataset.go)));
    seg($id("op-site"), siteOpts, st.site, (f) => { st.site = f; st.rooms = null; st.hour = null; opControls(); drawOps(); });
    opControls(); drawOps();
    const ex = H.text.examples; $id("rr-text").value = ex[0];
    seg($id("rr-ex"), ex.map((_, i) => ({ v: i, label: "Example " + (i + 1) })), 0, (i) => { $id("rr-text").value = ex[i]; drawReport(); });
    $id("rr-text").oninput = drawReport; drawReport();
    $id("lw-form").innerHTML = FIELDS.map((f) => f[6] ? `<div class="controls" style="justify-content:space-between;margin:6px 0"><span>${f[1]}</span><span class="seg" id="lw-${f[0]}"></span></div>` :
      `<div style="margin:8px 0"><div style="display:flex;justify-content:space-between"><span>${f[1]}</span><b class="num" id="lw-v-${f[0]}">${f[5]}</b></div><input type="range" id="lw-${f[0]}" min="${f[2]}" max="${f[3]}" step="${f[4]}" value="${f[5]}" style="width:100%"></div>`).join("");
    FIELDS.forEach((f) => {
      if (f[6]) seg($id("lw-" + f[0]), f[6].map((l, i) => ({ v: i, label: l })), val[f[0]], (v) => { val[f[0]] = v; drawWeight(); });
      else $id("lw-" + f[0]).oninput = (e) => { val[f[0]] = +e.target.value; $id("lw-v-" + f[0]).textContent = e.target.value; drawWeight(); };
    });
    drawWeight();
  }
  App.addFirst({ id: "home", label: "Home", view, mount });
})();
