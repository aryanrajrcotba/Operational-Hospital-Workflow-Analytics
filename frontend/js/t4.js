/* T4 · Biomedical image processing: enhancement, restoration, segmentation, compression. Data: window.DATA.t4 */
(function () {
  const T4 = window.DATA.t4, { fmt } = Charts, { card, seg, sec, tbl, $id, fig } = UI;
  const E = T4.enhance, R = T4.restore, G = T4.segment, C = T4.compress;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const byId = (id) => E.find((e) => e.id === id);

  // linear interpolation of a metric onto a shared compression-ratio grid (log axis)
  const GRID = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
  function onGrid(rows, key) {
    const pts = rows.map((r) => [Math.log(r.ratio), r[key]]).sort((a, b) => a[0] - b[0]);
    return GRID.map((g) => {
      const x = Math.log(g);
      if (x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1); return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]); }
      return null;
    });
  }
  const scoreBars = (host, rows, key, color) => Charts.hbarChart(host, {
    labelW: 150, max: Math.ceil(Math.max(...rows.map((r) => r[key])) / 5) * 5 + 2, fmt: (v) => fmt(v, key === "ssim" ? 3 : 1),
    items: rows.map((r, i) => ({ label: r.name.replace(" input", ""), value: r[key], color: i === 0 ? "var(--muted)" : color, note: r.param })), valueName: key.toUpperCase() });

  function view() {
    const ph = T4.phantom, best = R.denoise.rows.slice(1).reduce((a, b) => (b.psnr > a.psnr ? b : a));
    const inp = R.denoise.rows[0], bestL = G.lung_rows.reduce((a, b) => (b.dice > a.dice ? b : a));
    const ll = C.rows_lossless, pick = (n) => ll.find((r) => r.name === n);
    return `
    <div class="hero">
      <div><h1>Biomedical image processing</h1>
        <p>Topic 4 of this project. Four things you do to an image before anyone (or any model) analyses it: make it easier to see, undo what the scanner did to it, outline the structures, and shrink it for storage. Each is scored against ground truth here, not judged by eye.</p></div>
      <div><div class="hero-fig num">+${fmt(best.psnr - inp.psnr, 1)} dB<small>PSNR gained by the best denoiser (${best.name}) over the noisy image</small></div></div>
    </div>
    <div class="callout warn"><p><b>These images are synthetic.</b> <span class="mono">WaitData.Published.xlsx</span> holds scheduling records, not pictures, so T4–T6 run on a generated chest-CT phantom (<span class="mono">pipeline/phantom.py</span>): Hounsfield-unit values, body, lungs, heart, spine, ribs, vessels and four nodules whose position, size and density are known. That is what makes exact scoring possible. It is far simpler than real anatomy, so the <i>ranking</i> of methods is informative but absolute numbers will not transfer to patient scans.</p></div>
    <div class="tiles">
      <div class="tile"><div class="k">Enhancement variants</div><div class="v">${E.length}</div><div class="s">3 CT windows + 5 generic filters + baseline</div></div>
      <div class="tile"><div class="k">Best lung outline</div><div class="v">${fmt(bestL.dice, 3)}</div><div class="s">Dice, ${bestL.name.toLowerCase()}</div></div>
      <div class="tile"><div class="k">Lossless ratio (noisy slice)</div><div class="v">${fmt(pick("LZMA").ratio, 1)}×</div><div class="s">${fmt(C.lossless_noise_free["LZMA"], 1)}× if the image had no noise</div></div>
      <div class="tile"><div class="k">Pixel size · slice</div><div class="v" style="font-size:20px;padding-top:3px">${ph.mm_per_px} mm · ${ph.size}²</div><div class="s">12-bit HU, 400 mm field of view</div></div>
    </div>

    <section class="block" id="t4-data">${sec("4.0", "The test image",
      `One axial slice at 1 unit = 200 mm. The ideal image is blurred slightly (point-spread ${ph.blur_px} px) and corrupted with correlated Gaussian noise (σ = ${ph.noise_hu} HU), roughly a low-dose scan. Displayed in a lung-and-soft-tissue window (level ${T4.view_window.level}, width ${T4.view_window.width} HU).`)}
      <div class="grid g3" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.1fr)">
        ${fig(T4.images.clean, "Ground truth (clean)", "the target for restoration")}
        ${fig(T4.images.acquired, "Acquired slice", `noise σ = ${ph.noise_hu} HU`)}
        ${card({ title: "Nodules in the slice", sub: "Position from image centre; known exactly", body: tbl([{ h: "#" }, { h: "x, y (mm)", r: 1 }, { h: "Diameter", r: 1 }, { h: "HU", r: 1 }], ph.nodules.map((n, i) => [i + 1, `${n.x_mm}, ${n.y_mm}`, n.diam_mm + " mm", `${n.hu > 0 ? "+" : ""}${n.hu} ${n.hu < -200 ? "(ground glass)" : ""}`])) })}
      </div>
    </section>

    <section class="block" id="t4-enh">${sec("4.1", "Enhancement: make structures easier to see",
      "Enhancement changes how values map to brightness; it adds no information. The baseline squeezes the whole −1024…+1500 HU range into 8 bits, which is why it looks dull. Two kinds of fix: CT <i>windows</i>, which use the known HU meaning of tissue, and generic filters that work on any picture.")}
      <div class="grid g3" id="enh-grid">${E.map((e) => fig(e.img, e.name, `${e.group}`)).join("")}</div>
      <div class="controls" style="margin-top:16px"><span id="enh-seg"></span><span class="legend-note" style="margin:0">Histogram of the selected output (grey = baseline)</span></div>
      <div class="grid g2">
        ${card({ title: "Histogram of gray levels", sub: "Share of pixels per bin, 0–255", id: "enh-hist" })}
        ${card({ title: "Measured effect", sub: "Gray levels are 0–255. Contrast = difference in mean brightness between two regions. CNR = contrast ÷ noise in flat soft tissue.", body: `<div id="enh-kv"></div>` })}
      </div>
      <h3 style="margin:22px 0 8px">All variants</h3>
      ${tbl([{ h: "Variant" }, { h: "Type" }, { h: "Nodule vs lung: contrast", r: 1 }, { h: "Fat vs muscle: contrast", r: 1 }, { h: "Noise (sd)", r: 1 }, { h: "Nodule CNR", r: 1 }, { h: "Fat/muscle CNR", r: 1 }, { h: "Entropy (bits)", r: 1 }],
        E.map((e) => [e.name, e.group, fmt(e.contrast_nodule, 0), fmt(e.contrast_fat, 0), fmt(e.noise, 1), fmt(e.cnr_nodule, 1), fmt(e.cnr_fat, 1), fmt(e.entropy, 2)]))}
      <div class="callout"><p><b>What the numbers say.</b> The <b>lung window</b> and <b>soft-tissue window</b> each spend the 8 bits on the range that matters for their tissue: nodule-vs-lung contrast rises from ${fmt(byId("linear").contrast_nodule, 0)} to ${fmt(byId("lung").contrast_nodule, 0)} gray levels in the lung window, and fat-vs-muscle contrast from ${fmt(byId("linear").contrast_fat, 0)} to ${fmt(byId("soft").contrast_fat, 0)} in the soft-tissue window. Note the CNR barely moves for a linear rescale: a window makes a difference <i>visible</i>, but it cannot lift a difference out of the noise. <b>Histogram equalisation and CLAHE</b> raise entropy but also raise noise (${fmt(byId("heq").noise, 1)} and ${fmt(byId("clahe").noise, 1)} vs ${fmt(byId("linear").noise, 1)}) and CLAHE erased the fat/muscle difference here (CNR ${fmt(byId("clahe").cnr_fat, 1)}). <b>Unsharp masking</b> lowers CNR for the same reason. Higher entropy is not "better".</p></div>
    </section>

    <section class="block" id="t4-rest">${sec("4.2", "Restoration: undo the scanner",
      `Restoration inverts a degradation model. Two cases, both scored against the clean image: <b>noise only</b> (σ = ${R.denoise.noise_hu} HU, a very low-dose scan) and <b>blur + noise</b> (Gaussian point-spread σ = ${R.deblur.psf_sigma} px, noise ${R.deblur.noise_hu} HU). Each method's one or two parameters were tuned on this image (the winning setting is shown), which flatters all methods equally; read the ranking.`)}
      <h3 style="margin:8px 0 8px">Denoising</h3>
      <div class="grid g3" style="grid-template-columns:repeat(2,minmax(0,1fr))">${[...R.denoise.rows.map((r) => fig(r.img, r.name, `${r.param} · PSNR ${fmt(r.psnr, 1)} dB · SSIM ${fmt(r.ssim, 3)}`, "wide")), fig(R.denoise.clean_img, "Clean reference", "what a perfect restoration would give", "wide")].join("")}</div>
      <div class="legend-note">Each picture: full slice on the left, 4× zoom of the chest wall and a nodule on the right.</div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Peak signal-to-noise ratio", sub: `dB against the clean image, data range ${fmt(R.psnr_range_hu)} HU. Higher is better.`, id: "dn-psnr", tableHTML: tbl([{ h: "Method" }, { h: "Setting" }, { h: "PSNR (dB)", r: 1 }, { h: "SSIM", r: 1 }], R.denoise.rows.map((r) => [r.name, r.param, fmt(r.psnr, 2), fmt(r.ssim, 4)])) })}
        ${card({ title: "Structural similarity (SSIM)", sub: "1.0 = identical structure. Rewards keeping edges, not just low error.", id: "dn-ssim" })}
      </div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Why not just blur harder?", sub: "Gaussian filter strength vs quality: noise falls but edges blur", id: "gs-psnr" })}
        <div class="card"><h3>Choosing a denoiser</h3><div class="sub">What each family assumes</div><dl class="kv" style="row-gap:8px">
          <dt>Gaussian</dt><dd>Neighbours are alike. Blurs edges as much as noise.</dd>
          <dt>Median</dt><dd>Outlier pixels are noise. Preserves edges better, can clip fine detail.</dd>
          <dt>Bilateral</dt><dd>Average only neighbours that are close <i>and</i> similar in value.</dd>
          <dt>Non-local means</dt><dd>Average pixels whose surrounding <i>patches</i> look alike anywhere in the image.</dd>
          <dt>Total variation</dt><dd>Real images are piecewise constant; penalise total gradient. Can give a flat, cartoon look.</dd></dl></div>
      </div>

      <h3 style="margin:30px 0 8px">Deblurring</h3>
      <div class="grid g3" style="grid-template-columns:repeat(2,minmax(0,1fr))">${R.deblur.rows.map((r) => fig(r.img, r.name, `${r.param} · PSNR ${fmt(r.psnr, 1)} dB · SSIM ${fmt(r.ssim, 3)}`, "wide")).join("")}</div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "PSNR", sub: "dB, higher is better", id: "db-psnr" })}
        ${card({ title: "SSIM", sub: "Higher is better", id: "db-ssim" })}
      </div>
      <div class="callout"><p><b>Caveats.</b> Wiener and Richardson–Lucy are given the <i>true</i> blur kernel; real scanners' point-spread functions must be measured or estimated (blind deconvolution), which is much harder. Deconvolution amplifies noise, which is why the regularisation setting matters. Restoration can also invent plausible-looking detail: never use a restored image to measure something the original did not show.</p></div>
    </section>

    <section class="block" id="t4-seg">${sec("4.3", "Segmentation: outline the structures",
      `Segmentation labels each pixel. Ground truth is the exact lung field of the phantom (outlined green); each method's output is outlined red. Body/air is separated first (Dice ${fmt(G.body_dice, 3)}), then each lung method works inside the body. Score = Dice overlap (2·|A∩B| / (|A|+|B|)) and IoU.`)}
      <div class="grid g3">${G.lung_rows.map((r) => fig(r.img, r.name, `Dice ${fmt(r.dice, 3)} · IoU ${fmt(r.iou, 3)}`)).join("")}</div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Lung segmentation: Dice", sub: "Higher is better; 1.0 = perfect overlap", id: "sg-dice", tableHTML: tbl([{ h: "Method" }, { h: "Dice", r: 1 }, { h: "IoU", r: 1 }], G.lung_rows.map((r) => [r.name, fmt(r.dice, 4), fmt(r.iou, 4)])) })}
        <div class="card"><h3>Reading the differences</h3><div class="sub">All methods start from the same noisy image</div><dl class="kv" style="row-gap:8px">
          <dt>Threshold, Otsu</dt><dd>One global cut. Bright vessels and nodules leave holes in the lung; noise speckles the edge.</dd>
          <dt>K-means</dt><dd>Clusters intensities into three classes: same weakness as a threshold, no spatial reasoning.</dd>
          <dt>Region growing</dt><dd>Grows from a seed while values stay similar. Stops at anything bright inside the lung.</dd>
          <dt>Watershed</dt><dd>Floods from markers along the gradient image, so boundaries sit on edges.</dd>
          <dt>Threshold + morphology</dt><dd>Same cut, then remove specks, fill holes, smooth. The holes are exactly the vessels and nodules the ground truth counts as lung.</dd></dl></div>
      </div>

      <h3 style="margin:30px 0 8px">Finding the nodules inside the lungs</h3>
      <p class="lede" style="margin-bottom:12px">Inside the best lung mask, keep bright blobs of nodule size and roundness. Green = true nodules, red = detected. The same rule is run on the noisy image and on the ${R.best_denoised.toLowerCase()} denoised image from 4.2.</p>
      <div class="grid g3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${fig(G.truth_img, "Ground truth", "lungs green, nodules yellow")}
        ${G.nodule_rows.map((r) => fig(r.img, r.name, `found ${r.found} of ${r.true_nodules} · ${r.false_blobs} false blob${r.false_blobs === 1 ? "" : "s"} · Dice ${fmt(r.dice, 2)}`)).join("")}
      </div>
      ${tbl([{ h: "Input" }, { h: "Nodules found", r: 1 }, { h: "False blobs", r: 1 }, { h: "Pixel precision", r: 1 }, { h: "Pixel recall", r: 1 }, { h: "Dice", r: 1 }], G.nodule_rows.map((r) => [r.name, `${r.found} of ${r.true_nodules}`, r.false_blobs, fmt(r.precision, 2), fmt(r.recall, 2), fmt(r.dice, 3)]))}
      <div class="callout"><p><b>Where a hand-built rule runs out.</b> Every nodule is found, but so are vessels: in a single slice a vessel cut across looks like a small round nodule. Denoising trims the speckle (precision ${fmt(G.nodule_rows[0].precision, 2)} → ${fmt(G.nodule_rows[1].precision, 2)}) but cannot tell a vessel from a nodule by intensity. Telling them apart needs shape and context, which is what the CNN in T5 learns.</p></div>
    </section>

    <section class="block" id="t4-comp">${sec("4.4", "Compression: store it smaller",
      `A ${ph.size}×${ph.size} slice stored as 16-bit words is ${fmt(C.pixels * 2 / 1024)} KB. <b>Lossless</b> coders restore every bit; <b>lossy</b> coders discard detail the eye is unlikely to miss. Medical images make both harder than photographs, for one reason below.`)}
      <h3 style="margin:8px 0 8px">Lossless</h3>
      <div class="grid g2">
        ${card({ title: "Compression ratio, lossless", sub: "Raw size ÷ compressed size. Higher is better. Every coder was decoded and checked bit-exact.", id: "cl-chart", tableHTML: tbl([{ h: "Method" }, { h: "Bytes", r: 1 }, { h: "Ratio", r: 1 }, { h: "Bits / pixel", r: 1 }, { h: "Note" }], ll.map((r) => [r.name, fmt(r.bytes), fmt(r.ratio, 2), fmt(r.bpp, 2), r.note])) })}
        <div class="card"><h3>Noise decides everything</h3><div class="sub">Same slice, noise removed (only blur left)</div><div id="cl-kv"></div>
        <div class="legend-note" style="margin-top:12px">Coders exploit repetition and predictability. Anatomy is smooth and predictable; scanner noise is random and cannot be compressed. That is why run-length coding <i>expands</i> this image (${fmt(pick("Run-length coding").ratio, 2)}×) and why the noise-free slice compresses ${fmt(C.lossless_noise_free["LZMA"] / pick("LZMA").ratio, 0)}× better than the real-looking one.</div></div>
      </div>

      <h3 style="margin:30px 0 8px">Lossy</h3>
      <p class="lede" style="margin-bottom:12px">Applied to the 8-bit display image (standard JPEG is 8-bit; ${fmt(C.lossy.raw_bytes_8bit / 1024)} KB raw). Quality knobs were swept for JPEG (block DCT) and JPEG 2000 (wavelet). "Nodule contrast kept" is CNR of the four nodules relative to the uncompressed image.</p>
      <div class="controls"><span id="ly-seg"></span></div>
      <div class="grid g2">
        ${card({ title: "Quality vs compression ratio", sub: "<span id='ly-sub'></span>", id: "ly-chart" })}
        ${card({ title: "Same file size, different damage", sub: `Zoomed crop at about ${fmt(C.compare.jpeg.ratio, 0)}:1 (JPEG) and ${fmt(C.compare.j2k.ratio, 0)}:1 (JPEG 2000)`, body: `<div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${C.compare.panels.map((p) => fig(p.img, p.name)).join("")}</div>
          <div class="legend-note">JPEG cuts the image into 8×8 blocks, so at high ratios you see blocks and ringing. JPEG 2000 filters the whole image, so it degrades as smooth blur. PSNR: JPEG ${fmt(C.compare.jpeg.psnr, 1)} dB, JPEG 2000 ${fmt(C.compare.j2k.psnr, 1)} dB. SSIM: ${fmt(C.compare.jpeg.ssim, 3)} vs ${fmt(C.compare.j2k.ssim, 3)}.</div>` })}
      </div>
      <div class="grid g2" style="margin-top:14px">
        ${card({ title: "Why transform coding works: energy compaction", sub: "8×8 DCT blocks of this slice, coefficients kept in zig-zag (low → high frequency) order", id: "dct-e" })}
        ${card({ title: "Quality when only the first k of 64 coefficients are kept", sub: "PSNR of the reconstruction, dB", id: "dct-p" })}
      </div>
      <div class="callout warn"><p><b>Do not choose a ratio from PSNR.</b> PSNR and SSIM measure resemblance, not diagnostic value. Nodule contrast is a task-specific check and falls sharply at high ratios here, long before the picture looks bad. Acceptable compression for real studies depends on modality, anatomy and clinical task, and is set by clinical guidance and local policy, not by a metric on one phantom slice.</p></div>
    </section>`;
  }

  function mount() {
    // enhancement histogram + metrics
    let sel = "clahe";
    const xs = E[0].hist.map((_, i) => i * 4);
    const drawEnh = (id) => {
      const e = byId(id), b = byId("linear"), tot = (h) => h.reduce((a, c) => a + c, 0);
      Charts.lineChart($id("enh-hist"), { x: xs, xTicks: [0, 64, 128, 192, 252], height: 220, area: true,
        series: [{ name: "Baseline", color: "var(--muted)", values: b.hist.map((c) => (c / tot(b.hist)) * 100) }, ...(id === "linear" ? [] : [{ name: e.name, color: "var(--s1)", values: e.hist.map((c) => (c / tot(e.hist)) * 100) }])],
        yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => `gray ${xs[i]}–${xs[i] + 3}` });
      const d = (k, lo) => `${fmt(e[k], k.startsWith("cnr") || k === "noise" || k === "entropy" ? 1 : 0)} <span class="legend-note">(baseline ${fmt(b[k], k.startsWith("cnr") || k === "noise" || k === "entropy" ? 1 : 0)})</span>`;
      $id("enh-kv").innerHTML = `<div style="font-weight:600;margin-bottom:8px">${e.name}</div><dl class="kv" style="row-gap:7px"><dt>Nodule vs lung contrast</dt><dd class="num">${d("contrast_nodule")}</dd><dt>Fat vs muscle contrast</dt><dd class="num">${d("contrast_fat")}</dd><dt>Noise (sd, soft tissue)</dt><dd class="num">${d("noise")}</dd><dt>Nodule CNR</dt><dd class="num">${d("cnr_nodule")}</dd><dt>Fat/muscle CNR</dt><dd class="num">${d("cnr_fat")}</dd><dt>Entropy (bits)</dt><dd class="num">${d("entropy")}</dd></dl>`;
    };
    seg($id("enh-seg"), E.map((e) => ({ v: e.id, label: e.name.split(" (")[0].replace("Full-range linear", "Baseline") })), sel, (v) => { sel = v; drawEnh(v); });
    drawEnh(sel);

    // restoration
    const dn = R.denoise.rows, db = R.deblur.rows;
    scoreBars($id("dn-psnr"), dn, "psnr", "var(--s1)"); scoreBars($id("dn-ssim"), dn, "ssim", "var(--s3)");
    scoreBars($id("db-psnr"), db, "psnr", "var(--s1)"); scoreBars($id("db-ssim"), db, "ssim", "var(--s3)");
    const sw = R.gaussian_sweep;
    Charts.lineChart($id("gs-psnr"), { x: sw.map((s) => s.sigma), xTicks: sw.map((s) => s.sigma), xLabel: (v) => v, height: 230, yMax: Math.ceil(Math.max(...sw.map((s) => s.psnr)) / 5) * 5,
      series: [{ name: "PSNR (dB)", color: "var(--s1)", values: sw.map((s) => s.psnr) }, { name: "SSIM × 40 (rescaled to share the axis)", color: "var(--s3)", values: sw.map((s) => s.ssim * 40) }],
      yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `Gaussian σ = ${sw[i].sigma} px`, yTitle: "" });

    // segmentation
    Charts.hbarChart($id("sg-dice"), { labelW: 170, max: 1, fmt: (v) => fmt(v, 3), valueName: "Dice", items: G.lung_rows.map((r) => ({ label: r.name, value: r.dice, color: r.name === G.best_lung ? "var(--s3)" : "var(--s1)" })) });

    // compression
    const names = C.rows_lossless.map((r) => r.name).filter((n) => n !== "Raw 16-bit words");
    Charts.barChart($id("cl-chart"), { categories: names.map((n) => n.replace("Entropy bound, ", "Entropy: ").replace("Deflate (zlib -9)", "Deflate").replace("Run-length coding", "RLE").replace("PNG 16-bit", "PNG").replace("prediction residual", "residual").replace("pixel values", "pixels")), height: 250, valueLabels: true,
      series: [{ name: "Slice with noise", color: "var(--ink)", values: names.map((n) => C.rows_lossless.find((r) => r.name === n).ratio) }, { name: "Same slice, no noise", color: "var(--s3)", values: names.map((n) => C.lossless_noise_free[n]) }], yFmt: (v) => fmt(v, v % 1 ? 1 : 0), tipFmt: (v) => fmt(v, 2) + "×" });
    $id("cl-kv").innerHTML = `<dl class="kv" style="row-gap:7px">${names.map((n) => `<dt>${n.replace("Entropy bound, ", "Entropy: ")}</dt><dd class="num">${fmt(C.rows_lossless.find((r) => r.name === n).ratio, 2)}× → <b>${fmt(C.lossless_noise_free[n], 2)}×</b></dd>`).join("")}</dl>`;

    const LY = { psnr: ["PSNR (dB)", 0, (v) => fmt(v) + " dB"], ssim: ["SSIM", 2, (v) => fmt(v, 2)], cnr_kept: ["Nodule contrast kept (%)", 0, (v) => fmt(v) + "%"] };
    const drawLy = (k) => {
      $id("ly-sub").textContent = LY[k][0] + " at each compression ratio (interpolated onto a shared grid)";
      const cap = k === "ssim" ? 1 : k === "cnr_kept" ? 110 : 50;
      Charts.lineChart($id("ly-chart"), { x: GRID, xTicks: [2, 4, 8, 16, 32, 64, 128], xLabel: (v) => v + ":1", height: 250, yMax: cap,
        series: [{ name: "JPEG", color: "var(--s2)", values: onGrid(C.lossy.jpeg, k) }, { name: "JPEG 2000", color: "var(--s1)", values: onGrid(C.lossy.j2k, k) }],
        yFmt: k === "ssim" ? (v) => fmt(v, 1) : (v) => fmt(v), tipFmt: LY[k][2], tipHeader: (i) => `${GRID[i]}:1` });
    };
    seg($id("ly-seg"), [{ v: "psnr", label: "PSNR" }, { v: "ssim", label: "SSIM" }, { v: "cnr_kept", label: "Nodule contrast kept" }], "psnr", drawLy); drawLy("psnr");
    const dc = C.dct.filter((d) => d.k);
    Charts.lineChart($id("dct-e"), { x: dc.map((d) => d.k), xTicks: [1, 6, 15, 28, 45, 64], xLabel: (v) => v, height: 210, yMax: 100, series: [{ name: "Energy in first k coefficients (%)", color: "var(--s1)", values: dc.map((d) => d.energy) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 2) + "%", tipHeader: (i) => `first ${dc[i].k} of 64` });
    const dp = C.dct.filter((d) => d.psnr != null);
    Charts.lineChart($id("dct-p"), { x: dp.map((d) => d.k), xTicks: [1, 6, 15, 28, 45, 55], xLabel: (v) => v, height: 210, yMax: 60, series: [{ name: "PSNR (dB)", color: "var(--s3)", values: dp.map((d) => d.psnr) }], yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 1) + " dB", tipHeader: (i) => `first ${dp[i].k} of 64` });
  }

  App.add({ id: "t4", label: "T4 · Image processing", view, mount });
})();
