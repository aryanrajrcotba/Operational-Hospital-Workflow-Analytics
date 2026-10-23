/* Extra chart kit for T7+: scatter plot and value matrix (heat table). Loaded after charts.js; adds to window.Charts. */
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const { fmt, tip } = Charts;

  function watch(host, draw) {
    host.classList.add("chart");
    const go = () => { host.querySelectorAll("svg").forEach((s) => s.remove()); draw(Math.max(280, host.clientWidth)); };
    go();
    let last = host.clientWidth, t;
    const ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - last) > 4) { last = host.clientWidth; clearTimeout(t); t = setTimeout(go, 80); } });
    ro.observe(host);
  }

  /* scatter(host, { x:[], y:[], group:[int], colors:[css], names:[label], height, tipFn(i) }) */
  function scatter(host, o) {
    watch(host, (W) => {
      const H = o.height || 300, m = { l: 12, r: 12, t: 10, b: 12 };
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, host);
      svg.addEventListener("mouseleave", () => tip(null));
      const xs = o.x, ys = o.y;
      const lo = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length * 0.005)]; }, hi = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.ceil(s.length * 0.995) - 1]; };
      const x0 = lo(xs), x1 = hi(xs), y0 = lo(ys), y1 = hi(ys);
      const X = (v) => m.l + Math.min(1, Math.max(0, (v - x0) / (x1 - x0 || 1))) * (W - m.l - m.r);
      const Y = (v) => m.t + (1 - Math.min(1, Math.max(0, (v - y0) / (y1 - y0 || 1)))) * (H - m.t - m.b);
      el("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, style: "fill:none;stroke:var(--grid)" }, svg);
      xs.forEach((v, i) => {
        const c = el("circle", { cx: X(v), cy: Y(ys[i]), r: 3.2, style: `fill:${o.colors[o.group[i]]};fill-opacity:.75;stroke:var(--surface);stroke-width:.6` }, svg);
        c.addEventListener("mousemove", (e) => tip(o.tipFn ? o.tipFn(i) : `<div class="th">${o.names ? o.names[o.group[i]] : o.group[i]}</div>`, e));
      });
    });
  }

  /* matrix(host, { rows:[], cols:[], values:[[]], fmt, tipFn(i,j), diverging, vmin, vmax, cell }) */
  function matrix(host, o) {
    watch(host, (W) => {
      const nr = o.rows.length, nc = o.cols.length, m = { l: o.labelW || 110, r: 6, t: o.colLabels === false ? 4 : 24, b: 4 };
      const cw = (W - m.l - m.r) / nc, ch = o.cell || 28, H = m.t + m.b + ch * nr;
      const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, host);
      svg.addEventListener("mouseleave", () => tip(null));
      const flat = o.values.flat().filter((v) => v != null);
      const vmin = o.vmin ?? Math.min(...flat), vmax = o.vmax ?? Math.max(...flat);
      const lo = hex(cssVar("--seq-lo")), hiC = hex(cssVar("--seq-hi")), neg = hex(cssVar("--div-neg").length === 7 ? cssVar("--div-neg") : "#e34948"), surf = hex(cssVar("--surface").length === 7 ? cssVar("--surface") : "#fcfcfb");
      if (o.colLabels !== false) o.cols.forEach((c, j) => { const t = el("text", { x: m.l + cw * j + cw / 2, y: 15, "text-anchor": "middle", style: "font-size:11px" }, svg); t.textContent = c; });
      o.rows.forEach((rw, i) => {
        const t = el("text", { x: m.l - 8, y: m.t + ch * i + ch / 2 + 4, "text-anchor": "end", style: "font-size:11.5px" }, svg); t.textContent = rw;
        o.values[i].forEach((v, j) => {
          const x = m.l + cw * j + 1, y = m.t + ch * i + 1;
          if (v == null) { el("rect", { x, y, width: cw - 2, height: ch - 2, rx: 3, style: "fill:none;stroke:var(--grid)" }, svg); return; }
          let rgb;
          if (o.diverging) { const a = Math.min(1, Math.abs(v) / (o.vmax || 1)), base = v >= 0 ? hiC : neg; rgb = surf.map((s, k) => Math.round(s + (base[k] - s) * a)); }
          else { const f = (v - vmin) / (vmax - vmin || 1); rgb = lo.map((a, k) => Math.round(a + (hiC[k] - a) * Math.min(1, Math.max(0, f)))); }
          const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
          const rect = el("rect", { x, y, width: cw - 2, height: ch - 2, rx: 3, style: `fill:rgb(${rgb})` }, svg);
          if (cw > 26) { const t = el("text", { x: x + (cw - 2) / 2, y: y + ch / 2 + 3.5, "text-anchor": "middle", style: `fill:${lum > 0.55 ? "#0b0b0b" : "#fff"};font-size:10.5px` }, svg); t.textContent = o.fmt ? o.fmt(v) : fmt(v, 1); }
          rect.addEventListener("mousemove", (e) => tip(o.tipFn ? o.tipFn(i, j, v) : `<div class="th">${o.rows[i]} · ${o.cols[j]}</div><div>${o.fmt ? o.fmt(v) : fmt(v, 1)}</div>`, e));
        });
      });
    });
  }
  const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#8a5cd6", "#d6478f", "#5a6b7b", "#6bb7c9"];
  Object.assign(window.Charts, { scatter, matrix, PALETTE });
})();
