/* T7 · Patient prediction for improved staffing. Data: window.DATA.t7 */
(function () {
  const T7 = window.DATA.t7, { fmt } = Charts, { card, seg, sec, tbl, $id, SITES, siteOpts, dot } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const P = T7.params, S = (f) => T7.sites[f];
  const COL = { "Same hour last week": "var(--muted)", "Average for that weekday and hour": "var(--s4)", "Ridge regression": "var(--s3)", "Gradient boosting (Poisson)": "var(--s1)" };
  let site = "F1";

  function view() {
    const aucs = SITES.map((f) => S(f).risk.auc_gbm);
    return `
    <div class="hero">
      <div><h1>Patient prediction for improved staffing</h1>
        <p>Topic 7 of this project. Staffing is a bet on the future, so two things are predicted from the data available <i>before</i> the moment of decision: how many patients will arrive in each hour, and which individual patient is about to wait a long time. The first sets the roster; the second lets a charge nurse act on the day. Everything is trained on the first ${Math.round(P.train_fraction * 100)} % of each site's timeline and scored on the last ${100 - Math.round(P.train_fraction * 100)} %.</p></div>
      <div><div class="hero-fig num">${fmt(Math.min(...aucs), 2)}–${fmt(Math.max(...aucs), 2)}<small>hold-out AUC for flagging the patients who will wait longest (top quarter), across the four sites</small></div></div>
    </div>
    <div class="callout warn"><p><b>One assumption the workbook cannot supply.</b> Exam duration is not recorded, so staffing maths uses ${P.service_min.F1} minutes per exam and a target of mean queue wait ≤ ${P.wait_target_min} min (an M/M/c queue). Section 7.4 shows how far the answer moves if that number is wrong. Rooms below are <i>staffed</i> scanner rooms, not a claim about the real installed count.</p></div>
    <div class="controls"><span id="t7-site"></span></div>

    <section class="block" id="t7-demand">${sec("7.1", "How many patients arrive each hour?", "A count per operating hour, forecast from calendar position and lags that only look backwards (same hour last week, mean of the last four weeks, yesterday's total). Four predictors are compared on the hold-out period.")}
      <div class="grid g2">
        ${card({ title: "Hold-out error by method", sub: "Mean absolute error in patients per hour, lower is better", id: "t7-mae" })}
        ${card({ title: "A hold-out week", sub: "Actual hourly arrivals against two forecasts", id: "t7-week" })}
      </div>
      <div id="t7-models" style="margin-top:14px"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Typical day shape", sub: "Mean arrivals per hour (bars) and the roster that covers 90 % of past days (line)", id: "t7-profile" })}
        ${card({ title: "What the boosted model relies on", sub: "Increase in hold-out MAE when a feature is shuffled", id: "t7-imp" })}
      </div>
    </section>

    <section class="block" id="t7-roster">${sec("7.2", "From forecast to roster", "A forecast is only useful if it changes a decision. Each forecast is turned into the number of staffed rooms an M/M/c queue needs to keep the mean wait within target, then the roster is judged against the arrivals that actually came. The <b>oracle</b> knows the true arrivals; it marks the least staff-hours that would have met the target.")}
      <div class="grid g2">
        ${card({ title: "Patient-weighted mean queue wait", sub: "Minutes, under each roster on the hold-out period (target line = " + P.wait_target_min + " min)", id: "t7-plan-wait" })}
        ${card({ title: "Staff-hours against the oracle", sub: "Hold-out period, rooms × hours", id: "t7-plan-hours" })}
      </div>
      <div id="t7-plans" style="margin-top:14px"></div>
      <div class="callout" id="t7-plan-note"></div>
    </section>

    <section class="block" id="t7-risk">${sec("7.3", "Which patient will wait long?", "The second prediction is per patient, made at the moment of arrival from the department state (queue, scanners busy, recent waits, time of day). The target is “wait is in the longest quarter of the training period”. Wait, start delay and the begin time are excluded because they are the outcome.")}
      <div id="t7-risk-kpi"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Is the risk score honest?", sub: "Predicted vs observed share of long waits, by decile of predicted risk", id: "t7-calib" })}
        ${card({ title: "What drives the risk score", sub: "Fall in AUC when a feature is shuffled", id: "t7-risk-imp" })}
      </div>
      <div id="t7-alerts" style="margin-top:14px"></div>
    </section>

    <section class="block" id="t7-sens">${sec("7.4", "How much does the assumed exam length matter?", "Staffed rooms needed at the site's 95th-percentile busy hour, for four possible exam durations. If these rows differ a lot, collect actual exam durations before acting on any roster.")}
      ${tbl([{ h: "Site" }, { h: "Busy hour (arrivals/h)", r: 1 }, ...[20, 30, 45, 60].map((m) => ({ h: m + " min", r: 1 }))], T7.sensitivity.map((s) => [`${dot(s.site)}${s.site}`, fmt(s.peak_arrivals_per_hr, 1), ...[20, 30, 45, 60].map((m) => s.rooms[m])]))}
      <div class="callout warn"><p><b>Limits.</b> Hourly counts are small (about 1–6 per hour), so a hold-out MAE of a patient or so is a large <i>relative</i> error; summed over a day the forecast is much tighter (see daily MAPE). The queue model assumes exponential exam times and one pooled queue; real scanners differ by exam type. The risk model predicts waiting, not harm: it should prompt a look, not an automatic action.</p></div>
    </section>`;
  }

  function draw(f) {
    const s = S(f), d = s.demand, k = s.risk;
    const best = d.models.slice().sort((a, b) => a.mae - b.mae)[0];
    Charts.hbarChart($id("t7-mae"), { labelW: 210, fmt: (v) => fmt(v, 2), valueName: "MAE", items: d.models.map((m) => ({ label: m.name, value: m.mae, color: COL[m.name] })) });
    const w = d.weekly, idx = w.label.map((_, i) => i);
    Charts.lineChart($id("t7-week"), { x: idx, xTicks: idx.filter((i) => w.label[i].endsWith("8:00") || w.label[i].endsWith(d.hours[0] + ":00")), xLabel: (v) => w.label[v].split(" ")[0], height: 240,
      series: [{ name: "Actual", color: "var(--ink)", values: w.actual }, { name: "Boosting forecast", color: "var(--s1)", values: w.gbm }, { name: "Weekday-hour average", color: "var(--s4)", values: w.base }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1), tipHeader: (i) => w.label[i] });
    $id("t7-models").innerHTML = tbl([{ h: "Method" }, { h: "MAE", r: 1 }, { h: "RMSE", r: 1 }, { h: "Bias", r: 1 }, { h: "Daily MAE", r: 1 }, { h: "Daily MAPE", r: 1 }],
      d.models.map((m) => [`<i class="dot" style="background:${COL[m.name]}"></i>${m.name}`, fmt(m.mae, 2), fmt(m.rmse, 2), fmt(m.bias, 2), fmt(m.daily_mae, 1), fmt(m.daily_mape, 1) + "%"])) +
      `<div class="legend-note">${d.train_days} training days, ${d.test_days} hold-out days from ${d.test_start}; mean ${fmt(d.mean_per_hour, 2)} patients per operating hour. Best hourly MAE: <b>${best.name}</b> (${fmt(best.mae, 2)}).</div>`;
    Charts.barChart($id("t7-profile"), { categories: d.profile.hour.map((h) => h + ":00"), height: 230, series: [{ name: "Mean arrivals", color: "var(--s1)", values: d.profile.mean }, { name: "Rooms for 90 % of days", color: "var(--s2)", values: d.profile.need_p90 }], yFmt: (v) => fmt(v, v % 1 ? 1 : 0), tipFmt: (v) => fmt(v, 1) });
    Charts.hbarChart($id("t7-imp"), { labelW: 120, fmt: (v) => fmt(v, 3), valueName: "MAE increase", items: d.importance.slice(0, 8).map((x) => ({ label: x.feature, value: Math.max(0, x.mae_increase), color: "var(--s1)" })) });

    const pl = d.plans, PC = ["var(--muted)", "var(--s4)", "var(--s1)", "var(--s3)"];
    Charts.hbarChart($id("t7-plan-wait"), { labelW: 250, fmt: (v) => fmt(v, 1) + " min", valueName: "Mean wait", items: pl.map((p, i) => ({ label: p.name, value: p.patient_wait_min, color: PC[i] })) });
    Charts.hbarChart($id("t7-plan-hours"), { labelW: 250, fmt: (v) => fmt(v), valueName: "Staff-hours", items: [{ label: "Oracle (true arrivals)", value: d.oracle_staff_hours, color: "var(--ink)" }, ...pl.map((p, i) => ({ label: p.name, value: p.staff_hours, color: PC[i] }))] });
    $id("t7-plans").innerHTML = tbl([{ h: "Roster" }, { h: "Staff-hours", r: 1 }, { h: "vs oracle", r: 1 }, { h: "Hours short", r: 1 }, { h: "Rooms short", r: 1 }, { h: "Rooms spare", r: 1 }, { h: "Mean wait", r: 1 }, { h: "Hours over target", r: 1 }],
      pl.map((p) => [p.name, fmt(p.staff_hours), (p.staff_hours >= d.oracle_staff_hours ? "+" : "") + fmt((p.staff_hours / d.oracle_staff_hours - 1) * 100, 0) + "%", fmt(p.short_hours_pct, 1) + "%", fmt(p.shortfall), fmt(p.surplus), fmt(p.patient_wait_min, 1) + " min", fmt(p.waits_over_target_pct, 1) + "%"]));
    const bestPlan = pl.slice().sort((a, b) => a.patient_wait_min - b.patient_wait_min)[0];
    $id("t7-plan-note").innerHTML = `<p><b>${f}.</b> The lowest mean wait comes from “${bestPlan.name}” (${fmt(bestPlan.patient_wait_min, 1)} min), at ${fmt(bestPlan.staff_hours)} staff-hours against ${fmt(d.oracle_staff_hours)} for the oracle. A fixed roster set from history is the blunt reference: it is either idle at quiet hours or short at busy ones. The safety margin (${fmt(d.resid_sd, 2)} patients/hour, one forecast-error standard deviation × 0.84) trades extra rooms for fewer breaches; whether that is worth it depends on what a room-hour costs, which the workbook does not say.</p>`;

    $id("t7-risk-kpi").innerHTML = `<div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
      <div class="card"><div class="sub">Gradient boosting AUC</div><div class="hero-fig num" style="font-size:34px">${fmt(k.auc_gbm, 3)}</div></div>
      <div class="card"><div class="sub">Logistic regression AUC</div><div class="hero-fig num" style="font-size:34px">${fmt(k.auc_logit, 3)}</div></div>
      <div class="card"><div class="sub">“Long wait” means</div><div class="hero-fig num" style="font-size:34px">&gt; ${fmt(k.threshold_min, 0)} min</div></div>
      <div class="card"><div class="sub">Long-wait share, hold-out</div><div class="hero-fig num" style="font-size:34px">${fmt(k.base_rate, 1)}%</div></div></div>
      <div class="legend-note">${fmt(k.n_train)} training and ${fmt(k.n_test)} hold-out patients, ${k.n_features} features available at arrival.</div>`;
    const dec = k.calibration;
    Charts.lineChart($id("t7-calib"), { x: dec.map((c) => c.decile), xTicks: dec.map((c) => c.decile), xLabel: (v) => v, height: 230, yMax: 100, series: [{ name: "Predicted", color: "var(--muted)", values: dec.map((c) => c.pred) }, { name: "Observed", color: "var(--s1)", values: dec.map((c) => c.obs) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `Decile ${dec[i].decile} of predicted risk` });
    Charts.hbarChart($id("t7-risk-imp"), { labelW: 190, fmt: (v) => fmt(v, 3), valueName: "AUC drop", items: k.importance.map((x) => ({ label: x.feature, value: Math.max(0, x.auc_drop), color: "var(--s1)" })) });
    $id("t7-alerts").innerHTML = `<h3 style="margin:6px 0 8px">If staff acted on the top slice of risk scores</h3>` + tbl([{ h: "Flag the top…" }, { h: "Share of flagged who really wait long", r: 1 }, { h: "Share of all long waits caught", r: 1 }, { h: "Lift over chance", r: 1 }],
      k.alerts.map((a) => [`${a.top_pct}% of arrivals`, fmt(a.precision, 1) + "%", fmt(a.recall, 1) + "%", "×" + fmt(a.lift, 2)]));
  }

  function mount() { seg($id("t7-site"), siteOpts, site, (f) => { site = f; draw(f); }); draw(site); }
  App.add({ id: "t7", label: "T7 · Staffing", view, mount });
})();
