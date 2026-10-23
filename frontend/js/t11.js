/* T11 · Information extraction and entity recognition on clinical text. Data: window.DATA.t11 */
(function () {
  const T = window.DATA.t11, { fmt } = Charts, { card, seg, sec, tbl, $id } = UI;
  const mono = (c) => `<span class="mono">${c}</span>`;
  const M = Object.keys(T.scores), MC = ["var(--muted)", "var(--s4)", "var(--s1)", "var(--s3)"];
  const TYPE_NAME = { ANATOMY: "Anatomy", FINDING: "Finding", SIZE: "Size" };
  let ex = 0;

  function annotate(text, spans, showStatus) {
    const sp = spans.slice().sort((a, b) => a.start - b.start);
    let out = "", pos = 0;
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    sp.forEach((s) => {
      if (s.start < pos) return;
      out += esc(text.slice(pos, s.start)) + `<mark class="ent ${s.type}" title="${s.type}">${esc(text.slice(s.start, s.end))}${showStatus && s.status ? `<sup>${s.status}</sup>` : ""}</mark>`;
      pos = s.end;
    });
    return out + esc(text.slice(pos));
  }

  function view() {
    const best = M.slice().sort((a, b) => T.scores[b].all.f1 - T.scores[a].all.f1)[0], dict = T.scores["Dictionary + regex"].all;
    return `
    <div class="hero">
      <div><h1>Information extraction and entity recognition</h1>
        <p>Topic 11 of this project. Turning a paragraph into a record means answering three questions: <b>what</b> is mentioned (anatomy, finding, size), <b>is it really there</b> (present, negated, uncertain), and <b>how do the pieces connect</b>. Recognisers are scored against the generator's gold spans, exact match, on ${fmt(T.n_test)} held-out reports.</p></div>
      <div><div class="hero-fig num">${fmt(dict.f1, 0)}% → ${fmt(T.scores[best].all.f1, 0)}%<small>entity F1 of a dictionary + regex matcher with a ${Math.round(T.lexicon.coverage * 100)} %-complete lexicon, vs the best learned tagger (${best.toLowerCase()})</small></div></div>
    </div>
    <div class="callout warn"><p><b>Synthetic and tidy.</b> Text is generated (<span class="mono">pipeline/clinical_text.py</span>); sentence templates repeat, so a learned tagger sees every pattern many times. Scores near 100 % show that the task is learnable from this language, not that real reports are solved. The NegEx-style rules were written by looking at the generator's cue words, then deliberately left blind to a few phrasings (“free of”, “not seen”, “ruled out”, “likely”) to show what incomplete rules cost.</p></div>

    <section class="block">${sec("11.1", "The extraction pipeline", "Each stage is evaluated on its own so that an error can be located.")}
      <div class="steps">
        <div class="step"><div class="n">1 · Tokenise</div><h3>Words and numbers</h3><p>Split text into tokens with character offsets, so spans can be compared exactly.</p></div>
        <div class="step"><div class="n">2 · Recognise</div><h3>Entities</h3><p>Anatomy, finding, size. Dictionary lookup or a token classifier over word, neighbour, suffix and shape features.</p></div>
        <div class="step"><div class="n">3 · Assert</div><h3>Present / negated / uncertain</h3><p>Rules that look for cue words before or after the finding, or a classifier on the surrounding words.</p></div>
        <div class="step"><div class="n">4 · Assemble</div><h3>A structured record</h3><p>Findings that are present become rows; the report is flagged abnormal if there is at least one.</p></div>
      </div>
      <div class="statrow" style="margin-top:14px">${Object.entries(T.entity_counts).map(([k, v]) => `<div class="card"><div class="sub">${TYPE_NAME[k]} mentions (test set)</div><div class="big">${fmt(v)}</div></div>`).join("")}
        <div class="card"><div class="sub">Lexicon</div><div class="big">${T.lexicon.terms_known}/${T.lexicon.terms_total}</div><div class="sub" style="margin:4px 0 0">terms known to the dictionary</div></div></div>
    </section>

    <section class="block">${sec("11.2", "Entity recognition", "Precision (how many predicted spans are right), recall (how many true spans were found) and F1, by entity type. A span counts only if type and both boundaries match.")}
      <div class="grid g2">
        ${card({ title: "Overall entity F1", sub: "All types, exact match", id: "t11-f1" })}
        ${card({ title: "F1 by entity type", sub: "Percent", id: "t11-type" })}
      </div>
      <div id="t11-table" style="margin-top:14px"></div>
      <h3 style="margin:26px 0 8px">Why the dictionary misses</h3>
      <div class="grid g2">
        ${card({ title: "Recall of the dictionary matcher", sub: "Anatomy and finding mentions, split by whether the term is in its lexicon", id: "t11-lex" })}
        ${card({ title: "Recall on strings never seen in training", sub: "Mostly misspelt or rare surface forms (n shown in the table)", id: "t11-unseen" })}
      </div>
      <div class="callout"><p>A dictionary is precise (${fmt(T.scores["Dictionary + regex"].all.p, 0)} % precision) but only as complete as its lexicon: every term it lacks is a guaranteed miss, and a misspelling is a miss even for a term it has. The learned tagger uses context (“…measures ___”, “no ___ is seen”) and word shape, so it finds terms it never saw. The cost is labelled training reports; the dictionary needs none.</p></div>
    </section>

    <section class="block">${sec("11.3", "Is the finding actually there?", "Reports mention far more findings to exclude them than to report them. Extracting “pneumothorax” from “no pneumothorax” would make a normal report look abnormal. Assertion is scored on the gold finding spans, to isolate it from recognition errors.")}
      <div class="grid g2">
        ${card({ title: "Assertion accuracy", sub: "Percent of " + fmt(Object.values(T.assertion_counts).reduce((a, b) => a + b, 0)) + " test findings (present " + fmt(T.assertion_counts.present) + ", negated " + fmt(T.assertion_counts.negated) + ", uncertain " + fmt(T.assertion_counts.uncertain) + ")", id: "t11-ass" })}
        ${card({ title: "Per class, F1 (%)", body: `<div id="t11-ass-tbl"></div>` })}
      </div>
      <h3 style="margin:22px 0 8px">Where the rules go wrong</h3>
      <div id="t11-ass-err"></div>
    </section>

    <section class="block">${sec("11.4", "From text to a table", "Putting it together: tag entities with the token classifier, keep findings whose assertion is “present”, and call a report abnormal if any remain.")}
      <div class="grid g2">
        <div class="card"><div class="sub">Reports correctly flagged abnormal / normal from extraction alone</div><div class="hero-fig num" style="font-size:40px">${fmt(T.abnormal_from_extraction_acc, 1)}%</div></div>
        ${card({ title: "Most frequent asserted-present findings", sub: "Counts in the test reports", id: "t11-top" })}
      </div>
      <div class="callout warn"><p><b>Why this is lower than the classifiers of T10.</b> Here the report label is derived from <i>rule-based</i> assertion, and a report is called abnormal on a single surviving finding, so every missed negation (“not seen”, “ruled out”) flips a normal report. Swapping the rules for the context classifier of 11.3 would lift this number; the structured table is only as good as its weakest stage.</p></div>
    </section>

    <section class="block">${sec("11.5", "See it on real reports", "Gold annotation, the dictionary matcher and the token classifier on the same report. Finding labels show the gold assertion.")}
      <div class="controls"><span id="t11-ex-seg"></span></div>
      <div id="t11-ex"></div>
      <div class="legend"><span class="pill"><i class="dot" style="background:var(--s1)"></i>Anatomy</span><span class="pill"><i class="dot" style="background:var(--s2)"></i>Finding</span><span class="pill"><i class="dot" style="background:var(--s3)"></i>Size</span></div>
    </section>`;
  }

  function mount() {
    Charts.hbarChart($id("t11-f1"), { labelW: 220, fmt: (v) => fmt(v, 1) + "%", valueName: "F1", max: 100, items: M.map((m, i) => ({ label: m, value: T.scores[m].all.f1, color: MC[i] })) });
    Charts.barChart($id("t11-type"), { categories: T.types.map((t) => TYPE_NAME[t]), height: 230, yMax: 100, series: M.map((m, i) => ({ name: m, color: MC[i], values: T.types.map((t) => T.scores[m][t].f1) })), yFmt: (v) => fmt(v, 0), tipFmt: (v) => fmt(v, 1) + "%" });
    $id("t11-table").innerHTML = tbl([{ h: "Method" }, ...T.types.flatMap((t) => [{ h: TYPE_NAME[t] + " P", r: 1 }, { h: "R", r: 1 }, { h: "F1", r: 1 }]), { h: "All F1", r: 1 }],
      M.map((m) => [m, ...T.types.flatMap((t) => [fmt(T.scores[m][t].p, 1), fmt(T.scores[m][t].r, 1), fmt(T.scores[m][t].f1, 1)]), `<b>${fmt(T.scores[m].all.f1, 1)}</b>`]));
    const lr = T.lexicon_recall;
    Charts.hbarChart($id("t11-lex"), { labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: "Recall", max: 100, items: [{ label: `Term in lexicon (n=${fmt(lr.n_in)})`, value: lr.in, color: "var(--s3)" }, { label: `Term not in lexicon (n=${fmt(lr.n_out)})`, value: lr.out, color: "var(--s2)" }] });
    const um = ["Dictionary + regex", "Token classifier (+ dictionary feature)", "Token classifier (no dictionary)"];
    Charts.hbarChart($id("t11-unseen"), { labelW: 250, fmt: (v) => fmt(v, 1) + "%", valueName: "Recall", max: 100, items: um.map((m, i) => ({ label: `${m} (n=${T.unseen_recall[m].n})`, value: T.unseen_recall[m].recall_unseen, color: ["var(--s4)", "var(--s1)", "var(--s3)"][i], note: "strings absent from the training reports" })) });

    const A = Object.keys(T.assertion), AC = ["var(--muted)", "var(--s4)", "var(--s1)"];
    Charts.hbarChart($id("t11-ass"), { labelW: 190, fmt: (v) => fmt(v, 1) + "%", valueName: "Accuracy", max: 100, items: A.map((a, i) => ({ label: a, value: T.assertion[a].acc, color: AC[i] })) });
    $id("t11-ass-tbl").innerHTML = tbl([{ h: "Method" }, ...T.assertion_labels.map((l) => ({ h: l, r: 1 }))], A.map((a) => [a, ...T.assertion_labels.map((l) => fmt(T.assertion[a].per[l].f1, 1))]));
    $id("t11-ass-err").innerHTML = T.assertion_errors.length ? tbl([{ h: "Sentence" }, { h: "Finding", mono: 1 }, { h: "Gold" }, { h: "Rule said" }], T.assertion_errors.map((e) => [e.sentence, e.finding, e.gold, e.rule])) +
      `<div class="legend-note">Errors cluster on phrasings the rules do not list. Each fix is another rule; the classifier learns them from labelled examples, but cannot be audited word by word.</div>` : `<div class="card"><p class="sub" style="margin:0">The rules made no mistakes on this test set.</p></div>`;
    Charts.hbarChart($id("t11-top"), { labelW: 130, fmt: (v) => fmt(v), valueName: "Mentions", items: T.top_present.map((x) => ({ label: x.term, value: x.n, color: "var(--s2)" })) });

    const draw = () => {
      const e = T.examples[ex];
      $id("t11-ex").innerHTML = [["Gold annotation", e.gold, true], ["Dictionary + regex (lexicon " + Math.round(T.lexicon.coverage * 100) + "% complete)", e.dict, false], ["Token classifier", e.ml, false]].map(([h, sp, st]) =>
        `<div class="card" style="margin-bottom:10px"><div class="tag" style="font-size:12px;font-weight:600;color:var(--muted)">${h.toUpperCase()}</div><div class="annot">${annotate(e.text, sp, st)}</div></div>`).join("");
    };
    seg($id("t11-ex-seg"), T.examples.map((_, i) => ({ v: i, label: "Report " + (i + 1) })), ex, (v) => { ex = v; draw(); });
    draw();
  }
  App.add({ id: "t11", label: "T11 · Entity extraction", view, mount });
})();
