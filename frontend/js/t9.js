/* T9 · Informed strategic planning, part 2: scenarios and decisions. Data: window.DATA.t9 (uses t8 for context) */
(function () {
  const T9 = window.DATA.t9, { fmt } = Charts, { card, seg, sec, tbl, $id, SITES, siteOpts, dot, col } = UI;
  const P = T9.params, S = (f) => T9.sites[f];
  const ml = (m) => { const [y, mo] = m.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo - 1] + " " + y.slice(2); };
  let site = "F1", metric = "wait";

  function view() {
    const extra = SITES.map((f) => S(f).rooms_extra);
    return `
    <div class="hero">
      <div><h1>Informed strategic planning · part 2</h1>
        <p>Topic 9 of this project. Part 1 described load and forecast demand; part 2 asks what to <i>do</i>. A what-if grid (more demand × more or fewer staffed scanners) is scored with the same queueing model as T7, and turned into three planning answers per site: how much growth it can absorb, when the forecast says it runs out, and how many rooms the end of the horizon needs.</p></div>
      <div><div class="hero-fig num">${Math.min(...extra)}–${Math.max(...extra)}<small>extra staffed rooms needed after 12 months of forecast growth to keep mean wait ≤ ${P.wait_target_min} min (range across sites; depends on the assumed exam length, see 9.4)</small></div></div>
    </div>
    <div class="callout warn"><p><b>Model, not measurement.</b> Waits in the grid are M/M/c queue predictions from weekday-hour mean arrivals and an assumed exam length; they were not observed under the scenarios. The 12-month growth is T8's linear trend, whose backtest is shown there. Use the grid to rank options and find thresholds, not to promise a wait in minutes.</p></div>
    <div class="controls"><span id="t9-site"></span></div>

    <section class="block">${sec("9.1", "Headroom: how much growth can the site absorb?", "Growth at which the patient-weighted mean wait first exceeds the target, with the installed scanners and with each alternative. Zero means the site already misses the target under the model.")}
      <div id="t9-kpi"></div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Growth absorbed before the target is missed", sub: "Percent more arrivals than today, by number of staffed rooms", id: "t9-head" })}
        ${card({ title: "Rooms needed at the busiest weekday-hour", sub: "Smallest room count with mean wait within target, by demand growth", id: "t9-need" })}
      </div>
    </section>

    <section class="block">${sec("9.2", "What-if grid", "Choose a measure; each cell is one scenario (rooms × demand growth) at the selected site.")}
      <div class="controls"><span id="t9-metric"></span></div>
      ${card({ title: "Scenario grid", sub: "Rows: staffed rooms. Columns: arrivals vs today", id: "t9-grid" })}
      <div class="callout" id="t9-grid-note"></div>
    </section>

    <section class="block">${sec("9.3", "The next 12 months on the installed scanners", "T8's monthly forecast converted into predicted mean wait if nothing changes. The first month the line crosses the target is the planning deadline for adding capacity or hours.")}
      ${card({ title: "Predicted mean wait with today's staffed rooms", sub: "Minutes, by forecast month (dashed in the text: target)", id: "t9-path" })}
      <div class="callout" id="t9-path-note"></div>
    </section>

    <section class="block">${sec("9.4", "If our exam-length assumption is wrong", "The one input the workbook cannot supply. Each row repeats the analysis with a different mean exam length.")}
      <div id="t9-sens"></div>
    </section>

    <section class="block">${sec("9.5", "Summary for planners", "One line per site, under the assumptions above.")}
      <div id="t9-summary"></div>
    </section>`;
  }

  function draw(f) {
    const s = S(f), mn = { wait: "Predicted mean wait (min)", over: "Weekday-hours over the wait target (%)", util: "Peak estimated utilisation (%)" };
    $id("t9-kpi").innerHTML = `<div class="grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">${[
      ["Staffed rooms assumed", s.installed, `${s.service_min} min per exam`],
      ["Growth absorbed today", fmt(s.headroom_installed, 0) + "%", s.headroom_installed === 0 ? "target already missed under the model" : "more arrivals before wait exceeds target"],
      ["Forecast growth, 12 months", (s.growth_end >= 0 ? "+" : "") + fmt(s.growth_end, 1) + "%", `${fmt(s.per_day_now, 1)} → ${fmt(s.per_day_end, 1)} exams/day`],
      ["Rooms needed at month 12", s.rooms_end, s.rooms_extra > 0 ? `${s.rooms_extra} more than now` : "no addition"]].map(([a, b, c]) =>
      `<div class="card"><div class="sub">${a}</div><div class="hero-fig num" style="font-size:30px">${b}</div><div class="sub" style="margin:6px 0 0">${c}</div></div>`).join("")}</div>`;
    const rooms = Object.keys(s.headroom).map(Number);
    Charts.hbarChart($id("t9-head"), { labelW: 100, fmt: (v) => fmt(v, 0) + "%", valueName: "Growth absorbed", items: rooms.map((r) => ({ label: r + " rooms" + (r === s.installed ? " (now)" : ""), value: s.headroom[r], color: r === s.installed ? col(f) : "var(--muted)" })) });
    Charts.barChart($id("t9-need"), { categories: s.need.map((n) => "+" + n.growth + "%"), height: 220, series: [{ name: "Busiest weekday-hour", color: col(f), values: s.need.map((n) => n.rooms) }, { name: "Average hour", color: "var(--muted)", values: s.need.map((n) => n.avg_hour_rooms) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 0) + " rooms" });
    drawGrid(f);
    const pa = s.path, lbl = pa.map((p) => ml(p.month));
    Charts.lineChart($id("t9-path"), { x: pa.map((_, i) => i), xTicks: pa.map((_, i) => i).filter((i) => i % 2 === 0), xLabel: (v) => lbl[v], height: 240, yMax: Math.max(P.wait_target_min * 2, ...pa.map((p) => p.wait)),
      series: [{ name: "Predicted wait", color: col(f), values: pa.map((p) => p.wait) }, { name: "Target", color: "var(--s4)", values: pa.map(() => P.wait_target_min) }], yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1) + " min", tipHeader: (i) => `${lbl[i]} · demand ${pa[i].growth >= 0 ? "+" : ""}${fmt(pa[i].growth, 1)}% vs now` });
    $id("t9-path-note").innerHTML = `<p><b>${f}.</b> ${s.headroom_installed === 0 ? "The model already misses the target at today's demand, so the question is how many rooms close the gap, not when." : s.crossing_month ? `With ${s.installed} staffed rooms the model first misses the ${P.wait_target_min}-minute target in <b>${ml(s.crossing_month)}</b>; the capacity decision has to be made before then.` : `The target holds through all 12 forecast months with ${s.installed} rooms.`} At month 12, reaching the target needs <b>${s.rooms_end}</b> rooms (${s.rooms_extra > 0 ? s.rooms_extra + " more" : "no more"}).</p>`;
    $id("t9-sens").innerHTML = tbl([{ h: "Mean exam length", r: 1 }, { h: "Predicted wait now", r: 1 }, { h: "Predicted wait at month 12", r: 1 }, { h: "Growth absorbed", r: 1 }, { h: "Rooms needed at month 12", r: 1 }],
      s.sens.map((x) => [x.service_min + " min" + (x.service_min === s.service_min ? " (assumed)" : ""), fmt(x.wait_now, 1) + " min", fmt(x.wait_end, 1) + " min", fmt(x.headroom, 0) + "%", x.rooms_end]));
    $id("t9-summary").innerHTML = tbl([{ h: "Site" }, { h: "Rooms assumed", r: 1 }, { h: "Headroom", r: 1 }, { h: "12-month growth", r: 1 }, { h: "Target first missed", r: 1 }, { h: "Rooms at month 12", r: 1 }, { h: "Sensitive to exam length?" }],
      SITES.map((g) => { const x = S(g), w = x.sens.map((y) => y.rooms_end); return [`${dot(g)}${g}`, x.installed, fmt(x.headroom_installed, 0) + "%", (x.growth_end >= 0 ? "+" : "") + fmt(x.growth_end, 1) + "%", x.headroom_installed === 0 ? "already" : x.crossing_month ? ml(x.crossing_month) : "not within 12 mo", x.rooms_end, `rooms range ${Math.min(...w)}–${Math.max(...w)} for 20–45 min`]; }));
  }

  function drawGrid(f) {
    const s = S(f), rooms = [...new Set(s.grid.map((g) => g.rooms))], gr = P.growth;
    const key = { wait: "wait", over: "over", util: "peak_util" }[metric];
    const vals = rooms.map((r) => gr.map((g) => { const c = s.grid.find((x) => x.rooms === r && x.growth === g); return key === "peak_util" ? c[key] * 100 : c[key]; }));
    Charts.matrix($id("t9-grid"), { rows: rooms.map((r) => r + " rooms" + (r === s.installed ? " (now)" : "")), cols: gr.map((g) => "+" + g + "%"), values: vals, fmt: (v) => fmt(v, metric === "wait" ? 1 : 0), labelW: 100, cell: 34,
      tipFn: (i, j, v) => `<div class="th">${rooms[i]} rooms · demand +${gr[j]}%</div><div>${fmt(v, 1)}${metric === "wait" ? " min mean wait" : "%"}</div>` });
    const ok = rooms.map((r) => ({ r, g: Math.max(-1, ...gr.filter((g) => s.grid.find((x) => x.rooms === r && x.growth === g).wait <= P.wait_target_min)) }));
    $id("t9-grid-note").innerHTML = `<p><b>${f}.</b> ${ok.map((o) => `${o.r} rooms hold the ${P.wait_target_min}-minute target ${o.g < 0 ? "in none of the tested scenarios" : "up to +" + o.g + "% demand"}`).join("; ")}. Columns run in 10-point steps, so the exact limit (9.1) lies between a ✓ cell and the next.</p>`;
  }

  function mount() {
    seg($id("t9-site"), siteOpts, site, (f) => { site = f; draw(f); });
    seg($id("t9-metric"), [{ v: "wait", label: "Mean wait" }, { v: "over", label: "Hours over target" }, { v: "util", label: "Peak utilisation" }], metric, (m) => { metric = m; drawGrid(site); });
    draw(site);
  }
  App.add({ id: "t9", label: "T9 · Strategy: scenarios", view, mount });
})();
