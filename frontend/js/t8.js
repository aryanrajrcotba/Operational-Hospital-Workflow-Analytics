/* T8 · Informed strategic planning, part 1: demand, load and the 12-month outlook. Data: window.DATA.t8 */
(function () {
  const T8 = window.DATA.t8, { fmt } = Charts, { card, seg, sec, tbl, $id, SITES, siteOpts, dot, col } = UI;
  const S = (f) => T8.sites[f];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const ml = (m) => { const [y, mo] = m.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo - 1] + " " + y.slice(2); };
  let site = "F1";

  function view() {
    const g = SITES.map((f) => S(f).forecast.growth_pct_per_year);
    return `
    <div class="hero">
      <div><h1>Informed strategic planning · part 1</h1>
        <p>Topic 8 of this project. Strategy starts with an honest picture of the present and a forecast that has been tested before it is trusted: how much demand each site carries, when scanners are stretched, how waiting responds to load, and where volume is heading over the next twelve months.</p></div>
      <div><div class="hero-fig num">${fmt(Math.min(...g), 0)}% to ${fmt(Math.max(...g), 0)}%<small>fitted yearly growth in exams per operating day, across the four sites (a linear trend, with an interval, see 8.4)</small></div></div>
    </div>
    <div class="callout warn"><p><b>Utilisation is an estimate.</b> Offered load = arrivals per hour × an assumed ${S("F1").service_min} min exam ÷ 60, divided by the largest number of scanners ever recorded in use on a day (<span class="mono">num_scanners_used_today</span>). The workbook has no exam durations or installed-scanner counts. A cell above 100 % means the assumed duration is too long for that scanner count, not that the site is physically overloaded.</p></div>
    <div class="controls"><span id="t8-site"></span></div>

    <section class="block">${sec("8.1", "Where each site stands", "Headline numbers for the selected site, computed over all operating days in the workbook.")}
      <div id="t8-kpi"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Mean start delay by arrival hour", sub: "Minutes between scheduled and actual start (negative values counted as 0)", id: "t8-hour" })}
        ${card({ title: "Share of exams starting over 15 min late, by hour", sub: "Percent of exams", id: "t8-late" })}
      </div>
    </section>

    <section class="block">${sec("8.2", "When is capacity tight?", "Estimated utilisation by weekday and hour of arrival: mean offered load ÷ scanners. It identifies which weekday-hours carry the strain, which is what a rota or an extended-hours decision should target.")}
      ${card({ title: "Estimated utilisation, weekday × hour", sub: "Percent of scanner capacity (darker = more loaded)", id: "t8-util" })}
      <div class="callout" id="t8-util-note"></div>
    </section>

    <section class="block">${sec("8.3", "How does waiting respond to load?", "Each exam is labelled with the number of patients who arrived in the same clock hour. Averaging delay within load bands gives an empirical load-to-delay curve; a knee in it is where adding capacity pays most.")}
      <div class="grid g2">
        ${card({ title: "Start delay vs arrivals in the same hour", sub: "Mean delay (min) and share starting over 15 min late", id: "t8-curve" })}
        ${card({ title: "Reading the curve", body: `<div id="t8-curve-note" class="sub" style="margin:0"></div>` })}
      </div>
    </section>

    <section class="block">${sec("8.4", "Demand outlook: 12 months, tested first", "Exams per operating day by month (first and last months are partial and dropped). A straight-line trend is fitted, then used to forecast the next twelve months with a 95 % band. Before that, the same method is re-run on the data <i>excluding the last five months</i> and compared with two naive forecasts.")}
      <div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
        ${card({ title: "Exams per operating day", sub: "Observed, fitted trend and forecast with 95 % band", id: "t8-fc" })}
        ${card({ title: "Backtest on the last 5 months", sub: "Mean absolute % error against what happened; lower is better", id: "t8-bt" })}
      </div>
      <div class="callout warn" id="t8-fc-note"></div>
    </section>`;
  }

  function draw(f) {
    const s = S(f), fc = s.forecast, k = s.kpi;
    $id("t8-kpi").innerHTML = `<div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr))">${[
      ["Exams per operating day", fmt(s.per_day, 1), `${fmt(s.exams)} exams over ${s.days} days`],
      ["Busiest hour, typical day", fmt(s.peak_hour_per_day, 1), "arrivals in that hour"],
      ["90th-percentile wait", fmt(k.p90_wait, 0) + " min", `${fmt(k.wait_gt30, 1)}% wait over 30 min`],
      ["Start over 15 min late", fmt(k.late15, 1) + "%", `mean delay ${fmt(k.mean_delay, 1)} min`],
      ["Peak est. utilisation", fmt(s.peak_util * 100, 0) + "%", `${DOW[s.peak_cell[0]]} ${s.peak_cell[1]}:00 · ${s.installed} scanners`]].map(([a, b, c]) =>
      `<div class="card"><div class="sub">${a}</div><div class="hero-fig num" style="font-size:30px">${b}</div><div class="sub" style="margin:6px 0 0">${c}</div></div>`).join("")}</div>`;
    const hd = s.hour_delay;
    Charts.barChart($id("t8-hour"), { categories: hd.hour.map((h) => h + ":00"), height: 220, series: [{ name: "Mean delay", color: col(f), values: hd.delay }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1) + " min" });
    Charts.barChart($id("t8-late"), { categories: hd.hour.map((h) => h + ":00"), height: 220, series: [{ name: "Over 15 min late", color: col(f), values: hd.late }], yFmt: (v) => fmt(v, 0) + "%", tipFmt: (v) => fmt(v, 1) + "%" });
    Charts.matrix($id("t8-util"), { rows: DOW, cols: s.hours.map((h) => h + ":00"), values: s.weekday_util.map((r) => r.map((v) => (v == null ? null : v * 100))), fmt: (v) => fmt(v, 0), labelW: 44,
      tipFn: (i, j, v) => `<div class="th">${DOW[i]} ${s.hours[j]}:00</div><div>${fmt(v, 0)}% estimated utilisation</div>` });
    $id("t8-util-note").innerHTML = `<p><b>${f}.</b> ${s.hours_over_80} of ${s.cells} weekday-hour cells are at or above 80 % estimated utilisation; the hottest is ${DOW[s.peak_cell[0]]} ${s.peak_cell[1]}:00 at ${fmt(s.peak_util * 100, 0)} %. ${s.peak_util > 1 ? "A value over 100 % is a sign that the assumed " + s.service_min + "-minute exam, or the " + s.installed + "-scanner count, does not fit this site: exams must be shorter or scanners more numerous than assumed. Read the pattern (which hours are relatively hot), not the absolute level." : "Below 100 % everywhere, so the assumed exam length is at least consistent with the scanners recorded."}</p>`;
    const lc = s.load_curve;
    Charts.lineChart($id("t8-curve"), { x: lc.map((_, i) => i), xTicks: lc.map((_, i) => i), xLabel: (v) => lc[v].bin, height: 240, series: [{ name: "Mean delay (min)", color: "var(--s2)", values: lc.map((c) => c.delay) }, { name: "Over 15 min late (%)", color: "var(--ink)", values: lc.map((c) => c.late) }],
      yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1), tipHeader: (i) => `${lc[i].bin} arrivals in the hour · ${fmt(lc[i].exams)} exams` });
    const first = lc[0], last = lc[lc.length - 1];
    $id("t8-curve-note").innerHTML = lc.length ? `Exams arriving in an hour with ${first.bin} arrivals are delayed ${fmt(first.delay, 1)} min on average (${fmt(first.late, 1)} % late); in an hour with ${last.bin} arrivals, ${fmt(last.delay, 1)} min (${fmt(last.late, 1)} %). This is an association across hours, not an experiment: busy hours are also the hours of day when the scheduling mix differs. Bands with fewer than 100 exams are hidden.` : "Too few exams per band.";

    const n = fc.months.length, m = fc.future_months.length, lbl = [...fc.months, ...fc.future_months].map(ml), idx = lbl.map((_, i) => i);
    const pad = (a, before) => [...Array(before).fill(null), ...a];
    Charts.lineChart($id("t8-fc"), { x: idx, xTicks: idx.filter((i) => i % 3 === 0), xLabel: (v) => lbl[v], height: 280,
      series: [{ name: "Observed", color: "var(--ink)", values: [...fc.per_day, ...Array(m).fill(null)] }, { name: "Fitted trend", color: "var(--muted)", values: [...fc.fit, ...Array(m).fill(null)] },
        { name: "Forecast", color: col(f), values: pad(fc.future, n) }, { name: "Upper 95%", color: "var(--s4)", values: pad(fc.hi, n) }, { name: "Lower 95%", color: "var(--s4)", values: pad(fc.lo, n) }],
      yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1), tipHeader: (i) => lbl[i] });
    const bt = fc.backtest;
    Charts.hbarChart($id("t8-bt"), { labelW: 140, fmt: (v) => fmt(v, 1) + "%", valueName: "MAPE", items: [{ label: "Linear trend", value: bt.linear_trend_mape, color: col(f) }, { label: "Training-period mean", value: bt.flat_mean_mape, color: "var(--muted)" }, { label: "Last observed value", value: bt.last_value_mape, color: "var(--s4)" }] });
    const win = bt.linear_trend_mape <= Math.min(bt.flat_mean_mape, bt.last_value_mape);
    $id("t8-fc-note").innerHTML = `<p><b>${f}.</b> Trend: ${fc.slope_per_month >= 0 ? "+" : ""}${fmt(fc.slope_per_month, 2)} exams/day per month (${fmt(fc.growth_pct_per_year, 1)} %/year, R² ${fmt(fc.r2, 2)}); the forecast reaches ${fmt(fc.future_per_day_end, 1)} exams/day after 12 months from ${fmt(fc.last_per_day, 1)} now. ${win ? "On the backtest the linear trend beat both naive forecasts" : "On the backtest the linear trend did <b>not</b> beat the best naive forecast, so treat the growth as unproven"} (${fmt(bt.linear_trend_mape, 1)} % vs ${fmt(bt.flat_mean_mape, 1)} % and ${fmt(bt.last_value_mape, 1)} %). With ${n} monthly points and no seasonality term this is a screening forecast; it cannot see closures, new referral patterns or policy changes.</p>`;
  }

  function mount() { seg($id("t8-site"), siteOpts, site, (f) => { site = f; draw(f); }); draw(site); }
  App.add({ id: "t8", label: "T8 · Strategy: demand", view, mount });
})();
