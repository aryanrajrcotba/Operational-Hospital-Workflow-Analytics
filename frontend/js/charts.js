/* Tiny dependency-free SVG chart kit (line/area, grouped bars, horizontal bars, histogram bars, heatmap).
   Mark specs follow the dataviz skill: 2px lines, bars <= 24px with 4px rounded data-end, 2px surface gaps,
   >= 8px hover dots with a 2px surface ring, hairline solid grid, text in ink tokens (never series colour). */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) {
      if (k === "style") e.setAttribute("style", attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // ---------- formatting ----------
  const fmt = (n, d = 0) => (n == null || isNaN(n) ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtC = (n) => (Math.abs(n) >= 1e6 ? fmt(n / 1e6, 1) + "M" : Math.abs(n) >= 1e4 ? fmt(n / 1e3, 0) + "K" : fmt(n, Math.abs(n) < 10 && n % 1 ? 1 : 0));

  function niceMax(max, ticks = 5) {
    if (max <= 0) return { max: 1, step: 0.2 };
    const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag, nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    const step = nf * mag;
    return { max: Math.ceil(max / step) * step, step };
  }

  // ---------- tooltip ----------
  let tipEl;
  function tip(html, evt) {
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; document.body.appendChild(tipEl); }
    if (html == null) { tipEl.classList.remove("on"); return; }
    tipEl.innerHTML = html; tipEl.classList.add("on");
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + w > innerWidth - 8) x = evt.clientX - w - 14;
    if (y + h > innerHeight - 8) y = evt.clientY - h - 14;
    tipEl.style.left = Math.max(8, x) + "px"; tipEl.style.top = Math.max(8, y) + "px";
  }
  const trow = (color, name, val) => `<div class="tr"><span>${color ? `<i class="dot" style="background:${color}"></i>` : ""}${name}</span><b>${val}</b></div>`;

  // ---------- mount + responsive redraw ----------
  const observers = new WeakMap();
  function mount(host, draw) {
    host.classList.add("chart");
    const go = () => { host.querySelectorAll("svg").forEach((s) => s.remove()); draw(Math.max(280, host.clientWidth)); };
    go();
    let last = host.clientWidth, t;
    if (observers.has(host)) observers.get(host).disconnect();
    const ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; clearTimeout(t); t = setTimeout(go, 80); } });
    ro.observe(host); observers.set(host, ro);
  }

  function frame(host, W, H, m) {
    const svg = $("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, host);
    svg.addEventListener("mouseleave", () => tip(null));
    return svg;
  }
  function yAxis(svg, m, W, H, max, step, yFmt) {
    const g = $("g", { class: "grid" }, svg);
    for (let v = 0; v <= max + 1e-9; v += step) {
      const y = m.t + (H - m.t - m.b) * (1 - v / max);
      $("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, style: v === 0 ? "stroke:var(--axis)" : "" }, g);
      const t = $("text", { x: m.l - 8, y: y + 4, "text-anchor": "end" }, svg); t.textContent = yFmt(v);
    }
  }

  // ---------- legend (click to isolate/toggle) ----------
  function legend(host, items, state, redraw, kind = "line") {
    const el = document.createElement("div"); el.className = "legend";
    items.forEach((it) => {
      const b = document.createElement("button"); b.type = "button";
      b.setAttribute("aria-pressed", state[it.name] !== false);
      b.innerHTML = `<span class="sw ${kind === "bar" ? "b" : ""}" style="background:${it.color}"></span>${it.name}`;
      b.onclick = () => { state[it.name] = state[it.name] === false; b.setAttribute("aria-pressed", state[it.name] !== false); redraw(); };
      el.appendChild(b);
    });
    const prev = host.nextElementSibling;
    if (prev && prev.classList.contains("legend")) prev.remove();     // charts are redrawn when their controls change
    host.parentNode.insertBefore(el, host.nextSibling);
    return el;
  }

  // ---------- line / area ----------
  function lineChart(host, o) {
    const state = {};
    const draw = (W) => {
      const H = o.height || 250, m = { l: 46, r: 14, t: 10, b: 30 };
      const vis = o.series.filter((s) => state[s.name] !== false);
      const xs = o.x, xmin = o.xMin ?? xs[0], xmax = o.xMax ?? xs[xs.length - 1];
      let ymax = o.yMax ?? Math.max(1e-9, ...vis.flatMap((s) => s.values.filter((v) => v != null)));
      const ns = niceMax(ymax, 4);
      const svg = frame(host, W, H, m);
      const X = (v) => m.l + ((v - xmin) / (xmax - xmin || 1)) * (W - m.l - m.r);
      const Y = (v) => m.t + (H - m.t - m.b) * (1 - v / ns.max);
      yAxis(svg, m, W, H, ns.max, ns.step, o.yFmt || fmtC);
      (o.xTicks || xs).forEach((v, i) => { const t = $("text", { x: X(v), y: H - 9, "text-anchor": o.xAnchor || "middle" }, svg); t.textContent = o.xLabel ? o.xLabel(v, i) : v; });
      if (o.yTitle) { const t = $("text", { x: m.l, y: 8, class: "ttl" }, svg); t.textContent = o.yTitle; t.setAttribute("y", 7); t.setAttribute("x", 0); }
      (o.vlines || []).forEach((v) => {
        if (v.x < xmin || v.x > xmax) return;
        $("line", { x1: X(v.x), x2: X(v.x), y1: m.t, y2: H - m.b, style: "stroke:var(--ink-2);stroke-width:1.5;stroke-dasharray:4 3" }, svg);
        const t = $("text", { x: X(v.x) + 5, y: m.t + 11, class: "ttl" }, svg); t.textContent = v.label;
      });
      vis.forEach((s) => {
        let d = "", pen = false, first = null, last = null;
        s.values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          d += (pen ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(v).toFixed(1); pen = true;
          if (first == null) first = i; last = i;
        });
        if (o.area && first != null) $("path", { d: d + `L${X(xs[last])} ${Y(0)}L${X(xs[first])} ${Y(0)}Z`, style: `fill:${s.color};opacity:.10` }, svg);
        $("path", { d, fill: "none", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round", style: `stroke:${s.color}` }, svg);
      });
      // hover layer
      const cross = $("line", { y1: m.t, y2: H - m.b, style: "stroke:var(--axis);stroke-width:1;opacity:0" }, svg);
      const dots = vis.map((s) => $("circle", { r: 4.5, "stroke-width": 2, style: `fill:${s.color};stroke:var(--surface);opacity:0` }, svg));
      const hit = $("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" }, svg);
      hit.addEventListener("mousemove", (e) => {
        const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
        let bi = 0, bd = Infinity;
        xs.forEach((v, i) => { const d = Math.abs(X(v) - px); if (d < bd) { bd = d; bi = i; } });
        cross.setAttribute("x1", X(xs[bi])); cross.setAttribute("x2", X(xs[bi])); cross.style.opacity = 1;
        vis.forEach((s, k) => { const v = s.values[bi]; dots[k].style.opacity = v == null ? 0 : 1; if (v != null) { dots[k].setAttribute("cx", X(xs[bi])); dots[k].setAttribute("cy", Y(v)); } });
        tip(`<div class="th">${o.tipHeader ? o.tipHeader(bi) : xs[bi]}</div>` + vis.map((s) => trow(s.color, s.name, s.values[bi] == null ? "–" : (o.tipFmt || o.yFmt || fmt)(s.values[bi]))).join(""), e);
      });
      hit.addEventListener("mouseleave", () => { cross.style.opacity = 0; dots.forEach((d) => (d.style.opacity = 0)); tip(null); });
    };
    mount(host, draw);
    if (o.series.length > 1) legend(host, o.series, state, () => mount(host, draw));
  }

  // ---------- vertical grouped bars ----------
  function barChart(host, o) {
    const state = {};
    const draw = (W) => {
      const H = o.height || 250, m = { l: 46, r: 14, t: 14, b: 30 };
      const vis = o.series.filter((s) => state[s.name] !== false);
      const ns = niceMax(o.yMax ?? Math.max(1e-9, ...vis.flatMap((s) => s.values.filter((v) => v != null))), 4);
      const svg = frame(host, W, H, m);
      yAxis(svg, m, W, H, ns.max, ns.step, o.yFmt || fmtC);
      const band = (W - m.l - m.r) / o.categories.length, n = Math.max(1, vis.length);
      const bw = Math.min(24, (band * 0.8) / n - 2);
      const Y = (v) => m.t + (H - m.t - m.b) * (1 - v / ns.max);
      o.categories.forEach((c, ci) => {
        const cx = m.l + band * ci + band / 2, t = $("text", { x: cx, y: H - 9, "text-anchor": "middle" }, svg); t.textContent = c;
        vis.forEach((s, si) => {
          const v = s.values[ci]; if (v == null) return;
          const x = cx - (n * (bw + 2) - 2) / 2 + si * (bw + 2), y = Y(v), h = Math.max(0, Y(0) - y), r = Math.min(4, bw / 2, h);
          const p = $("path", { d: `M${x} ${Y(0)}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${Y(0)}Z`, style: `fill:${s.color}` }, svg);
          const hit = $("rect", { x: cx - band / 2, y: m.t, width: band, height: H - m.t - m.b, fill: "transparent" }, svg);
          hit.addEventListener("mousemove", (e) => tip(`<div class="th">${c}</div>` + vis.map((q) => trow(q.color, q.name, q.values[ci] == null ? "–" : (o.tipFmt || o.yFmt || fmt)(q.values[ci]))).join(""), e));
          if (o.valueLabels && h > 0) { const tl = $("text", { x: x + bw / 2, y: y - 4, "text-anchor": "middle", class: "ttl" }, svg); tl.textContent = (o.yFmt || fmt)(v); }
        });
      });
    };
    mount(host, draw);
    if (o.series.length > 1) legend(host, o.series, state, () => mount(host, draw), "bar");
  }

  // ---------- horizontal bars (single series or stacked parts) ----------
  function hbarChart(host, o) {
    const draw = (W) => {
      const rowH = 26, m = { l: o.labelW || 190, r: 54, t: 4, b: 4 }, H = m.t + m.b + rowH * o.items.length;
      const svg = frame(host, W, H, m);
      const tot = (it) => (it.parts ? it.parts.reduce((a, p) => a + p.value, 0) : it.value);
      const lo = Math.min(0, ...o.items.map((it) => Math.min(0, tot(it)))), hi = o.max ?? Math.max(...o.items.map((it) => Math.max(0, tot(it))));
      const X = (v) => m.l + ((v - lo) / (hi - lo || 1)) * (W - m.l - m.r);
      o.items.forEach((it, i) => {
        const y = m.t + i * rowH, bh = 16, by = y + (rowH - bh) / 2;
        const lab = $("text", { x: m.l - 10, y: y + rowH / 2 + 4, "text-anchor": "end", class: "ttl" }, svg);
        lab.textContent = it.label.length > 30 ? it.label.slice(0, 29) + "…" : it.label;
        const parts = it.parts || [{ value: it.value, color: it.color || o.color || "var(--accent)", name: "" }];
        let acc = 0;
        parts.forEach((p, k) => {
          if (p.value === 0) return;
          const x0 = p.value >= 0 ? X(acc) : X(acc + p.value), w = Math.max(0, Math.abs(X(acc + p.value) - X(acc)) - (k < parts.length - 1 ? 2 : 0));
          const last = k === parts.length - 1 || parts.slice(k + 1).every((q) => q.value === 0), r = Math.min(4, w / 2);
          const d = p.value >= 0
            ? (last ? `M${x0} ${by}H${x0 + w - r}Q${x0 + w} ${by} ${x0 + w} ${by + r}V${by + bh - r}Q${x0 + w} ${by + bh} ${x0 + w - r} ${by + bh}H${x0}Z` : `M${x0} ${by}h${w}v${bh}h${-w}Z`)
            : `M${x0 + w} ${by}H${x0 + r}Q${x0} ${by} ${x0} ${by + r}V${by + bh - r}Q${x0} ${by + bh} ${x0 + r} ${by + bh}H${x0 + w}Z`;
          const path = $("path", { d, style: `fill:${p.value < 0 && o.divergeNeg ? "var(--div-neg)" : p.color}` }, svg);
          path.addEventListener("mousemove", (e) => tip(`<div class="th">${it.label}</div>${it.parts ? parts.map((q) => trow(q.color, q.name, fmt(q.value))).join("") : trow(null, o.valueName || "Value", (o.fmt || fmt)(it.value))}${it.note ? `<div style="color:var(--ink-2);margin-top:4px">${it.note}</div>` : ""}`, e));
          acc += p.value;
        });
        const vt = $("text", { x: X(Math.max(0, tot(it))) + 6, y: y + rowH / 2 + 4, class: "ttl" }, svg);
        if (tot(it) < 0) { vt.setAttribute("x", X(tot(it)) - 6); vt.setAttribute("text-anchor", "end"); }
        vt.textContent = (o.fmt || fmt)(tot(it));
      });
      if (lo < 0) $("line", { x1: X(0), x2: X(0), y1: 0, y2: H, style: "stroke:var(--axis)" }, svg);
    };
    mount(host, draw);
  }

  // ---------- histogram bars ----------
  function histBars(host, o) {
    const draw = (W) => {
      const H = o.height || 200, m = { l: 46, r: 10, t: 10, b: 30 }, n = o.counts.length;
      const total = o.counts.reduce((a, b) => a + b, 0) || 1, vals = o.counts.map((c) => (c / total) * 100);
      const ns = niceMax(Math.max(...vals), 4), svg = frame(host, W, H, m);
      yAxis(svg, m, W, H, ns.max, ns.step, (v) => fmt(v, v % 1 ? 1 : 0) + "%");
      const band = (W - m.l - m.r) / n, bw = Math.min(24, band - 2), Y = (v) => m.t + (H - m.t - m.b) * (1 - v / ns.max);
      vals.forEach((v, i) => {
        const x = m.l + band * i + (band - bw) / 2, y = Y(v), h = Y(0) - y, r = Math.min(4, bw / 2, h);
        if (h > 0) $("path", { d: `M${x} ${Y(0)}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${Y(0)}Z`, style: `fill:${o.color}` }, svg);
        const hit = $("rect", { x: m.l + band * i, y: m.t, width: band, height: H - m.t - m.b, fill: "transparent" }, svg);
        hit.addEventListener("mousemove", (e) => tip(`<div class="th">${o.binLabel(i)}</div>${trow(o.color, "Share of rows", fmt(v, 2) + "%")}${trow(null, "Rows", fmt(o.counts[i]))}`, e));
      });
      [0, Math.floor(n / 2), n - 1].forEach((i) => { const t = $("text", { x: m.l + band * i + band / 2, y: H - 9, "text-anchor": i === 0 ? "start" : i === n - 1 ? "end" : "middle" }, svg); t.textContent = o.tickLabel(i); });
    };
    mount(host, draw);
  }

  // ---------- heatmap (sequential single hue) ----------
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  function heatmap(host, o) {
    const draw = (W) => {
      const lo = hex(cssVar("--seq-lo")), hi = hex(cssVar("--seq-hi"));
      const rows = o.rows.length, cols = o.cols.length, m = { l: 44, r: 8, t: 22, b: 6 };
      const cw = (W - m.l - m.r) / cols, ch = 26, H = m.t + m.b + ch * rows;
      const flat = o.cells.flat().filter(Boolean).map((c) => c[0]), vmin = Math.min(...flat), vmax = Math.max(...flat);
      const svg = frame(host, W, H, m);
      o.cols.forEach((c, j) => { const t = $("text", { x: m.l + cw * j + cw / 2, y: 14, "text-anchor": "middle" }, svg); t.textContent = c; });
      o.rows.forEach((r, i) => {
        const t = $("text", { x: m.l - 8, y: m.t + ch * i + ch / 2 + 4, "text-anchor": "end" }, svg); t.textContent = r;
        o.cells[i].forEach((cell, j) => {
          const x = m.l + cw * j + 1, y = m.t + ch * i + 1;
          if (!cell) { $("rect", { x, y, width: cw - 2, height: ch - 2, rx: 3, style: "fill:none;stroke:var(--grid)" }, svg); return; }
          const f = (cell[0] - vmin) / (vmax - vmin || 1), rgb = lo.map((a, k) => Math.round(a + (hi[k] - a) * f));
          const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
          const rect = $("rect", { x, y, width: cw - 2, height: ch - 2, rx: 3, style: `fill:rgb(${rgb})` }, svg);
          if (cw > 40) { const t = $("text", { x: x + (cw - 2) / 2, y: y + ch / 2 + 3, "text-anchor": "middle", style: `fill:${lum > 0.55 ? "#0b0b0b" : "#fff"};font-size:11px` }, svg); t.textContent = fmt(cell[0], 0); }
          rect.addEventListener("mousemove", (e) => tip(`<div class="th">${o.cols[j]} · ${r}</div>${trow(null, "Mean wait", fmt(cell[0], 1) + " min")}${trow(null, "Exams", fmt(cell[1]))}`, e));
        });
      });
    };
    mount(host, draw);
  }

  // ---------- table helper ----------
  function table(cols, rows, cls = "") {
    return `<div class="tablewrap ${cls}"><table><thead><tr>${cols.map((c) => `<th class="${c.r ? "r" : ""}">${c.h}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr>${cols.map((c, i) => `<td class="${c.r ? "r" : ""} ${c.mono ? "mono" : ""}">${r[i] ?? ""}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
  }

  window.Charts = { lineChart, barChart, hbarChart, histBars, heatmap, table, fmt, fmtC, tip };
})();
