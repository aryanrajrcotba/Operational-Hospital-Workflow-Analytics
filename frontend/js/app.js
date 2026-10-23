/* App shell + topic views. To add a topic: write a render function and append it to TOPICS. */
(function () {
  const D = window.DATA, T1 = D.t1, T2 = D.t2, SITES = T1.facilities, { fmt, table } = Charts;
  const col = (f) => `var(--s${SITES.indexOf(f) + 1})`;
  const dot = (f) => `<i class="dot" style="background:${col(f)}"></i>`;
  const $id = (id) => document.getElementById(id);
  const MON = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const each = (fn) => SITES.map(fn);
  const perSite = (fn) => SITES.map((f) => `${dot(f)}${f} ${fn(f)}`).join(" &nbsp; ");
  const only = (fn, unit = "") => { const p = SITES.filter((f) => fn(f) > 0).map((f) => `${dot(f)}${f} ${Charts.fmt(fn(f))}${unit}`); return p.length ? p.join(" &nbsp; ") : "none"; };
  const S1 = (f) => T1.sites[f], S2 = (f) => T2.sites[f];
  const ml = (m) => { const [y, mo] = m.split("-"); return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+mo - 1] + " " + y.slice(2); };
  const hourLbl = (h) => `${h}:00`;

  // ---------- reusable pieces ----------
  let uid = 0;
  function card({ title, sub = "", body = "", id, tableHTML = "", cls = "" }) {
    const tid = "c" + ++uid;
    return `<div class="card ${cls}"><div class="card-head"><div><h3>${title}</h3><div class="sub">${sub}</div></div>${tableHTML ? `<button class="mini" data-tbl="${tid}">Table</button>` : ""}</div>
      ${id ? `<div id="${id}" data-chart="${tid}"></div>` : body}${tableHTML ? `<div id="${tid}" hidden>${tableHTML}</div>` : ""}</div>`;
  }
  function wireTables(root) {
    root.querySelectorAll("[data-tbl]").forEach((b) => {
      b.onclick = () => {
        const t = $id(b.dataset.tbl), chart = b.closest(".card").querySelector("[data-chart]"), on = t.hidden;
        t.hidden = !on; if (chart) { chart.hidden = on; const lg = chart.nextElementSibling; if (lg && lg.classList.contains("legend")) lg.hidden = on; }
        b.textContent = on ? "Chart" : "Table";
      };
    });
  }
  function seg(host, options, value, cb) {
    host.innerHTML = ""; host.className = "seg";
    options.forEach((o) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-pressed", o.v === value);
      b.innerHTML = (o.dot ? dot(o.v) : "") + o.label;
      b.onclick = () => { seg(host, options, o.v, cb); cb(o.v); };
      host.appendChild(b);
    });
  }
  const siteOpts = SITES.map((f) => ({ v: f, label: f, dot: true }));
  const sec = (no, title, lede) => `<div class="sec-head"><span class="no">${no}</span><h2>${title}</h2></div><p class="lede">${lede}</p>`;
  const tbl = (cols, rows) => table(cols, rows);
  const fig = (src, title, meta = "", cls = "") => `<figure class="fig ${cls}"><img src="${src}" alt="${title}" loading="lazy"><figcaption><b>${title}</b>${meta ? `<span>${meta}</span>` : ""}</figcaption></figure>`;
  window.UI = { card, wireTables, seg, sec, tbl, dot, col, siteOpts, $id, SITES, fig };

  // ================================================================ T1
  function viewT1() {
    const t = T1.totals, first = T1.sites.F1;
    const conceptCards = [
      ["Structured data", "Fields with a fixed meaning: numbers, dates, flags, codes (orders, vitals, labs, scheduling). Easy to query and model. <b>This whole dataset is structured.</b>", ["orders", "labs", "vitals", "scheduling"]],
      ["Standards & coding", "Systems agree on shared vocabularies so data can move between them: ICD-10 (diagnoses), SNOMED CT (clinical terms), LOINC (lab tests), DICOM (images), HL7 FHIR (exchange). <b>T2 standardization is the analytics side of this.</b>", ["ICD-10", "SNOMED CT", "LOINC", "DICOM", "FHIR"]],
      ["Event timestamps", "Every workflow step is logged with a time: booked, arrived, exam started, completed. <b>Operational analytics is built almost entirely on these events.</b>", ["arrival", "start", "finish"]],
      ["Unstructured content", "Clinical notes, radiology reports, scanned documents and images. Needs NLP or imaging models before analysis. <b>Not present here.</b>", ["notes", "reports", "images"]],
    ].map(([h, p, chips]) => `<div class="card concept"><div class="tag">EHR layer</div><h3>${h}</h3><p>${p}</p><div class="chips">${chips.map((c) => `<span class="chip">${c}</span>`).join("")}</div></div>`).join("");

    const rowsFac = each((f) => { const s = S1(f); return [`${dot(f)}${f}`, fmt(s.rows), fmt(s.operating_days), fmt(s.exams_per_day, 1), s.first_arrival, s.last_arrival, fmt(s.wait_median, 1), fmt(s.wait_p90, 1), fmt(s.early_median, 1), fmt(s.late_start_share, 0) + "%", s.scanners_max]; });
    const medians = SITES.map((f) => S1(f).wait_median), lo = Math.min(...medians), hi = Math.max(...medians);
    const loS = SITES[medians.indexOf(lo)], hiS = SITES[medians.indexOf(hi)];

    return `
    <div class="hero">
      <div><h1>Understanding EHR-derived workflow data</h1>
        <p>Topic 1 of this project. Before cleaning anything we need to know what a record is, where it comes from in the hospital's systems, and how the four facilities in the workbook differ.</p></div>
      <div><div class="hero-fig num">${fmt(t.rows)}<small>imaging exams across ${SITES.length} facilities (one row per exam)</small></div></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="k">Facilities</div><div class="v">${SITES.length}</div><div class="s">sheets F1–F4, anonymised</div></div>
      <div class="tile"><div class="k">Features documented</div><div class="v">${t.features_union}</div><div class="s">${t.features_core} present at every facility</div></div>
      <div class="tile"><div class="k">Span (as published)</div><div class="v" style="font-size:20px;padding-top:3px">${ml(t.first.slice(0, 7))} – ${ml(t.last.slice(0, 7))}</div><div class="s">timestamps are date-shifted</div></div>
      <div class="tile"><div class="k">Median wait, arrival → exam</div><div class="v">${fmt(lo, 0)}–${fmt(hi, 0)} min</div><div class="s">${loS} lowest · ${hiS} highest</div></div>
    </div>

    <section class="block" id="t1-ehr">${sec("1.1", "What an EHR is, and where this data sits",
      "An electronic health record (EHR) is the digital chart a hospital keeps for each patient, plus the operational systems around it (scheduling, registration, imaging worklists). Analytics work starts by knowing which layer of that stack a dataset comes from.")}
      <div class="grid g4">${conceptCards}</div>
      <div class="callout"><p><b>This dataset is an operational extract.</b> Each row is one scanner-based imaging exam. It has no diagnoses, no patient identifiers and no clinical measurements. It holds three event timestamps plus a snapshot of the department's state at the moment the patient arrived: who was waiting, what was running, how the day had gone so far. The source system is not named in the file.</p></div>
    </section>

    <section class="block" id="t1-record">${sec("1.2", "Anatomy of one record",
      "Every row is built around a patient journey with three timestamps. All other columns describe the situation the department was in at arrival, which is what makes the wait predictable.")}
      <div class="grid g2">
        ${card({ title: "Patient journey (median, minutes from arrival)", sub: "Arrival → scheduled slot → exam begins, per facility", body: `<div id="journey"></div>` })}
        ${card({ title: "Three durations derived from the timestamps", sub: "Defined once here, used everywhere after T2", body: `
          <dl class="kv" style="row-gap:10px">
            <dt><span class="mono">wait_min</span></dt><dd><b>Begin − arrival.</b> How long the patient actually waited.</dd>
            <dt><span class="mono">start_delay_min</span></dt><dd><b>Begin − scheduled.</b> Positive = exam started late against the booked slot; negative = early.</dd>
            <dt><span class="mono">early_arrival_min</span></dt><dd><b>Scheduled − arrival.</b> Positive = patient arrived before their slot.</dd>
          </dl>
          <div class="chips" style="margin-top:14px">${T1.families.filter((x) => !x.family.startsWith("Target")).map((x) => `<span class="chip">${x.family} · ${x.all4 + x.partial}</span>`).join("")}</div>
          <div class="legend-note">Chips = the seven feature families that describe the state of the department at arrival (count of features).</div>` })}
      </div>
    </section>

    <section class="block" id="t1-sites">${sec("1.3", "The four facilities are not interchangeable",
      `Median wait runs from ${fmt(lo, 1)} min at ${loS} to ${fmt(hi, 1)} min at ${hiS}. Volume, scanner count and scheduling style all differ, so any pooled analysis has to keep the facility in view.`)}
      ${tbl([{ h: "Facility" }, { h: "Exams", r: 1 }, { h: "Operating days", r: 1 }, { h: "Exams / day", r: 1 }, { h: "First arrival" }, { h: "Last arrival" }, { h: "Median wait (min)", r: 1 }, { h: "P90 wait (min)", r: 1 }, { h: "Median early arrival (min)", r: 1 }, { h: "Started after slot", r: 1 }, { h: "Max scanners used / day", r: 1 }], rowsFac)}
      <div class="legend-note">Dates are as published (shifted by a constant amount, see T2). Weekends are under 0.1% of exams at every facility.</div>
    </section>

    <section class="block" id="t1-dict">${sec("1.4", "Feature dictionary",
      `${t.features_union} features grouped into families. ${t.features_core} exist at all four facilities; the other ${t.features_union - t.features_core} are only recorded at F1–F3. Search by name or description.`)}
      <div class="grid">
        ${card({ title: "Features per family", sub: "Recorded at all four sites vs only some", id: "fam-chart", tableHTML: tbl([{ h: "Family" }, { h: "All sites", r: 1 }, { h: "Some sites", r: 1 }], T1.families.map((x) => [x.family, x.all4, x.partial])) })}
        <div>
          <div class="controls"><input type="search" id="dq" placeholder="Search feature or description…" aria-label="Search features"><select id="df" aria-label="Family"><option value="">All families</option>${T1.families.map((x) => `<option>${x.family}</option>`).join("")}</select><span class="legend-note" id="dcount" style="margin:0"></span></div>
          <div id="dtable"></div>
        </div>
      </div>
    </section>

    <section class="block" id="t1-patterns">${sec("1.5", "How the workflow behaves",
      "A first look at the rhythm of the day and where waits build up. All wait figures use the standardized definition (arrival → exam begins), so the sites can be compared. Click a legend entry to hide a site.")}
      <div class="grid g2">
        ${card({ title: "Arrivals by hour of day", sub: "Share of each site's exams, %", id: "ch-hour-vol", tableHTML: "" })}
        ${card({ title: "Mean wait by hour of arrival", sub: "Minutes", id: "ch-hour-wait" })}
        ${card({ title: "Mean wait by weekday", sub: "Minutes, Monday–Friday", id: "ch-dow" })}
        ${card({ title: "Monthly exam volume", sub: "Exams per month (first and last months are partial)", id: "ch-month" })}
        ${card({ title: "Wait distribution", sub: "Share of exams per 5-minute band, capped at 200", id: "ch-hist" })}
        ${card({ title: "Where the long waits are", sub: `<span id="hm-seg"></span>`, id: "ch-heat" })}
      </div>
      <div class="grid" style="margin-top:14px">
        ${card({ title: "What tracks the wait most closely", sub: `Pearson correlation between each feature and <span class="mono">wait_min</span> · <span id="cr-seg"></span>`, id: "ch-corr" })}
      </div>
      <div class="callout"><p><b>Reading the correlations.</b> They show which arrival-time features carry signal, not causes. Queue length at arrival is the strongest signal everywhere. Several features overlap heavily with one another, a point we return to when we get to feature selection.</p></div>
    </section>`;
  }

  function mountT1() {
    // journey diagram (static SVG)
    const W = 620, rowH = 54, H = 24 + rowH * SITES.length + 26, L = 46, R = 20, max = 70, X = (v) => L + (v / max) * (W - L - R);
    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Median patient journey per facility">`;
    [0, 10, 20, 30, 40, 50, 60, 70].forEach((v) => { s += `<line x1="${X(v)}" x2="${X(v)}" y1="14" y2="${H - 24}" style="stroke:var(--grid)"/><text x="${X(v)}" y="${H - 8}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${v}</text>`; });
    s += `<text x="${W - R}" y="${H - 8}" text-anchor="end" style="fill:var(--muted);font-size:11px;display:none">min</text>`;
    SITES.forEach((f, i) => {
      const y = 24 + i * rowH + 10, st = S1(f), wait = st.wait_median, sched = st.early_median;
      s += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" style="fill:var(--ink-2);font-size:12px;font-weight:600">${f}</text>
        <line x1="${X(0)}" x2="${X(wait)}" y1="${y}" y2="${y}" stroke-width="3" stroke-linecap="round" style="stroke:${col(f)}"/>
        <circle cx="${X(0)}" cy="${y}" r="5" stroke-width="2" style="fill:${col(f)};stroke:var(--surface)"/>
        <rect x="${X(sched) - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${X(sched)} ${y})" stroke-width="2" style="fill:var(--surface);stroke:var(--ink)"/>
        <circle cx="${X(wait)}" cy="${y}" r="5" stroke-width="2" style="fill:${col(f)};stroke:var(--surface)"/>
        <text x="${X(0)}" y="${y + 21}" text-anchor="start" style="fill:var(--muted);font-size:11px">arrives</text>
        <text x="${X(sched)}" y="${y - 12}" text-anchor="middle" style="fill:var(--ink-2);font-size:11px">slot ${fmt(sched, 0)}</text>
        <text x="${X(wait) + 9}" y="${y + 4}" style="fill:var(--ink-2);font-size:11px">exam ${fmt(wait, 0)}</text>`;
    });
    s += `</svg><div class="legend-note">Minutes after arrival. ◇ = scheduled slot. Medians of each quantity, so they need not add up exactly. F1 and F4 patients are seen close to their slot; F2 and F3 patients typically arrive 35–45 minutes early.</div>`;
    $id("journey").innerHTML = s;

    // dictionary chart + table
    Charts.hbarChart($id("fam-chart"), { labelW: 170, items: T1.families.map((x) => ({ label: x.family, parts: [{ value: x.all4, color: "var(--s1)", name: "All four sites" }, { value: x.partial, color: "var(--muted)", name: "Some sites only" }] })) });
    $id("fam-chart").insertAdjacentHTML("afterend", `<div class="legend"><span><i class="sw b" style="background:var(--s1);display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px"></i>All four sites</span><span><i style="background:var(--muted);display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px"></i>Some sites only</span></div>`);
    const drawDict = () => {
      const q = $id("dq").value.toLowerCase(), fam = $id("df").value;
      const rows = T1.dictionary.filter((e) => (!fam || e.family === fam) && (!q || (e.raw + " " + e.name + " " + e.desc).toLowerCase().includes(q)));
      $id("dcount").textContent = `${rows.length} of ${T1.dictionary.length}`;
      const rng = (e) => { const m = Object.values(e.stats).map((v) => v[0]); return m.length ? (Math.min(...m) === Math.max(...m) ? fmt(m[0], 2) : `${fmt(Math.min(...m), 2)} – ${fmt(Math.max(...m), 2)}`) : ""; };
      $id("dtable").innerHTML = `<div class="tablewrap scroll"><table><thead><tr><th>Feature</th><th>Type</th><th>Sites</th><th class="r">Mean (by site)</th><th>Meaning</th></tr></thead><tbody>${rows.map((e) => `<tr>
        <td><span class="mono">${e.raw}</span><div class="mono" style="color:var(--muted)">${e.name}</div><div class="legend-note" style="margin:2px 0 0">${e.family}</div></td>
        <td><span class="pill">${e.kind}</span></td>
        <td><span class="dots">${SITES.map((f) => `<i class="${e.sites.includes(f) ? "" : "off"}" style="background:${col(f)}" title="${f}"></i>`).join("")}</span>${e.constant_in.length ? `<div class="legend-note" style="margin:3px 0 0">constant at ${e.constant_in.join(", ")}</div>` : ""}</td>
        <td class="r">${rng(e)}</td><td>${e.desc}</td></tr>`).join("")}</tbody></table></div>`;
    };
    $id("dq").oninput = drawDict; $id("df").onchange = drawDict; drawDict();

    // workflow charts
    const series = (fn) => SITES.map((f) => ({ name: f, color: col(f), values: fn(f) }));
    const hours = [...Array(13).keys()].map((i) => i + 7);
    const atHour = (f, key, norm) => { const h = S1(f).hourly, tot = h.volume.reduce((a, b) => a + b, 0); return hours.map((x) => { const i = h.hour.indexOf(x); return i < 0 ? null : key === "volume" ? (h.volume[i] / tot) * 100 : h.mean_wait[i]; }); };
    Charts.lineChart($id("ch-hour-vol"), { x: hours, xTicks: hours.filter((h) => h % 2), xLabel: hourLbl, series: series((f) => atHour(f, "volume")), yFmt: (v) => fmt(v, v % 1 ? 1 : 0) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `Arrivals at ${hourLbl(hours[i])}` });
    Charts.lineChart($id("ch-hour-wait"), { x: hours, xTicks: hours.filter((h) => h % 2), xLabel: hourLbl, series: series((f) => atHour(f, "wait")), yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 1) + " min", tipHeader: (i) => `Arrived at ${hourLbl(hours[i])}` });
    Charts.barChart($id("ch-dow"), { categories: MON.slice(0, 5), series: series((f) => S1(f).weekday.mean_wait.slice(0, 5)), yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 1) + " min" });
    const months = [...new Set(SITES.flatMap((f) => S1(f).monthly.month))].sort();
    Charts.lineChart($id("ch-month"), { x: months.map((_, i) => i), xTicks: months.map((_, i) => i).filter((i) => i % 6 === 0), xLabel: (i) => ml(months[i]), series: series((f) => { const m = S1(f).monthly; return months.map((k) => { const i = m.month.indexOf(k); return i < 0 ? null : m.volume[i]; }); }), tipHeader: (i) => ml(months[i]), tipFmt: (v) => fmt(v) + " exams" });
    const bins = [...Array(40).keys()].map((i) => i * 5);
    Charts.lineChart($id("ch-hist"), { x: bins, xTicks: [0, 25, 50, 75, 100, 125, 150, 175, 200].filter((v) => v <= 195).concat([195]), xLabel: (v) => (v === 195 ? "200+" : v + " min"), area: true, series: series((f) => { const h = S1(f).wait_hist; return h.counts.map((c) => (c / h.n) * 100); }), yFmt: (v) => fmt(v, v % 1 ? 1 : 0) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${bins[i]}–${bins[i] + 5} min` });

    const drawHeat = (f) => {
      const hm = S1(f).heatmap, useD = [0, 1, 2, 3, 4, 5, 6].filter((d) => hm.cells.some((r) => r[d]));
      Charts.heatmap($id("ch-heat"), { rows: hm.hours.map(hourLbl), cols: useD.map((d) => MON[d]), cells: hm.cells.map((r) => useD.map((d) => r[d])) });
    };
    seg($id("hm-seg"), siteOpts, "F1", drawHeat); drawHeat("F1");
    const drawCorr = (f) => Charts.hbarChart($id("ch-corr"), { labelW: 260, items: S1(f).top_corr.map((c) => ({ label: c.feature, value: c.r, color: col(f) })), fmt: (v) => fmt(v, 2), valueName: "Correlation", max: 0.7, divergeNeg: true });
    seg($id("cr-seg"), siteOpts, "F1", drawCorr); drawCorr("F1");
  }

  // ================================================================ T2
  function viewT2() {
    const sc = T2.scaling, rawCols = each((f) => S2(f).raw_cols).join(" / "), rows = SITES.reduce((a, f) => a + S2(f).raw_rows, 0);
    const nulls = SITES.reduce((a, f) => a + Object.values(S2(f).nulls_before).reduce((x, y) => x + y, 0), 0);
    const repaired = SITES.reduce((a, f) => a + S2(f).is_first_repaired, 0);
    const ex = ["x_ArrivalDTTM", "Wait", "LineCount0Strict", "MSKCount", "StartTime4", "NumCompletedInLastW1", "AvgWaitLastK1Customers", "SumWaitByTaskTypeLine", "DayOfWeek", "WithAndWithoutContrastCountWaiting"];
    const dict = Object.fromEntries(T1.dictionary.map((e) => [e.raw, e]));
    const famRows = T1.families.map((x) => { const inFam = T1.dictionary.filter((e) => e.family === x.family); return [x.family, ...SITES.map((f) => inFam.filter((e) => e.sites.includes(f)).length), inFam.filter((e) => e.sites.length === 4).length]; });
    const wdRows = each((f) => { const r = S2(f); return [`${dot(f)}${f}`, `<span class="pill">${r.wait_definition}</span>`, fmt(r.wait_matches_begin_minus_scheduled, 1) + "%", fmt(r.wait_matches_begin_minus_arrival, 1) + "%", fmt(r.source_wait_median, 1), fmt(S1(f).wait_median, 1)]; });
    const calRows = [["Day of week", (r) => r.naive_dow_agreement, (r) => r.calendar_agreement.day_of_week], ["Month", (r) => r.naive_month_agreement, (r) => r.calendar_agreement.month], ["Day of year", (r) => r.naive_doy_agreement, (r) => r.calendar_agreement.day_of_year]]
      .map(([n, a, b]) => [n, ...each((f) => `${fmt(a(S2(f)), 1)}% → <span class="ok">${fmt(b(S2(f)), 1)}%</span>`)]);

    return `
    <div class="hero">
      <div><h1>Preprocessing: standardization and data cleaning</h1>
        <p>Topic 2. Raw operational extracts rarely line up: the same column can mean different things at different sites, codes follow local conventions and a few records contradict themselves. This page shows what we found in the workbook and exactly what we changed.</p></div>
      <div><div class="hero-fig num">0<small>rows deleted. ${fmt(nulls)} nulls filled, ${fmt(repaired)} records repaired, the rest flagged</small></div></div>
    </div>

    <div class="steps">
      <div class="step"><div class="n">Step 1 · Raw</div><h3>Published workbook</h3><p>4 sheets, one per facility.</p><div class="big num">${fmt(rows)} <small>rows</small></div><div class="legend-note num">${rawCols} columns</div></div>
      <div class="step"><div class="n">Step 2 · Standardize</div><h3>Make sites comparable</h3><p>Names, one wait definition, calendar codes, schema, units.</p><div class="big num">${T2.schema.core_cols} <small>shared columns</small></div><div class="legend-note">of ${T2.schema.union_cols} in the union</div></div>
      <div class="step"><div class="n">Step 3 · Clean</div><h3>Repair and flag</h3><p>Missing values, rule violations, outliers, constant columns.</p><div class="big num">${fmt(nulls)} → 0 <small>nulls</small></div><div class="legend-note">${fmt(repaired)} records repaired</div></div>
      <div class="step"><div class="n">Step 4 · Scale</div><h3>Model-ready</h3><p>z-score fitted on the first ${Math.round(sc.train_fraction * 100)}% of each site's timeline.</p><div class="big num">${sc.n_scaled} <small>scaled features</small></div><div class="legend-note num">${fmt(sc.cells_clipped / sc.cells_total * 100, 2)}% of cells winsorized</div></div>
    </div>

    <section class="block" id="t2-std">${sec("2.1", "Standardization", "Making data from different places mean the same thing. In a hospital setting this is the analytics-side twin of coding standards: one name, one unit, one definition per concept.")}

      <h3 style="margin:22px 0 4px">A · One schema, consistent names</h3>
      <p class="lede">Raw columns mix CamelCase, prefixes (<span class="mono">x_</span>) and abbreviations. Every column is renamed to <span class="mono">snake_case</span>. F4 records only ${T2.schema.raw_cols.F4} of the ${T2.schema.union_cols} columns, and names its daily average <span class="mono">AvgWaitForDay</span> where the others use <span class="mono">AvgDelayForDay</span>; we alias it so ${T2.schema.core_cols} columns are shared by all sites.</p>
      <div class="grid g2" style="align-items:start">
        <div>${tbl([{ h: "Raw name", mono: 1 }, { h: "Standardized", mono: 1 }], ex.filter((k) => dict[k]).map((k) => [k, dict[k].name]))}</div>
        <div>${tbl([{ h: "Family" }, ...SITES.map((f) => ({ h: `${f}`, r: 1 })), { h: "Shared", r: 1 }], famRows)}<div class="legend-note">Columns present per family and site. Only F1–F3 record ${T2.schema.site_only.F1.length} extra features (contrast, add-ons, next-slot load, …).</div></div>
      </div>

      <h3 style="margin:30px 0 4px">B · One definition of "wait"</h3>
      <div class="callout warn"><p><b>Same column name, different meaning.</b> In F1–F3 the published <span class="mono">Wait</span> equals <i>begin − scheduled slot</i>: a delay against the booking, negative when early. In F4 it equals <i>begin − arrival</i>: time actually spent waiting. So the published numbers understate real waiting at F1–F3, where patients arrive well before their slot (F3: published median ${fmt(S2("F3").source_wait_median, 0)} min, actual ${fmt(S1("F3").wait_median, 0)} min). We recompute all three durations from the timestamps for every site.</p></div>
      <div class="grid g2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.5fr);align-items:start">
        ${card({ title: "Median wait: as published vs standardized", sub: "Minutes", id: "wd-chart" })}
        <div>${tbl([{ h: "Site" }, { h: "Published Wait is" }, { h: "Matches begin − scheduled", r: 1 }, { h: "Matches begin − arrival", r: 1 }, { h: "Published median", r: 1 }, { h: "wait_min median", r: 1 }], wdRows)}
        <div class="legend-note">Percent of rows where the published value equals each formula (±1 min). Each site follows exactly one formula in 100% of its rows.</div></div>
      </div>

      <h3 style="margin:30px 0 4px">C · Calendar and time of day</h3>
      <div class="grid g2" style="align-items:start">
        <div class="card"><h3>Day-of-week codes</h3><div class="sub">Source uses Sunday = 1. Standardized to ISO, Monday = 1.</div>
          <div class="map"><div class="h">source</div><div class="h">2</div><div class="h">3</div><div class="h">4</div><div class="h">5</div><div class="h">6</div><div class="h">7</div><div class="h">1</div>
            <div class="h">ISO</div><div>1 Mon</div><div>2 Tue</div><div>3 Wed</div><div>4 Thu</div><div>5 Fri</div><div>6 Sat</div><div>7 Sun</div></div>
          <div class="legend-note" style="margin-top:12px">Codes actually present: ${perSite((f) => Object.keys(S2(f).dow_codes_raw).join(","))}</div></div>
        <div class="card"><h3>Do the timestamps agree with the calendar columns?</h3><div class="sub">Rows where the source calendar column matches the arrival timestamp → after aligning by one constant shift</div>
          ${tbl([{ h: "Field" }, ...SITES.map((f) => ({ h: f, r: 1 }))], calRows)}</div>
      </div>
      <div class="callout"><p><b>The published timestamps are date-shifted.</b> The calendar columns agree with them only after applying one constant shift, identical at all four sites and exact for every row. That is a typical de-identification step. Durations and time of day survive intact, so we use timestamps for those and the source calendar columns for weekday and month effects. Missing calendar values (${perSite((f) => S2(f).calendar_filled)}) are derived deterministically from that shift. We deliberately do not reconstruct calendar dates or years.</p></div>
      <div class="callout warn"><p><b>Unresolved: <span class="mono">StartTime</span> is one hour behind the arrival clock.</b> In ${fmt(S2("F1").start_time_offset_share, 0)}% of rows at every site, the source hour-of-day feature equals the arrival timestamp's clock time minus exactly ${fmt(S2("F1").start_time_offset_h, 1)} h. Likely a time-zone convention in the source's feature engineering, but the workbook does not say. We keep the source <span class="mono">start_hour*</span> columns untouched and add <span class="mono">arrival_hour</span> computed from the timestamp.</p></div>

      <h3 style="margin:30px 0 4px">D · Scaling numeric features</h3>
      <p class="lede">Features live on wildly different scales: <span class="mono">start_hour_4th</span> reaches ${fmt(sc.features[0].before.max)} while flags are 0/1. Scale-sensitive models (regression, k-NN, neural nets) would be dominated by the big numbers. We z-score each site's features using only that site's <b>first ${Math.round(sc.train_fraction * 100)}% of records in time</b> (so nothing from the future leaks in), after clipping to the ${sc.clip_quantiles[0] * 100}th–${sc.clip_quantiles[1] * 100}th percentile so a few extreme rows cannot stretch the scale.</p>
      <div class="controls"><label for="scf" class="legend-note" style="margin:0">Feature</label><select id="scf">${sc.features.map((x, i) => `<option value="${i}">${x.feature}</option>`).join("")}</select></div>
      <div class="grid g2">
        ${card({ title: "Before scaling", sub: `<span id="sc-b"></span>`, id: "sc-hb" })}
        ${card({ title: "After z-score", sub: `<span id="sc-a"></span>`, id: "sc-ha" })}
      </div>
      <div class="legend-note">All four sites pooled. Outputs: <span class="mono">core_model_ready.csv.gz</span> plus <span class="mono">scaler_params.json</span> so the same transform can be applied to new data. Day-of-week, month and flags are left unscaled.</div>
    </section>

    <section class="block" id="t2-clean">${sec("2.2", "Data cleaning", "Cleaning here means <b>repair what is provably wrong, flag what is merely unusual, delete nothing</b>. Long waits are real operational events, and removing them would hide exactly what this project needs to study.")}

      <h3 style="margin:22px 0 8px">Issue log</h3>
      ${tbl([{ h: "#" }, { h: "Check" }, { h: "Found" }, { h: "Treatment" }, { h: "Result" }], [
        ["1", "Missing calendar fields (day of week, month, day of year)", only((f) => S2(f).nulls_before.DayOfWeek || 0, " rows"), "Derived from the timestamp using the verified shift (deterministic, not statistical)", "<span class='ok'>0 nulls</span>"],
        ["2", "<span class='mono'>is_first</span> = 0 although <span class='mono'>ahead_count</span> = 0", only((f) => S2(f).is_first_repaired, " rows"), "Recomputed as ahead_count = 0 (rule holds on every other record)", "<span class='ok'>0 violations</span>"],
        ["3", "Zero-variance columns (not applicable at a site)", only((f) => Object.keys(S2(f).constant_dropped).length, " cols"), "Dropped from that site's file only; kept as 0 in the pooled model-ready file", "<span class='ok'>dropped</span>"],
        ["4", "Long waits above the Tukey fence (Q3 + 1.5 × IQR)", only((f) => S2(f).outliers.wait_flagged), "Kept, flagged <span class='mono'>flag_wait_outlier</span>", "flagged"],
        ["5", "Arrived more than 3 h before the slot", only((f) => S2(f).outliers.arrived_gt_3h_early), "Kept, flagged", "flagged"],
        ["6", "Exam started more than 2 h before the slot", only((f) => S2(f).outliers.started_gt_2h_early), "Kept, flagged", "flagged"],
        ["7", "Records sharing an arrival timestamp to the second", only((f) => S2(f).outliers.dup_arrival_ts_rows), "Kept, flagged. Cannot tell repeat exams from simultaneous arrivals without patient IDs", "flagged"],
        ["8", "Exact duplicate rows", only((f) => S2(f).exact_duplicate_rows), "None to remove", "<span class='ok'>clean</span>"],
        ["9", "Exam begins before arrival", only((f) => S2(f).checks[0].before), "None to fix", "<span class='ok'>clean</span>"],
              ])}

      <h3 style="margin:30px 0 4px">Consistency rules</h3>
      <p class="lede">Each rule is a relationship the data must satisfy. Cells show violations before → after cleaning.</p>
      ${tbl([{ h: "Rule" }, ...SITES.map((f) => ({ h: f, r: 1 }))], T2.sites.F1.checks.map((c, i) => [c.rule, ...each((f) => { const k = S2(f).checks[i]; return k.before === 0 ? `<span class="ok">0</span>` : `${fmt(k.before)} → <span class="ok">${fmt(k.after)}</span>`; })]))}

      <h3 style="margin:30px 0 4px">Missing values</h3>
      ${tbl([{ h: "Site" }, { h: "Columns with nulls" }, { h: "Null cells before", r: 1 }, { h: "After", r: 1 }], each((f) => { const n = S2(f).nulls_before; return [`${dot(f)}${f}`, Object.keys(n).length ? Object.keys(n).map((k) => `<span class="mono">${k}</span>`).join(", ") : "none", fmt(Object.values(n).reduce((a, b) => a + b, 0)), `<span class="ok">${S2(f).nulls_after}</span>`]; }))}

      <h3 style="margin:30px 0 4px">Outliers in wait time</h3>
      <p class="lede">The fence is computed per site because a 60-minute wait is routine at F3 and extreme at F4. Flagged rows stay in the data.</p>
      <div class="grid g2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);align-items:start">
        ${card({ title: "Wait distribution with outlier fence", sub: `<span id="ol-seg"></span>`, id: "ol-chart" })}
        <div class="card"><h3>Fence details</h3><div class="sub" id="ol-title"></div><div id="ol-kv"></div></div>
      </div>

      <h3 style="margin:30px 0 8px">Decisions worth knowing about</h3>
      <div class="grid g2">
        <div class="card"><h3>Why nothing is deleted</h3><p class="sub" style="margin-top:6px">No rows are impossible, and the extreme ones are the operationally interesting ones. Downstream models can filter on the <span class="mono">flag_*</span> columns if they want to.</p></div>
        <div class="card"><h3>Why per-site scaling and modelling</h3><p class="sub" style="margin-top:6px">History features such as <span class="mono">most_recent1</span> and <span class="mono">median5</span> inherit each site's own wait definition, so they are not comparable across sites until recomputed. Keep <span class="mono">facility</span> as a grouping variable.</p></div>
      </div>

      <h3 style="margin:30px 0 8px">Outputs (in <span class="mono">data/processed/</span>)</h3>
      ${tbl([{ h: "File", mono: 1 }, { h: "Contents" }, { h: "Rows", r: 1 }, { h: "Columns", r: 1 }], [
        ...each((f) => [`${f}_clean.csv.gz`, `${f}: standardized and cleaned, original units, all flags`, fmt(S2(f).clean_rows), S2(f).clean_cols]),
        ["core_model_ready.csv.gz", `All sites pooled, ${T2.schema.core_cols} shared columns, ${sc.n_scaled} features z-scored (<span class="mono">z_*</span>), train/test split column`, fmt(sc.rows), 13 + sc.n_scaled],
        ["scaler_params.json", "Per-site mean, std and clip bounds", "", ""],
      ])}
    </section>`;
  }

  function mountT2() {
    const wdCard = $id("wd-chart");
    Charts.barChart(wdCard, { categories: SITES, height: 230, valueLabels: true, series: [
      { name: "Published Wait", color: "var(--muted)", values: SITES.map((f) => S2(f).source_wait_median) },
      { name: "Standardized wait_min", color: "var(--ink)", values: SITES.map((f) => S1(f).wait_median) }], yFmt: (v) => fmt(v, v % 1 ? 1 : 0), tipFmt: (v) => fmt(v, 1) + " min" });

    const drawScale = () => {
      const x = T2.scaling.features[+$id("scf").value], hb = x.hist_before, ha = x.hist_after;
      $id("sc-b").textContent = `min ${fmt(x.before.min, 1)} · max ${fmt(x.before.max, 1)} · mean ${fmt(x.before.mean, 1)} · std ${fmt(x.before.std, 1)}`;
      $id("sc-a").textContent = `min ${fmt(x.after.min, 1)} · max ${fmt(x.after.max, 1)} · mean ${fmt(x.after.mean, 2)} · std ${fmt(x.after.std, 2)}`;
      Charts.histBars($id("sc-hb"), { counts: hb.counts, color: "var(--muted)", binLabel: (i) => `${fmt(hb.lo + i * hb.step, 1)} to ${fmt(hb.lo + (i + 1) * hb.step, 1)}`, tickLabel: (i) => fmt(hb.lo + i * hb.step, 0), height: 190 });
      Charts.histBars($id("sc-ha"), { counts: ha.counts, color: "var(--accent)", binLabel: (i) => `${fmt(ha.lo + i * ha.step, 2)} to ${fmt(ha.lo + (i + 1) * ha.step, 2)}`, tickLabel: (i) => fmt(ha.lo + i * ha.step, 1), height: 190 });
    };
    $id("scf").onchange = drawScale; drawScale();

    const drawOl = (f) => {
      const r = S2(f), o = r.outliers, h = r.wait_hist_std, bins = h.counts.map((_, i) => i * 5);
      Charts.lineChart($id("ol-chart"), { x: bins, xTicks: [0, 50, 100, 150, 195], xLabel: (v) => (v === 195 ? "200+" : v), area: true, height: 230, series: [{ name: `${f} wait_min`, color: col(f), values: h.counts.map((c) => (c / h.n) * 100) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `${bins[i]}–${bins[i] + 5} min`, vlines: [{ x: o.wait_fence, label: `fence ${fmt(o.wait_fence, 0)} min` }] });
      $id("ol-title").textContent = `${f} · wait_min = begin − arrival`;
      $id("ol-kv").innerHTML = `<dl class="kv"><dt>Q1</dt><dd class="num">${fmt(o.wait_q1, 1)} min</dd><dt>Q3</dt><dd class="num">${fmt(o.wait_q3, 1)} min</dd><dt>Upper fence</dt><dd class="num">${fmt(o.wait_fence, 1)} min</dd><dt>Flagged</dt><dd class="num">${fmt(o.wait_flagged)} rows (${fmt((o.wait_flagged / r.clean_rows) * 100, 1)}%)</dd><dt>Longest wait</dt><dd class="num">${fmt(o.wait_max, 0)} min</dd></dl><div class="legend-note" style="margin-top:12px">Distribution is right-skewed, so the fence flags the tail rather than errors.</div>`;
    };
    seg($id("ol-seg"), siteOpts, "F1", drawOl); drawOl("F1");
  }

  // ================================================================ next
  function viewNext() {
    const done = [["T1 · Understanding EHR", "Data layers, record anatomy, facilities, feature dictionary, workflow patterns."],
      ["T2 · Preprocessing", "Standardization and data cleaning, with evidence and outputs."],
      ["T3 · EHR preprocessing", "Redundant columns and records, explicit and hidden missing data, imputation benchmark."],
      ["T4 · Image processing", "Enhancement, restoration, segmentation and compression, scored against ground truth."],
      ["T5 · Image analysis", "SIFT keypoints, RANSAC registration and a CNN nodule classifier."],
      ["T6 · Visualisation", "Interactive multi-planar viewer: windowing, colormaps, overlays, projections."],
      ["T7 · Staffing", "Hourly demand forecasts turned into rosters, and a per-patient long-wait risk score."],
      ["T8 · Strategy: demand", "Utilisation by weekday and hour, load-to-delay curve, backtested 12-month outlook."],
      ["T9 · Strategy: scenarios", "What-if grid of demand growth × staffed rooms; headroom, deadline, rooms needed."],
      ["T10 · Text classification", "Exam type and abnormal/normal from report text; unsupervised clusters."],
      ["T11 · Entity extraction", "Anatomy, finding and size spans; present / negated / uncertain."],
      ["T12 · Ranking & WSD", "Report search with BM25 and negation, keyword ranking, ambiguous abbreviations."],
      ["T13 · Dimensionality reduction", "PCA, kernel PCA, Isomap, t-SNE: which map keeps neighbours and wait signal."],
      ["T14 · Weight: explore", "Behaviours and BMI: crude vs adjusted effects, confounding, shapes, interactions."],
      ["T15 · Weight: model", "Models of rising complexity audited against the known mechanism."]];
    return `<div class="hero"><div><h1>Project complete</h1><p>All fifteen topics (T1–T15) are done. Each is one Python module in <span class="mono">pipeline/</span> plus one view in this app.</p></div></div>
    <div class="grid g3">
      ${done.map(([h, p]) => `<div class="card"><div class="tag" style="color:var(--good-ink);font-weight:600;font-size:12px">DONE</div><h3 style="margin-top:4px">${h}</h3><p class="sub">${p}</p></div>`).join("")}
    </div>`;
  }

  // ================================================================ shell
  // Topic files (t3.js ... t6.js) call App.add({ id, label, view, mount }) before App.start() runs.
  const TOPICS = [
    { id: "t1", label: "T1 · Understanding EHR", view: viewT1, mount: mountT1 },
    { id: "t2", label: "T2 · Preprocessing", view: viewT2, mount: mountT2 },
    { id: "next", label: "Summary", view: viewNext, mount() {} },
  ];
  window.App = { add(t) { TOPICS.splice(TOPICS.length - 1, 0, t); }, addFirst(t) { TOPICS.unshift(t); }, go(id) { current = id; history.replaceState(null, "", "#" + id); render(); scrollTo(0, 0); }, start() { boot(); } };
  let current = "t1";

  function render() {
    const t = TOPICS.find((x) => x.id === current);
    $id("tabs").innerHTML = TOPICS.map((x) => `<button class="tab" role="tab" aria-selected="${x.id === current}" data-id="${x.id}">${x.label}</button>`).join("");
    $id("tabs").querySelectorAll(".tab").forEach((b) => (b.onclick = () => { current = b.dataset.id; history.replaceState(null, "", "#" + current); render(); scrollTo(0, 0); }));
    $id("main").innerHTML = t.view() + `<div class="footer">Source: ${D.meta.source} · generated ${D.meta.generated} · all figures computed by <span class="mono">pipeline/build.py</span></div>`;
    t.mount(); wireTables($id("main"));
    const sel = $id("tabs").querySelector('[aria-selected="true"]'); if (sel) $id("tabs").scrollLeft = Math.max(0, sel.offsetLeft - 40);
  }
  const themeBtn = $id("theme");
  try { const s = localStorage.getItem("theme"); if (s) document.documentElement.dataset.theme = s; } catch (e) {}
  themeBtn.onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", document.documentElement.dataset.theme); } catch (e) {}
    render();
  };
  function boot() {
    current = (location.hash || "#home").slice(1);
    if (!TOPICS.some((t) => t.id === current)) current = TOPICS[0].id;
    render();
  }
})();
