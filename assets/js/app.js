import { TYPES, DEFAULT_TYPES, RANK, scan, parseFasta, hasLysine } from "./kferq.js";
import { loadIndex, loadOrganism, parseIdList, resolveIds, fetchSequences } from "./data.js";
import { enrichment } from "./enrich.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const nf = (x) => new Intl.NumberFormat("en").format(x);
const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
// lets the status message paint before a long computation (a timer, unlike requestAnimationFrame, also fires in background tabs)
const nextFrame = () => new Promise((r) => setTimeout(r, 30));
const TYPE = Object.fromEntries(TYPES.map((t) => [t.code, t]));
const ADVANCED = new Set(["KP", "N", "NP"]);
const SHOW_MAX = 500; // rows rendered on the page; downloads hold everything
const HTML_MAX = 200; // sequences in the highlighted-sequence download

const state = {
  types: new Set(DEFAULT_TYPES),
  ub: false,
  index: null,
  sequences: null,
  ids: null,
  enrichment: null,
};

const selectedMotifs = (p) => p.motifs.filter((m) => state.types.has(m.type));
const orgMeta = (key) => state.index.organisms.find((o) => o.key === key);

// ---------------------------------------------------------------- motif class controls

function initClassControls() {
  const box = $("class-chips");
  box.innerHTML = TYPES.map((t) => `
    <label class="class-chip m-${t.code}${ADVANCED.has(t.code) ? " advanced" : ""}">
      <input type="checkbox" value="${t.code}"${state.types.has(t.code) ? " checked" : ""}>
      <span class="dot"></span>${esc(t.name)} <span class="code">${t.code}</span>
    </label>`).join("");
  box.insertAdjacentHTML("afterend", `<p class="hint">Dashed classes have less experimental support and are off by default.</p>`);
  box.addEventListener("change", (e) => {
    if (e.target.checked) state.types.add(e.target.value);
    else state.types.delete(e.target.value);
    refreshAfterOptionChange();
  });
  $("flag-ub").addEventListener("change", (e) => {
    state.ub = e.target.checked;
    refreshAfterOptionChange();
  });
}

function refreshAfterOptionChange() {
  if (state.sequences) renderFinder("sequences");
  if (state.ids) renderFinder("ids");
  const stale = $("en-stale");
  if (state.enrichment && stale) {
    const same = state.enrichment.types.join() === [...state.types].sort((a, b) => RANK[a] - RANK[b]).join();
    stale.hidden = same;
  }
}

// ---------------------------------------------------------------- tabs

function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
    if (focus) tab.focus();
    history.replaceState(null, "", `#${tab.id.slice(4)}`);
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (d) {
        e.preventDefault();
        select(tabs[(i + d + tabs.length) % tabs.length], true);
      }
    });
  });
  const fromHash = tabs.find((t) => `#${t.id.slice(4)}` === location.hash);
  if (fromHash) select(fromHash);
}

// ---------------------------------------------------------------- organisms

async function initOrganisms() {
  try {
    state.index = await loadIndex();
  } catch (err) {
    for (const p of document.querySelectorAll(".coverage")) p.innerHTML = `<span class="error">${esc(err.message)}</span>`;
    return;
  }
  const ids = ["ids-org", "en-org"];
  for (const id of ids) {
    const sel = $(id);
    sel.innerHTML = state.index.organisms.map((o) => `<option value="${o.key}">${esc(o.common)} (${esc(o.name)})</option>`).join("");
    sel.addEventListener("change", () => {
      for (const other of ids) $(other).value = sel.value;
      updateCoverage();
    });
  }
  updateCoverage();
}

function updateCoverage() {
  const o = orgMeta($("ids-org").value);
  const cov = Math.min(1, o.reviewed / o.genes);
  const text = cov >= 0.9
    ? `${nf(o.reviewed)} reviewed entries covering ${pct(cov, 0)} of ${nf(o.genes)} genes (UniProt ${o.release}).`
    : `Reviewed entries cover only ${pct(cov, 0)} of ${nf(o.genes)} genes (UniProt ${o.release}). Other IDs are looked up on UniProt, and the whole-proteome background leans towards well-studied proteins.`;
  for (const p of document.querySelectorAll(".coverage")) {
    p.textContent = text;
    p.classList.toggle("low", cov < 0.9);
  }
}

// ---------------------------------------------------------------- finder: sequences and UniProt IDs

function runSequences() {
  const out = $("seq-results");
  const recs = parseFasta($("seq-input").value);
  if (!recs.length) {
    out.innerHTML = `<p class="error">Paste at least one protein sequence.</p>`;
    return;
  }
  state.sequences = {
    items: recs.map((r) => ({ name: r.name, seq: r.seq, length: r.seq.length, motifs: scan(r.seq), removed: r.removed })),
  };
  renderFinder("sequences");
}

async function runIds() {
  const out = $("ids-results"), btn = $("ids-run");
  const entries = parseIdList($("ids-input").value);
  if (!entries.length) {
    out.innerHTML = `<p class="error">Paste at least one UniProt accession or gene name.</p>`;
    return;
  }
  btn.disabled = true;
  try {
    const key = $("ids-org").value;
    out.innerHTML = `<p class="status">Loading the ${esc(orgMeta(key).common.toLowerCase())} reference table…</p>`;
    const org = await loadOrganism(key);
    out.innerHTML = `<p class="status">Matching ${nf(entries.length)} IDs…</p>`;
    const res = await resolveIds(entries, org, { live: $("ids-live").checked });
    state.ids = { ...res, items: res.proteins, org };
    renderFinder("ids");
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

function listPreview(xs, max = 12) {
  const shown = xs.slice(0, max).map(esc).join(", ");
  return xs.length > max ? `${shown} and ${nf(xs.length - max)} more` : shown;
}

function resolutionNotes(res, org) {
  const notes = [];
  if (res.notFound.length) notes.push(`<li class="warn">${nf(res.notFound.length)} ${res.notFound.length === 1 ? "ID was" : "IDs were"} not found: ${listPreview(res.notFound)}</li>`);
  if (res.liveError) notes.push(`<li class="warn">The UniProt lookup failed (${esc(res.liveError)}), so IDs outside the reference table could not be checked.</li>`);
  if (res.liveCount) notes.push(`<li>${nf(res.liveCount)} ${res.liveCount === 1 ? "protein is" : "proteins are"} not in the reviewed ${esc(org.common.toLowerCase())} table and ${res.liveCount === 1 ? "was" : "were"} looked up on UniProt.</li>`);
  if (res.isoforms) notes.push(`<li>${nf(res.isoforms)} isoform ${res.isoforms === 1 ? "ID was" : "IDs were"} mapped to the canonical entry.</li>`);
  if (res.duplicates) notes.push(`<li>${nf(res.duplicates)} duplicate ${res.duplicates === 1 ? "entry was" : "entries were"} merged.</li>`);
  const other = res.proteins.filter((p) => p.otherOrganism).length;
  if (other) notes.push(`<li class="warn">${nf(other)} ${other === 1 ? "protein belongs" : "proteins belong"} to another organism.</li>`);
  return notes;
}

function renderFinder(mode) {
  const st = state[mode];
  const out = $(mode === "sequences" ? "seq-results" : "ids-results");
  if (!state.types.size) {
    out.innerHTML = `<p class="error">Select at least one motif class.</p>`;
    return;
  }
  const items = st.items;
  const withMotif = items.filter((p) => selectedMotifs(p).length).length;
  const nMotifs = items.reduce((s, p) => s + selectedMotifs(p).length, 0);
  const noun = mode === "sequences" ? "sequences" : "proteins";

  const notes = mode === "ids" ? resolutionNotes(st, st.org) : [];
  if (mode === "sequences") {
    const removed = items.reduce((s, p) => s + p.removed, 0);
    if (removed) notes.push(`<li>Ignored ${nf(removed)} characters that are not amino acid letters.</li>`);
    const dna = items.filter((p) => p.length >= 20 && /^[ACGTUN]+$/.test(p.seq)).length;
    if (dna) notes.push(`<li class="warn">${nf(dna)} ${dna === 1 ? "sequence looks" : "sequences look"} like DNA or RNA. Paste protein sequences.</li>`);
  }
  if (items.length > SHOW_MAX) notes.push(`<li>Showing the first ${nf(SHOW_MAX)} of ${nf(items.length)} ${noun}. The table download holds all of them.</li>`);

  const rows = items.slice(0, SHOW_MAX).map((p, i) => rowHTML(p, i, mode)).join("");
  out.innerHTML = `
    <p class="summary">${nf(withMotif)} of ${nf(items.length)} ${noun} contain at least one motif of the selected classes (${nf(nMotifs)} ${nMotifs === 1 ? "motif" : "motifs"}).</p>
    ${notes.length ? `<ul class="notes">${notes.join("")}</ul>` : ""}
    <div class="actions">
      <button class="btn" data-action="csv">Download table (CSV)</button>
      <button class="btn" data-action="html">Download highlighted sequences (HTML)</button>
    </div>
    ${items.length ? `<div class="table-scroll"><table>
      <thead><tr><th>${mode === "sequences" ? "Sequence" : "Protein"}</th><th class="num">Length</th><th>Motifs (sequence, start, class)</th><th><span class="visually-hidden">Sequence</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>` : ""}`;
}

function rowHTML(p, i, mode) {
  const ms = selectedMotifs(p);
  let head;
  if (mode === "sequences") {
    head = `<div class="protein-name">${esc(p.name)}</div>`;
  } else {
    const gene = p.genes.split(" ")[0];
    const badges = (p.reviewed ? "" : ` <span class="badge">unreviewed</span>`) + (p.otherOrganism ? ` <span class="badge">taxon ${p.otherOrganism}</span>` : "");
    head = `<div class="protein-name">${esc(p.name || p.acc)}</div>
      <div class="protein-meta"><a href="https://www.uniprot.org/uniprotkb/${esc(p.acc)}/entry" target="_blank" rel="noopener">${esc(p.acc)}</a>${gene ? ` ${esc(gene)}` : ""}${badges}</div>`;
  }
  const motifs = ms.length ? `<div class="motifs">${ms.map(chipHTML).join("")}</div>` : `<span class="none">${esc(otherText(p))}</span>`;
  return `<tr data-i="${i}"><td>${head}</td><td class="num">${nf(p.length)}</td><td>${motifs}</td>
    <td><button class="linkish" data-action="seq" aria-expanded="false">Show sequence</button></td></tr>`;
}

function otherText(p) {
  const others = [...new Set(p.motifs.map((m) => m.type))].sort((a, b) => RANK[a] - RANK[b]);
  return others.length ? `None of the selected classes (has ${others.join(", ")})` : "No motifs";
}

function chipHTML(m) {
  const ub = state.ub && hasLysine(m.motif) ? `<span class="ub" title="Contains a lysine: can be inactivated by ubiquitination">Ub</span>` : "";
  return `<span class="motif m-${m.type}" title="${esc(TYPE[m.type].name)} motif, residues ${m.start}–${m.start + 4}"><span class="dot"></span><span class="seq">${m.motif}</span><span class="pos">${m.start}</span><span class="code">${m.type}</span>${ub}</span>`;
}

// residues in lines of 60 and blocks of 10, motif residues highlighted by their best class
function sequenceHTML(seq, motifs) {
  const L = seq.length;
  const cover = new Array(L).fill(null);
  const starts = new Map();
  for (const m of motifs) {
    for (let i = m.start - 1; i < Math.min(L, m.start + 4); i++) {
      if (!cover[i] || RANK[m.type] < RANK[cover[i]]) cover[i] = m.type;
    }
    const s = m.start - 1;
    if (!starts.has(s) || RANK[m.type] < RANK[starts.get(s)]) starts.set(s, m.type);
  }
  let html = "";
  for (let ls = 0; ls < L; ls += 60) {
    let line = `<span class="pos">${ls + 1}</span>`;
    for (let b = ls; b < Math.min(L, ls + 60); b += 10) {
      let block = "", open = null;
      for (let i = b; i < Math.min(L, b + 10); i++) {
        const t = cover[i];
        if (t !== open) {
          if (open) block += "</mark>";
          if (t) block += `<mark class="m m-${t}">`;
          open = t;
        }
        const r = esc(seq[i]);
        block += starts.has(i) ? `<span class="start" data-code="${starts.get(i)}">${r}</span>` : r;
      }
      if (open) block += "</mark>";
      line += `<span class="gap">${block}</span>`;
    }
    html += `<span class="line">${line}</span>`;
  }
  return `<div class="seqview">${html}</div>`;
}

const sameMotifs = (a, b) => a.length === b.length && a.every((m, i) => m.start === b[i].start && m.type === b[i].type);

async function sequenceOf(p) {
  if (p.seq) return p.seq;
  const seq = (await fetchSequences([p.acc])).get(p.acc);
  if (!seq) throw new Error(`UniProt did not return a sequence for ${p.acc}.`);
  return seq;
}

// motifs for display come from the sequence actually shown, in case UniProt updated it
function sequenceBlock(p, seq) {
  const current = scan(seq);
  const changed = !sameMotifs(current, p.motifs);
  const motifs = current.filter((m) => state.types.has(m.type));
  return (changed ? `<p class="notes warn">This sequence changed on UniProt after the reference table was built. Motifs shown here come from the current sequence.</p>` : "")
    + sequenceHTML(seq, motifs)
    + `<p class="seq-legend">Letters above a highlight mark where a motif starts and its class.</p>`;
}

async function toggleSequence(btn, mode) {
  const tr = btn.closest("tr");
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("seq-row")) {
    next.remove();
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "Show sequence";
    return;
  }
  const p = state[mode].items[Number(tr.dataset.i)];
  const row = document.createElement("tr");
  row.className = "seq-row";
  row.innerHTML = `<td colspan="4"><p class="status">Fetching the sequence from UniProt…</p></td>`;
  tr.after(row);
  btn.setAttribute("aria-expanded", "true");
  btn.textContent = "Hide sequence";
  try {
    row.firstElementChild.innerHTML = sequenceBlock(p, await sequenceOf(p));
  } catch (err) {
    row.firstElementChild.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------- downloads

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function finderCsv(mode) {
  const st = state[mode];
  const head = mode === "sequences" ? ["sequence_name", "length"] : ["accession", "status", "gene_names", "protein_name", "length", "source"];
  const rows = [[...head, "motif", "start", "end", "class_code", "class", "contains_K", "note"]];
  for (const p of st.items) {
    const base = mode === "sequences"
      ? [p.name, p.length]
      : [p.acc, p.reviewed ? "reviewed" : "unreviewed", p.genes, p.name, p.length, p.inReference ? `reference table, UniProt ${st.org.release}` : "UniProt lookup"];
    const ms = selectedMotifs(p);
    if (!ms.length) rows.push([...base, "", "", "", "", "", "", otherText(p)]);
    for (const m of ms) rows.push([...base, m.motif, m.start, m.start + 4, m.type, TYPE[m.type].name, hasLysine(m.motif) ? "yes" : "no", ""]);
  }
  if (mode === "ids") for (const id of st.notFound) rows.push([id, "", "", "", "", "", "", "", "", "", "", "", "ID not found"]);
  download(`KFERQ_finder_${mode}_${stamp()}.csv`, toCsv(rows), "text/csv");
}

const exportCss = () => `body{font:15px/1.5 system-ui,sans-serif;color:#1a1c23;max-width:980px;margin:24px auto;padding:0 16px}
h1{font-size:20px}h2{font-size:16px;margin:28px 0 4px}p{margin:0 0 6px;color:#4a4e5c;font-size:13px}
.seqview{font:15px/2.5 ui-monospace,Menlo,monospace;white-space:pre;overflow-x:auto}.line{display:block}
.pos{display:inline-block;width:6ch;text-align:right;margin-right:2ch;color:#696d7c;font-size:13px}.gap{margin-right:1ch}
mark.m{color:inherit;background:color-mix(in srgb,var(--c) 26%,white);box-shadow:inset 0 -3px 0 var(--c)}
.start{position:relative}.start::before{content:attr(data-code);position:absolute;left:0;top:-1.15em;font:600 10px/1 system-ui,sans-serif;color:#4a4e5c}
.legend span{display:inline-block;margin-right:14px}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--c);margin-right:5px}
${TYPES.map((t) => `.m-${t.code}{--c:${getComputedStyle(document.documentElement).getPropertyValue(`--c-${t.code}`).trim()}}`).join("")}`;

async function finderHtml(mode, btn) {
  const st = state[mode];
  const items = st.items.slice(0, HTML_MAX);
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Preparing…";
  try {
    const seqs = mode === "ids" ? await fetchSequences(items.map((p) => p.acc)) : null;
    const sections = items.map((p) => {
      const seq = p.seq || seqs.get(p.acc) || "";
      const title = mode === "sequences" ? esc(p.name) : `${esc(p.acc)} ${esc(p.genes.split(" ")[0] || "")} ${esc(p.name)}`;
      return `<h2>${title}</h2><p>${nf(seq.length)} residues</p>${sequenceHTML(seq, scan(seq).filter((m) => state.types.has(m.type)))}`;
    }).join("");
    const classes = TYPES.filter((t) => state.types.has(t.code));
    const legend = `<p class="legend">${classes.map((t) => `<span class="m-${t.code}"><i></i>${esc(t.name)} (${t.code})</span>`).join("")}</p>`;
    const more = st.items.length > HTML_MAX ? `<p>First ${HTML_MAX} of ${nf(st.items.length)} sequences.</p>` : "";
    const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>KFERQ-like motifs</title><style>${exportCss()}</style></head>
<body><h1>KFERQ-like motifs</h1><p>KFERQ finder, ${new Date().toISOString().slice(0, 10)}. Rules: Kirchner et al. 2019, PLoS Biol, doi:10.1371/journal.pbio.3000301</p>${legend}${more}${sections}</body></html>`;
    download(`KFERQ_finder_${mode}_${stamp()}.html`, doc, "text/html");
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- enrichment

async function runEnrichment() {
  const out = $("en-results"), btn = $("en-run");
  const fail = (msg) => { out.innerHTML = `<p class="error">${esc(msg)}</p>`; };
  if (!state.types.size) return fail("Select at least one motif class.");
  const listEntries = parseIdList($("en-list").value);
  if (!listEntries.length) return fail("Paste your list of proteins.");
  const custom = document.querySelector('input[name="bg"]:checked').value === "custom";
  const bgEntries = custom ? parseIdList($("en-bg").value) : [];
  if (custom && !bgEntries.length) return fail("Paste your background list, or compare against all reviewed proteins.");
  const iterations = Number($("en-iter").value);
  const seed = Math.max(1, Math.floor(Number($("en-seed").value) || 1));
  const live = $("en-live").checked;

  btn.disabled = true;
  try {
    const key = $("en-org").value;
    out.innerHTML = `<p class="status">Loading the ${esc(orgMeta(key).common.toLowerCase())} reference table…</p>`;
    const org = await loadOrganism(key);
    out.innerHTML = `<p class="status">Matching your ${nf(listEntries.length)} IDs…</p>`;
    const listRes = await resolveIds(listEntries, org, { live });
    let bgRes = null;
    if (custom) {
      out.innerHTML = `<p class="status">Matching ${nf(bgEntries.length)} background IDs…</p>`;
      bgRes = await resolveIds(bgEntries, org, { live });
    }

    let list = listRes.proteins.filter((p) => !p.otherOrganism);
    let background, added = 0, excluded = 0;
    if (custom) {
      background = bgRes.proteins.filter((p) => !p.otherOrganism);
      const inBg = new Set(background.map((p) => p.acc));
      for (const p of list) {
        if (!inBg.has(p.acc)) {
          background.push(p);
          inBg.add(p.acc);
          added++;
        }
      }
    } else {
      background = org.proteins;
      const before = list.length;
      list = list.filter((p) => p.inReference);
      excluded = before - list.length;
    }
    if (!list.length) return fail("None of your proteins could be matched to the background.");
    if (list.length >= background.length) return fail("Your list must be smaller than the background.");

    out.innerHTML = `<p class="status">Drawing ${nf(iterations)} random sets…</p>`;
    await nextFrame();
    const types = [...state.types].sort((a, b) => RANK[a] - RANK[b]);
    const flag = (p) => ({ length: p.length, has: p.motifs.some((m) => state.types.has(m.type)) });
    const result = enrichment(list.map(flag), background.map(flag), { iterations, seed });
    state.enrichment = { result, list, background, listRes, bgRes, custom, org, types, added, excluded };
    renderEnrichment();
  } catch (err) {
    fail(err.message);
  } finally {
    btn.disabled = false;
  }
}

function fmtSci(p) {
  if (p === 0) return "< 10<sup>−300</sup>";
  const e = Math.floor(Math.log10(p));
  const m = p / 10 ** e;
  return `${m.toFixed(1)} × 10<sup>−${-e}</sup>`;
}

function fmtP(p, iterations) {
  if (iterations && p <= 1 / (iterations + 1) + 1e-12) return `< ${1 / iterations}`;
  if (p >= 0.995) return "1";
  if (p >= 0.1) return p.toFixed(2);
  if (p >= 0.001) return p.toPrecision(2);
  return fmtSci(p);
}

function verdict(r) {
  const a = 0.05;
  const re = r.random.pEnrich < a, me = r.matched.pEnrich < a;
  const rd = r.random.pDeplete < a, md = r.matched.pDeplete < a;
  const lengths = `median length ${nf(r.medianLength.list)} aa in your list and ${nf(r.medianLength.background)} aa in the background`;
  if (re && me) return "At p < 0.05, enriched against both random and length-matched sets.";
  if (re) return `At p < 0.05, enriched against random sets but not once protein length is matched, so length accounts for the difference (${lengths}).`;
  if (me) return `At p < 0.05, enriched only once protein length is matched (${lengths}).`;
  if (rd && md) return "At p < 0.05, depleted against both random and length-matched sets.";
  if (rd) return `At p < 0.05, depleted against random sets but not once protein length is matched, so length accounts for the difference (${lengths}).`;
  if (md) return `At p < 0.05, depleted only once protein length is matched (${lengths}).`;
  return "No enrichment or depletion at p < 0.05.";
}

// nice tick step for a span in fraction units
function tickStep(span) {
  const steps = [0.001, 0.0025, 0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25];
  return steps.find((s) => span / s <= 6) || 0.25;
}

function histogramSVG(counts, n, domain, obsFrac) {
  const W = 420, H = 190, ml = 8, mr = 8, mt = 34, mb = 30;
  const pw = W - ml - mr, ph = H - mt - mb;
  const x = (f) => ml + ((f - domain[0]) / (domain[1] - domain[0])) * pw;

  let min = Infinity, max = -Infinity;
  for (const c of counts) {
    if (c < min) min = c;
    if (c > max) max = c;
  }
  const width = Math.max(1, Math.ceil((max - min + 1) / 50)); // bin width in proteins
  const nb = Math.floor((max - min) / width) + 1;
  const bins = new Int32Array(nb);
  for (const c of counts) bins[Math.floor((c - min) / width)]++;
  const top = Math.max(...bins);

  let bars = "";
  for (let b = 0; b < nb; b++) {
    const c0 = min + b * width, c1 = c0 + width;
    const x0 = x(c0 / n), x1 = x(c1 / n);
    const bw = Math.max(1, x1 - x0 - (x1 - x0 > 4 ? 2 : 0));
    const h = (bins[b] / top) * ph;
    const range = width === 1 ? pct(c0 / n) : `${pct(c0 / n)}–${pct((c1 - 1) / n)}`;
    const tip = `${range} of proteins with a motif: ${nf(bins[b])} of ${nf(counts.length)} sets`;
    bars += `<rect class="hit" x="${x0.toFixed(1)}" y="${mt}" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${ph}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (h > 0) {
      const r = Math.min(4, bw / 2, h);
      const y = mt + ph - h, xb = x0, xe = x0 + bw, yb = mt + ph;
      bars += `<path class="bar" d="M${xb.toFixed(1)},${yb} V${(y + r).toFixed(1)} Q${xb.toFixed(1)},${y.toFixed(1)} ${(xb + r).toFixed(1)},${y.toFixed(1)} H${(xe - r).toFixed(1)} Q${xe.toFixed(1)},${y.toFixed(1)} ${xe.toFixed(1)},${(y + r).toFixed(1)} V${yb} Z"/>`;
    }
  }

  const step = tickStep(domain[1] - domain[0]);
  let ticks = "";
  for (let v = Math.ceil(domain[0] / step) * step; v <= domain[1] + 1e-9; v += step) {
    const decimals = step < 0.01 ? 1 : 0;
    ticks += `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${mt + ph}" y2="${mt + ph + 4}"/><text x="${x(v).toFixed(1)}" y="${H - 8}" text-anchor="middle">${(100 * v).toFixed(decimals)}%</text>`;
  }
  const ox = x(obsFrac);
  const anchor = ox > W * 0.62 ? "end" : "start";
  const lx = anchor === "end" ? ox - 6 : ox + 6;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of random sets, with your list at ${pct(obsFrac)}">
    ${bars}
    <g class="axis"><line x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/>${ticks}</g>
    <g class="obs"><line x1="${ox.toFixed(1)}" x2="${ox.toFixed(1)}" y1="${mt - 18}" y2="${mt + ph}"/><text x="${lx.toFixed(1)}" y="${mt - 8}" text-anchor="${anchor}">Your list ${pct(obsFrac)}</text></g>
  </svg>`;
}

function topClass(p, types) {
  const present = new Set(p.motifs.map((m) => m.type));
  return types.find((t) => present.has(t)) || "none";
}

function renderEnrichment() {
  const E = state.enrichment, r = E.result;
  const names = E.types.map((c) => TYPE[c].short);
  const classPhrase = names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
  const bgText = E.custom
    ? `${nf(r.N)} proteins from your background list`
    : `all ${nf(r.N)} reviewed ${E.org.common.toLowerCase()} proteins (UniProt ${E.org.release})`;

  // notes
  const notes = resolutionNotes(E.listRes, E.org).map((n) => n.replace(/(<li[^>]*>)/, "$1Your list: "));
  if (E.bgRes) notes.push(...resolutionNotes(E.bgRes, E.org).map((n) => n.replace(/(<li[^>]*>)/, "$1Background: ")));
  if (E.excluded) notes.push(`<li class="warn">${nf(E.excluded)} of your proteins are not in the reviewed reference table and were left out of the test.</li>`);
  if (E.added) notes.push(`<li>${nf(E.added)} of your proteins were missing from the background list and were added to it.</li>`);
  if (r.bins === 1) notes.push(`<li class="warn">The background is too small to split by length (under 50 proteins), so length-matched sets are the same as random sets.</li>`);
  if (r.replacementBins) notes.push(`<li class="warn">In ${r.replacementBins} length ${r.replacementBins === 1 ? "bin" : "bins"} your list has more proteins than the background, so ${r.replacementBins === 1 ? "that bin was" : "those bins were"} drawn with replacement.</li>`);

  // all selected classes, counted once under their best class
  const breakdown = [...E.types, "none"].map((t) => {
    const nl = E.list.filter((p) => topClass(p, E.types) === t).length;
    const nb = E.background.filter((p) => topClass(p, E.types) === t).length;
    const label = t === "none" ? "None of the selected classes" : `<span class="swatch m-${t}"></span>${esc(TYPE[t].name)}`;
    return `<tr><td>${label}</td><td class="num">${pct(nl / E.list.length)} (${nf(nl)})</td><td class="num">${pct(nb / E.background.length)} (${nf(nb)})</td></tr>`;
  }).join("");

  let lo = r.k, hi = r.k;
  for (const c of r.random.counts) { if (c < lo) lo = c; if (c > hi) hi = c; }
  for (const c of r.matched.counts) { if (c < lo) lo = c; if (c > hi) hi = c; }
  const pad = Math.max(1, (hi - lo) * 0.08);
  const domain = [Math.max(0, (lo - pad) / r.n), Math.min(1, (hi + pad + 1) / r.n)];

  const row = (label, a, b) => `<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td></tr>`;
  $("en-results").innerHTML = `
    <p class="notes warn" id="en-stale" hidden>The motif classes changed after this run. Run the enrichment again to update these results.</p>
    <p class="headline">${pct(r.obsFrac)} of your ${nf(r.n)} proteins carry at least one ${esc(classPhrase)} motif, against ${pct(r.bgFrac)} of the background.</p>
    <p class="verdict">${esc(verdict(r))}</p>
    <div class="table-scroll"><table class="compare">
      <thead><tr><th></th><th>Random sets</th><th>Length-matched sets</th></tr></thead>
      <tbody>
        ${row("Expected share (mean of sets)", pct(r.random.meanFrac), pct(r.matched.meanFrac))}
        ${row("Middle 95% of sets", `${pct(r.random.loFrac)}–${pct(r.random.hiFrac)}`, `${pct(r.matched.loFrac)}–${pct(r.matched.hiFrac)}`)}
        ${row("Fold enrichment", r.random.fold.toFixed(2), r.matched.fold.toFixed(2))}
        ${row("p, enrichment", fmtP(r.random.pEnrich, r.iterations), fmtP(r.matched.pEnrich, r.iterations))}
        ${row("p, depletion", fmtP(r.random.pDeplete, r.iterations), fmtP(r.matched.pDeplete, r.iterations))}
        ${row("Exact hypergeometric p, enrichment", fmtP(r.random.hyper.pEnrich), "Not applicable")}
      </tbody>
    </table></div>
    <div class="charts">
      <figure class="chart"><h4>Random sets</h4><p>${nf(r.iterations)} sets of ${nf(r.n)} proteins drawn from the background</p>${histogramSVG(r.random.counts, r.n, domain, r.obsFrac)}</figure>
      <figure class="chart"><h4>Length-matched sets</h4><p>Same, drawn to match the length profile of your list (${r.bins} length ${r.bins === 1 ? "bin" : "bins"})</p>${histogramSVG(r.matched.counts, r.n, domain, r.obsFrac)}</figure>
    </div>
    ${notes.length ? `<ul class="notes">${notes.join("")}</ul>` : ""}
    <dl class="facts">
      <dt>Your list</dt><dd>${nf(r.n)} proteins, median length ${nf(r.medianLength.list)} aa</dd>
      <dt>Background</dt><dd>${esc(bgText)}, median length ${nf(r.medianLength.background)} aa</dd>
      <dt>Motif classes</dt><dd>${E.types.map((t) => esc(TYPE[t].name)).join(", ")}</dd>
      <dt>Random sets</dt><dd>${nf(r.iterations)}, seed ${r.seed}</dd>
    </dl>
    <h3 class="section">Proteins by best motif class</h3>
    <p class="hint">Each protein is counted once, under its best-characterised class.</p>
    <div class="table-scroll"><table class="compare">
      <thead><tr><th>Class</th><th class="num">Your list</th><th class="num">Background</th></tr></thead>
      <tbody>${breakdown}</tbody>
    </table></div>
    <div class="actions">
      <button class="btn" data-action="en-summary">Download summary (CSV)</button>
      <button class="btn" data-action="en-proteins">Download your proteins (CSV)</button>
    </div>`;
}

function enrichmentSummaryCsv() {
  const E = state.enrichment, r = E.result;
  const rows = [
    ["measure", "random_sets", "length_matched_sets"],
    ["list_proteins", r.n, r.n],
    ["list_with_motif", r.k, r.k],
    ["list_share", r.obsFrac, r.obsFrac],
    ["background_proteins", r.N, r.N],
    ["background_with_motif", r.K, r.K],
    ["background_share", r.bgFrac, r.bgFrac],
    ["expected_share_mean", r.random.meanFrac, r.matched.meanFrac],
    ["expected_share_sd", r.random.sdFrac, r.matched.sdFrac],
    ["expected_share_2.5pct", r.random.loFrac, r.matched.loFrac],
    ["expected_share_97.5pct", r.random.hiFrac, r.matched.hiFrac],
    ["fold_enrichment", r.random.fold, r.matched.fold],
    ["z_score", r.random.z, r.matched.z],
    ["p_enrichment_empirical", r.random.pEnrich, r.matched.pEnrich],
    ["p_depletion_empirical", r.random.pDeplete, r.matched.pDeplete],
    ["p_enrichment_hypergeometric", r.random.hyper.pEnrich, ""],
    ["p_depletion_hypergeometric", r.random.hyper.pDeplete, ""],
    ["median_length_list", r.medianLength.list, r.medianLength.list],
    ["median_length_background", r.medianLength.background, r.medianLength.background],
    ["iterations", r.iterations, r.iterations],
    ["seed", r.seed, r.seed],
    ["length_bins", "", r.bins],
    ["motif_classes", E.types.join(" "), E.types.join(" ")],
    ["background", E.custom ? "custom list" : `reviewed proteome ${E.org.proteome}`, ""],
    ["organism", E.org.name, ""],
    ["uniprot_release", E.org.release, ""],
  ];
  download(`KFERQ_finder_enrichment_${stamp()}.csv`, toCsv(rows), "text/csv");
}

function enrichmentProteinsCsv() {
  const E = state.enrichment;
  const tested = new Set(E.list.map((p) => p.acc));
  const rows = [["accession", "status", "gene_names", "protein_name", "length", "has_selected_motif", "best_class", "selected_motifs", "in_test"]];
  for (const p of E.listRes.proteins) {
    const ms = p.motifs.filter((m) => E.types.includes(m.type));
    const why = tested.has(p.acc) ? "yes" : p.otherOrganism ? "no: other organism" : "no: not in reviewed reference table";
    rows.push([p.acc, p.reviewed ? "reviewed" : "unreviewed", p.genes, p.name, p.length, ms.length ? "yes" : "no", topClass(p, E.types),
      ms.map((m) => `${m.motif}@${m.start}:${m.type}`).join(" "), why]);
  }
  for (const id of E.listRes.notFound) rows.push([id, "", "", "", "", "", "", "", "no: ID not found"]);
  download(`KFERQ_finder_enrichment_proteins_${stamp()}.csv`, toCsv(rows), "text/csv");
}

// ---------------------------------------------------------------- examples and uploads

const EXAMPLE_FASTA = `>sp|P61823|RNAS1_BOVIN Ribonuclease A, mature chain (residues 27-150)
KETAAAKFERQHMDSSTSAASSSNYCNQMMKSRNLTKDRCKPVNTFVHESLADVQAVCSQKNVACKNGQTNCYQSYSTMSITDCRETGSSKYPNCAYKTTQANKHIIVACEGNPYVPVHFDASV
>sp|P37840|SYUA_HUMAN Alpha-synuclein
MDVFMKGLSKAKEGVVAAAEKTKQGVAEAAGKTKEGVLYVGSKTKEGVVHGVATVAEKTKEQVTNVGGAVVTGVTAVAQKTVEGAGSIAAATGFVKKDQLGKNEEGAPQEGILEDMPVDPDNEAYEMPSEEGYQDYEPEA`;

const EXAMPLE_IDS = "SNCA\nGAPDH\nPARK7\nLRRK2\nMEF2D\nHK2\nRND3\nP10636-8\nP04406";

function setOrganism(key) {
  for (const id of ["ids-org", "en-org"]) $(id).value = key;
  updateCoverage();
}

async function enrichmentExample() {
  setOrganism("human");
  document.querySelector('input[name="bg"][value="proteome"]').checked = true;
  syncBackgroundInputs();
  const org = await loadOrganism("human");
  const longest = [...org.proteins].sort((a, b) => b.length - a.length).slice(0, 300);
  $("en-list").value = longest.map((p) => p.acc).join("\n");
  await runEnrichment();
  $("en-results").insertAdjacentHTML("afterbegin", `<p class="hint">Example: the 300 longest human proteins. Compare the two columns to see how much protein length alone explains.</p>`);
}

function firstColumn(text, filename) {
  if (!/\.(csv|tsv)$/i.test(filename)) return text;
  return text.split(/\r?\n/).map((l) => l.split(/[,\t]/)[0].replace(/^["']+|["']+$/g, "")).join("\n");
}

function wireUpload(inputId, textareaId) {
  $(inputId).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    $(textareaId).value = firstColumn(await file.text(), file.name);
    e.target.value = "";
  });
}

function syncBackgroundInputs() {
  const custom = document.querySelector('input[name="bg"]:checked').value === "custom";
  $("en-bg").disabled = !custom;
  $("en-bg-file").disabled = !custom;
  $("en-bg-upload").setAttribute("aria-disabled", String(!custom));
}

// ---------------------------------------------------------------- wiring

function initTooltip() {
  const tip = $("tooltip");
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
  });
  document.addEventListener("mousemove", (e) => {
    if (tip.hidden) return;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - w - 8)}px`;
    tip.style.top = `${e.clientY + 16}px`;
  });
  document.addEventListener("mouseout", (e) => {
    if (e.target.closest && e.target.closest("[data-tip]")) tip.hidden = true;
  });
}

function init() {
  initClassControls();
  initTabs();
  initTooltip();
  initOrganisms();

  $("seq-run").addEventListener("click", runSequences);
  $("seq-example").addEventListener("click", () => {
    $("seq-input").value = EXAMPLE_FASTA;
    runSequences();
  });
  $("ids-run").addEventListener("click", runIds);
  $("ids-example").addEventListener("click", () => {
    setOrganism("human");
    $("ids-input").value = EXAMPLE_IDS;
    runIds();
  });
  $("en-run").addEventListener("click", runEnrichment);
  $("en-example").addEventListener("click", enrichmentExample);
  for (const r of document.querySelectorAll('input[name="bg"]')) r.addEventListener("change", syncBackgroundInputs);
  wireUpload("seq-file", "seq-input");
  wireUpload("ids-file", "ids-input");
  wireUpload("en-list-file", "en-list");
  wireUpload("en-bg-file", "en-bg");

  for (const [id, mode] of [["seq-results", "sequences"], ["ids-results", "ids"]]) {
    $(id).addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "seq") toggleSequence(btn, mode);
      if (btn.dataset.action === "csv") finderCsv(mode);
      if (btn.dataset.action === "html") finderHtml(mode, btn);
    });
  }
  $("en-results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "en-summary") enrichmentSummaryCsv();
    if (btn.dataset.action === "en-proteins") enrichmentProteinsCsv();
  });
}

init();
