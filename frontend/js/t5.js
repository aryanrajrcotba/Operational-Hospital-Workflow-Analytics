/* T5 · Biomedical image analysis: SIFT, RANSAC, CNN. Data: window.DATA.t5 */
(function () {
  const T5 = window.DATA.t5, { fmt } = Charts, { card, seg, sec, tbl, $id, fig } = UI;
  const RG = T5.registration, CN = T5.cnn, mono = (c) => `<span class="mono">${c}</span>`;
  const mm = (px) => fmt(px * RG.mm_per_px, 1);
  const d64 = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));

  // ROC curves come with different x for each model: put them on a common false-positive grid
  const FPR = Array.from({ length: 51 }, (_, i) => i / 50);
  function tprOn(roc) {
    return FPR.map((f) => {
      const x = roc.fpr, y = roc.tpr;
      for (let i = 1; i < x.length; i++) if (f <= x[i]) { const t = (f - x[i - 1]) / (x[i] - x[i - 1] || 1); return y[i - 1] + t * (y[i] - y[i - 1]); }
      return y[y.length - 1];
    });
  }

  function view() {
    const lsE = RG.ls.tre_px, rsE = RG.ransac.tre_px, t = CN.test, base = CN.baselines, lr = base["Logistic regression on pixels"];
    const sd = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    const cm = t.cm;
    return `
    <div class="hero">
      <div><h1>Biomedical image analysis</h1>
        <p>Topic 5 of this project. Two ways a computer finds meaning in an image: hand-designed local features (SIFT) matched across two scans and fitted robustly (RANSAC) to align them, and a small convolutional neural network (CNN) that learns its own features to spot nodules.</p></div>
      <div><div class="hero-fig num">${fmt(rsE * RG.mm_per_px, 1)} mm<small>registration error at the nodules with SIFT + RANSAC, vs ${fmt(lsE * RG.mm_per_px, 0)} mm with plain least squares on the same matches</small></div></div>
    </div>
    <div class="callout warn"><p><b>Synthetic images again.</b> As in T4, everything runs on the generated chest-CT phantom because the workbook has no images. Registration is scored against a transform we applied ourselves (so the truth is exact); the CNN is trained and tested on patches from separate phantom "patients" (${CN.sizes.train.cases} / ${CN.sizes.val.cases} / ${CN.sizes.test.cases} cases for train / validation / test, no case shared between sets).</p></div>
    <div class="tiles">
      <div class="tile"><div class="k">SIFT keypoints</div><div class="v">${RG.n_kp[0]} · ${RG.n_kp[1]}</div><div class="s">reference · moving image</div></div>
      <div class="tile"><div class="k">Matches that are right</div><div class="v">${fmt(RG.match_precision, 0)}% → ${fmt(RG.ransac_inlier_precision, 0)}%</div><div class="s">${RG.n_matches} matches, before → after RANSAC</div></div>
      <div class="tile"><div class="k">Rotation recovered</div><div class="v">${fmt(RG.ransac.rotation_deg, 1)}°</div><div class="s">true ${RG.true.rotation_deg}° · scale ${fmt(RG.ransac.scale, 3)} vs ${RG.true.scale}</div></div>
      <div class="tile"><div class="k">CNN test AUC</div><div class="v">${fmt(t.auc, 3)}</div><div class="s">${fmt(CN.params)} parameters · logistic regression ${fmt(lr.auc, 3)}</div></div>
    </div>

    <section class="block" id="t5-sift">${sec("5.1", "SIFT: find points that survive a change of view",
      "A useful keypoint is one you can find again after the image is rotated, scaled, shifted or re-scanned with different noise. SIFT (scale-invariant feature transform) builds a Gaussian scale space, keeps the extrema of the difference-of-Gaussians, gives each an orientation from local gradients and describes it with a 128-number histogram of gradient directions.")}
      <div class="steps">
        <div class="step"><div class="n">1 · Detect</div><h3>Scale-space extrema</h3><p>Blob-like points that are extreme in position <i>and</i> scale.</p></div>
        <div class="step"><div class="n">2 · Orient</div><h3>Dominant gradient</h3><p>Rotate the description to it, so rotation stops mattering.</p></div>
        <div class="step"><div class="n">3 · Describe</div><h3>128-D descriptor</h3><p>4×4 cells × 8 gradient directions, normalised against lighting change.</p></div>
        <div class="step"><div class="n">4 · Match</div><h3>Ratio test</h3><p>Accept a match only if the best neighbour is clearly closer than the second best (ratio ≤ 0.8), and both images agree.</p></div>
      </div>
      <div class="grid g2" style="margin-top:18px">
        ${fig(RG.img.kp_ref, "Reference scan", `${RG.n_kp[0]} keypoints; circle size = scale`)}
        ${fig(RG.img.kp_mov, "Second scan", `${RG.n_kp[1]} keypoints; rotated ${RG.true.rotation_deg}°, scaled ${RG.true.scale}×, shifted, different noise and a slice 4 mm away`)}
      </div>
      <div class="legend-note">Keypoints gather on high-contrast structure: rib ends, the spine, the couch edge, vessels and the lung boundary. Flat regions (muscle, lung parenchyma) give none.</div>
    </section>

    <section class="block" id="t5-ransac">${sec("5.2", "RANSAC: fit a transform that ignores wrong matches",
      `Of ${RG.n_matches} matches, ${RG.matches_truly_correct} are correct (within 3 px of where the true transform sends the point) and ${RG.n_matches - RG.matches_truly_correct} are not: the rib pattern repeats and vessels look alike. Ordinary least squares uses every match, so a few bad ones drag the answer far off. RANSAC (random sample consensus) instead repeats: pick a minimal random sample (2 matches fix a similarity transform), fit, count how many other matches agree within a tolerance, and keep the model with the most agreeing "inliers".`)}
      ${fig(RG.img.matches, "Matches between the two scans", `green = kept by RANSAC (${RG.ransac_inliers}), red = rejected (${RG.ransac_outliers_removed}); up to 140 drawn`, "wide")}
      <h3 style="margin:22px 0 8px">Recovering the transform</h3>
      ${tbl([{ h: "" }, { h: "Rotation (°)", r: 1 }, { h: "Scale", r: 1 }, { h: "Centre shift x (px)", r: 1 }, { h: "Centre shift y (px)", r: 1 }, { h: "Error at nodules (px)", r: 1 }, { h: "(mm)", r: 1 }],
        [["<b>True (applied)</b>", fmt(RG.true.rotation_deg, 2), fmt(RG.true.scale, 3), fmt(RG.true.dx, 1), fmt(RG.true.dy, 1), "0", "0"],
         ["Least squares, all matches", fmt(RG.ls.rotation_deg, 2), fmt(RG.ls.scale, 3), fmt(RG.ls.dx, 1), fmt(RG.ls.dy, 1), `<span class="bad">${fmt(lsE, 2)}</span>`, mm(lsE)],
         ["RANSAC (3 px tolerance)", fmt(RG.ransac.rotation_deg, 2), fmt(RG.ransac.scale, 3), fmt(RG.ransac.dx, 1), fmt(RG.ransac.dy, 1), `<span class="ok">${fmt(rsE, 2)}</span>`, mm(rsE)]])}
      <div class="legend-note">"Error at nodules" is the target registration error: the mean distance between where the true and the estimated transform send the four nodule centres. It is the number that matters if you want to find the same lesion in the follow-up scan.</div>
      <div class="grid g3" style="margin-top:16px">
        ${fig(RG.img.before, "Before", "reference red, moving green")}
        ${fig(RG.img.after, "After RANSAC alignment", "aligned structures turn yellow")}
        ${fig(RG.img.checker, "Checkerboard", "alternating tiles of each image; edges continue across tiles")}
      </div>
      <div class="grid g2" style="margin-top:16px">
        ${card({ title: "Robustness to bad matches", sub: `Take the ${RG.robustness.good_matches} correct matches, add random wrong ones, refit ${RG.robustness.trials}×. Error at nodules, px.`, id: "rb-chart", tableHTML: tbl([{ h: "Wrong matches" }, { h: "LS median", r: 1 }, { h: "LS 90th pct", r: 1 }, { h: "RANSAC median", r: 1 }, { h: "RANSAC 90th pct", r: 1 }], RG.robustness.rows.map((r) => [r.outlier_pct + "%", fmt(r.ls_median, 2), fmt(r.ls_p90, 2), fmt(r.ransac_median, 2), fmt(r.ransac_p90, 2)])) })}
        ${card({ title: "The tolerance is a judgement call", sub: "RANSAC inlier threshold vs what it keeps", body: `${tbl([{ h: "Tolerance (px)", r: 1 }, { h: "Inliers", r: 1 }, { h: "Truly correct", r: 1 }, { h: "Error (px)", r: 1 }], RG.threshold_sweep.map((s) => [s.threshold, s.inliers, s.precision == null ? "–" : fmt(s.precision, 0) + "%", s.tre_px == null ? "–" : fmt(s.tre_px, 2)]))}<div class="legend-note">Too tight and you throw away good matches; too loose and wrong ones creep in. Here 2 px or less keeps only correct matches; the main result above uses 3 px.</div>` })}
      </div>
      <div class="callout"><p><b>Limits.</b> Two scans of the same patient share structure; multi-modality registration (CT to MRI) breaks SIFT because intensities no longer correspond, and needs mutual-information methods. A similarity transform (rotation, scale, shift) cannot describe breathing or organ motion; that needs a deformable model. RANSAC can fail if inliers are too rare for the number of trials.</p></div>
    </section>

    <section class="block" id="t5-cnn">${sec("5.3", "CNN: learn the features instead of designing them",
      `Task: given a ${CN.patch_px}×${CN.patch_px}-pixel patch (${CN.patch_mm} mm) of a lung-window slice, is there a nodule in the centre? Negatives are what confuses a nodule detector: plain lung, <b>vessels cut across</b>, and ribs, heart edge and spine. About 1 patch in 4 is a nodule.`)}
      <div class="grid g3" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        ${["train", "val", "test"].map((s) => `<div class="tile"><div class="k">${{ train: "Training", val: "Validation", test: "Test (never seen)" }[s]}</div><div class="v">${fmt(CN.sizes[s].patches)}</div><div class="s">${fmt(CN.sizes[s].nodules)} nodule patches · ${CN.sizes[s].cases} phantom patients</div></div>`).join("")}
      </div>
      <h3 style="margin:22px 0 8px">The network (${fmt(CN.params)} parameters)</h3>
      <div class="chips" style="gap:8px;align-items:center">${["patch 1×32×32", "conv 3×3 ×8 + BN + ReLU", "max-pool ½", "conv 3×3 ×16 + BN + ReLU", "max-pool ½", "conv 3×3 ×32 + BN + ReLU", "1×1 conv → 8×8 score map", "soft-max pooling → probability"].map((x, i, a) => `<span class="chip" style="font-size:12.5px;padding:4px 11px">${x}</span>${i < a.length - 1 ? '<span style="color:var(--muted)">→</span>' : ""}`).join("")}</div>
      <div class="legend-note">Convolutions slide small learned filters over the image; ReLU keeps positive responses; pooling shrinks the map so later filters see a wider area; the last step scores every location and takes a soft maximum, because a nodule is a small object that should fire <i>somewhere</i>. Training: ${CN.epochs} epochs, Adam, cosine learning-rate decay, random flips and 90° rotations, keep the epoch with the lowest validation loss (epoch ${CN.best_epoch}). Batch normalisation after each convolution matters here: in a trial without it, one of three training seeds was still stuck on the "call everything negative" plateau after 60 epochs.</div>

      <div class="grid g2" style="margin-top:16px">
        ${card({ title: "Learning curves", sub: "Cross-entropy loss per epoch, training vs validation", id: "cn-loss" })}
        ${card({ title: "Accuracy per epoch", sub: "% of patches classified correctly", id: "cn-acc" })}
      </div>

      <h3 style="margin:26px 0 8px">Results on the test cases</h3>
      <div class="grid g2">
        ${card({ title: "ROC curve", sub: "True-positive rate vs false-positive rate as the decision threshold slides. Diagonal = coin flip.", id: "cn-roc" })}
        ${card({ title: "Against simpler baselines", sub: "Same test patches", body: tbl([{ h: "Model" }, { h: "AUC", r: 1 }, { h: "Accuracy", r: 1 }, { h: "Precision", r: 1 }, { h: "Recall", r: 1 }, { h: "F1", r: 1 }],
          [["<b>CNN</b>", fmt(t.auc, 3), fmt(t.accuracy, 1) + "%", fmt(t.precision, 1) + "%", fmt(t.recall, 1) + "%", fmt(t.f1, 1) + "%"], ...Object.entries(base).map(([n, b]) => [n, fmt(b.auc, 3), fmt(b.accuracy, 1) + "%", fmt(b.precision, 1) + "%", fmt(b.recall, 1) + "%", fmt(b.f1, 1) + "%"])]) +
          `<div class="legend-note">CNN over ${CN.seeds.auc.length} training seeds: AUC ${fmt(mean(CN.seeds.auc), 3)} ± ${fmt(sd(CN.seeds.auc), 3)}, accuracy ${fmt(mean(CN.seeds.accuracy), 1)} ± ${fmt(sd(CN.seeds.accuracy), 1)}%. The table shows seed 0.</div>
          <div style="display:grid;grid-template-columns:auto repeat(2,1fr);gap:4px;margin-top:12px;font-size:13px;text-align:center"><span></span><b>predicted nodule</b><b>predicted not</b><b style="text-align:right">nodule</b><span class="chip" style="background:color-mix(in srgb,var(--good) 18%,var(--surface))">${cm.tp} found</span><span class="chip" style="background:color-mix(in srgb,var(--crit) 18%,var(--surface))">${cm.fn} missed</span><b style="text-align:right">not nodule</b><span class="chip" style="background:color-mix(in srgb,var(--crit) 18%,var(--surface))">${cm.fp} false alarms</span><span class="chip" style="background:color-mix(in srgb,var(--good) 18%,var(--surface))">${cm.tn} rejected</span></div>` })}
      </div>
      <div class="callout"><p><b>An honest reading.</b> ${t.auc > lr.auc
        ? `The CNN clearly beats logistic regression on raw pixels (AUC ${fmt(t.auc, 3)} vs ${fmt(lr.auc, 3)}) and the centre-surround rule (${fmt(base["Centre-surround rule"].auc, 3)}), and the three training seeds agree (±${fmt(sd(CN.seeds.auc), 4)}). A plausible reason is that it can use shape as well as brightness to tell a vessel from a nodule. <b>Do not read the absolute number as clinical performance:</b> training and test patients come from the same generator, so this is in-distribution accuracy on a simple phantom; on real scans, with other scanners and far more anatomical variety, expect the margin to shrink.`
        : `On these patches the CNN does <b>not</b> beat a logistic regression on raw pixels (AUC ${fmt(t.auc, 3)} vs ${fmt(lr.auc, 3)}); the patches are small and centred, so a linear template already captures much of the task. Differences of a few thousandths of AUC are inside seed-to-seed spread (±${fmt(sd(CN.seeds.auc), 3)}).`}
        Decision threshold 0.5 is a default; a screening tool would choose it for a target sensitivity.</p></div>

      <h3 style="margin:26px 0 8px">Inside the network</h3>
      <div class="grid g2">
        ${card({ title: "First-layer filters", sub: "The eight 3×3 kernels the network learned. Bright = positive weight.", body: `<div id="cn-filters" style="display:flex;gap:10px;flex-wrap:wrap"></div><div class="legend-note">Look for edge detectors (bright on one side, dark on the other) and blob detectors (bright centre). Nobody told it to.</div>` })}
        ${card({ title: "First-layer feature maps", sub: "What each filter responds to on one true nodule patch", body: `<div id="cn-fmaps" style="display:flex;gap:8px;flex-wrap:wrap"></div>` })}
      </div>
      <div class="controls" style="margin-top:16px"><label class="legend-note" style="margin:0;display:inline-flex;gap:6px;align-items:center"><input type="checkbox" id="cn-cam" checked> Show where the network is looking (its score map)</label></div>
      <div id="cn-examples" class="grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div>
      <div class="legend-note">Red overlay = locations that raised the nodule score. Correct detections should light up the centre; misses and false alarms show what the model confuses.</div>

      <h3 style="margin:26px 0 8px">From patches to a whole slice</h3>
      <p class="lede" style="margin-bottom:12px">Slide the network over an unseen slice (window every ${CN.detect.stride} px, ${fmt(CN.detect.windows)} windows) and mark where the probability passes a threshold. True nodules are circled green, detections red.</p>
      <div class="controls"><span id="dt-seg"></span><span class="legend-note" id="dt-note" style="margin:0"></span></div>
      <div class="grid g2">
        <div class="card"><div style="position:relative;line-height:0"><img id="dt-base" src="${CN.detect.base}" alt="Unseen slice" style="width:100%;border-radius:8px"><canvas id="dt-cv" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div></div>
        ${fig(CN.detect.img, "Probability map", "red = probability of a nodule, per window")}
      </div>
      <div class="callout warn"><p><b>Balanced patches ≠ a real slice.</b> Training saw one nodule in four patches; a real slice is almost entirely non-nodule, so even a small false-positive rate produces false alarms. Raising the threshold trades them for missed nodules. The false alarm at the lower thresholds sits on the CT couch, an object that never appeared among the training negatives: the network only knows what it was shown. Practical detectors add <i>hard-negative mining</i> (retrain on the windows they got wrong) and are evaluated with free-response ROC (sensitivity vs false alarms <i>per scan</i>), not per-patch accuracy.</p></div>
    </section>`;
  }

  function mount() {
    Charts.lineChart($id("rb-chart"), { x: RG.robustness.rows.map((r) => r.outlier_pct), xTicks: [0, 20, 40, 60, 80], xLabel: (v) => v + "%", height: 240,
      series: [{ name: "Least squares (90th pct)", color: "var(--s2)", values: RG.robustness.rows.map((r) => r.ls_p90) }, { name: "Least squares (median)", color: "var(--s4)", values: RG.robustness.rows.map((r) => r.ls_median) }, { name: "RANSAC (median)", color: "var(--s1)", values: RG.robustness.rows.map((r) => r.ransac_median) }],
      yFmt: (v) => fmt(v), tipFmt: (v) => fmt(v, 2) + " px", tipHeader: (i) => `${RG.robustness.rows[i].outlier_pct}% of matches wrong` });

    const H = CN.history, ep = H.map((h) => h.epoch);
    Charts.lineChart($id("cn-loss"), { x: ep, xTicks: [1, 10, 20, 30, 40, 50, 60], height: 230, series: [{ name: "Training", color: "var(--s1)", values: H.map((h) => h.train_loss) }, { name: "Validation", color: "var(--s2)", values: H.map((h) => h.val_loss) }], yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 3), tipHeader: (i) => "epoch " + ep[i], vlines: [{ x: CN.best_epoch, label: "kept" }] });
    Charts.lineChart($id("cn-acc"), { x: ep, xTicks: [1, 10, 20, 30, 40, 50, 60], height: 230, yMax: 100, series: [{ name: "Training", color: "var(--s1)", values: H.map((h) => h.train_acc) }, { name: "Validation", color: "var(--s2)", values: H.map((h) => h.val_acc) }], yFmt: (v) => fmt(v) + "%", tipFmt: (v) => fmt(v, 1) + "%", tipHeader: (i) => "epoch " + ep[i] });

    const b = CN.baselines, names = Object.keys(b);
    Charts.lineChart($id("cn-roc"), { x: FPR, xTicks: [0, 0.25, 0.5, 0.75, 1], xLabel: (v) => v, height: 260, yMax: 1,
      series: [{ name: "CNN", color: "var(--s1)", values: tprOn(CN.roc) }, { name: names[0], color: "var(--s3)", values: tprOn(b[names[0]].roc) }, { name: names[1], color: "var(--muted)", values: tprOn(b[names[1]].roc) }, { name: "Chance", color: "var(--axis)", values: FPR }],
      yFmt: (v) => fmt(v, 1), tipFmt: (v) => fmt(v, 2), tipHeader: (i) => `false-positive rate ${fmt(FPR[i], 2)}` });

    // filters + feature maps as tiny canvases
    const tile = (w, h, draw, scale) => { const c = document.createElement("canvas"); c.width = w; c.height = h; c.style.cssText = `width:${w * scale}px;height:${h * scale}px;image-rendering:pixelated;border-radius:6px;border:1px solid var(--border)`; draw(c.getContext("2d")); return c; };
    const gray = (ctx, w, h, get) => { const im = ctx.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = get(i); im.data.set([v, v, v, 255], i * 4); } ctx.putImageData(im, 0, 0); };
    CN.filters.forEach((k) => {
      const flat = k.flat(), m = Math.max(...flat.map(Math.abs)) || 1;
      $id("cn-filters").appendChild(tile(3, 3, (ctx) => gray(ctx, 3, 3, (i) => Math.round(128 + (flat[i] / m) * 127)), 30));
    });
    const fm = CN.feature_maps, n = fm.size;
    $id("cn-fmaps").appendChild(tile(32, 32, (ctx) => { const p = d64(fm.patch); gray(ctx, 32, 32, (i) => p[i]); }, 3));
    $id("cn-fmaps").insertAdjacentHTML("beforeend", `<span style="align-self:center;color:var(--muted)">→</span>`);
    fm.maps.forEach((m) => { const a = d64(m); $id("cn-fmaps").appendChild(tile(n, n, (ctx) => gray(ctx, n, n, (i) => a[i]), 3)); });

    // examples with score-map overlay
    const drawEx = () => {
      const show = $id("cn-cam").checked, host = $id("cn-examples");
      host.innerHTML = "";
      CN.examples.forEach((e) => {
        const wrap = document.createElement("div");
        wrap.className = "card"; wrap.style.padding = "10px";
        const c = document.createElement("canvas"); c.width = 128; c.height = 128; c.style.cssText = "width:100%;border-radius:6px;image-rendering:pixelated";
        const ctx = c.getContext("2d"), p = d64(e.patch), src = document.createElement("canvas"); src.width = src.height = 32;
        gray(src.getContext("2d"), 32, 32, (i) => p[i]);
        ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, 128, 128);
        if (show) {
          const cam = document.createElement("canvas"); cam.width = cam.height = 8;
          const cc = cam.getContext("2d"), im = cc.createImageData(8, 8);
          e.cam.forEach((v, i) => im.data.set([255, 60, 60, Math.round(Math.max(0, v - 0.35) / 0.65 * 200)], i * 4)); cc.putImageData(im, 0, 0);
          ctx.imageSmoothingEnabled = true; ctx.drawImage(cam, 0, 0, 128, 128);
        }
        const ok = e.kind === "Nodule found" || e.kind === "Correctly rejected";
        wrap.appendChild(c);
        wrap.insertAdjacentHTML("beforeend", `<div style="margin-top:6px;font-size:12.5px"><b class="${ok ? "ok" : "bad"}">${e.kind}</b><br><span class="legend-note">P(nodule) = ${fmt(e.prob, 2)}</span></div>`);
        host.appendChild(wrap);
      });
    };
    $id("cn-cam").onchange = drawEx; drawEx();

    // sliding-window detections
    const D = CN.detect, keys = Object.keys(D.by_threshold);
    const drawDt = (k) => {
      const cv = $id("dt-cv"), W = 256; cv.width = W * 2; cv.height = W * 2; const g = cv.getContext("2d"); g.scale(2, 2); g.clearRect(0, 0, W, W);
      g.lineWidth = 1.5; g.strokeStyle = "#3ddc84"; D.nodules.forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, Math.max(7, r + 4), 0, 6.283); g.stroke(); });
      g.strokeStyle = "#ff4d4d"; D.by_threshold[k].detections.forEach(([x, y]) => g.strokeRect(x - 5, y - 5, 10, 10));
      const s = D.by_threshold[k];
      $id("dt-note").textContent = `Threshold ${k}: found ${s.found} of ${s.of} nodules, ${s.false_alarms} false alarm${s.false_alarms === 1 ? "" : "s"}`;
    };
    seg($id("dt-seg"), keys.map((k) => ({ v: k, label: "P ≥ " + k })), keys[0], drawDt); drawDt(keys[0]);
  }

  App.add({ id: "t5", label: "T5 · Image analysis", view, mount });
})();
