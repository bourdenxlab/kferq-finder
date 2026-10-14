// Yes/no presence of motif classes per protein, the combinations they form, and two figures of them.
//
// Only the three single-modification classes are summarised: canonical (C), acetylation-activated (K)
// and phosphorylation-activated (P). Motifs needing both acetylation and phosphorylation (KP) are
// theoretically possible but lack experimental evidence, so they are left out, as are asparagine motifs.
export const SUMMARY_CLASSES = ["C", "K", "P"];

const LABEL = { C: "Canonical", K: "Acetylation", P: "Phosphorylation" };
const NAME = { C: "Canonical", K: "Acetylation-activated", P: "Phosphorylation-activated" };
export const classLabel = (s) => LABEL[s];

// Class order: canonical first, then phosphorylation- or acetylation-activated as the user chooses
export function rankOrder(second = "P") {
  return second === "K" ? ["C", "K", "P", "KP", "N", "NP"] : ["C", "P", "K", "KP", "N", "NP"];
}

// The summarised classes among those selected, in rank order
export function summarySets(selected, second) {
  return rankOrder(second).filter((t) => SUMMARY_CLASSES.includes(t) && selected.includes(t));
}

export function presence(protein, sets) {
  const types = new Set(protein.motifs.map((m) => m.type));
  return Object.fromEntries(sets.map((s) => [s, types.has(s)]));
}

// Best class of a protein among the given classes, in rank order ("none" if it has none)
export function bestClass(protein, types, second) {
  const present = new Set(protein.motifs.map((m) => m.type));
  return rankOrder(second).find((t) => types.includes(t) && present.has(t)) || "none";
}

// All 2^k combinations of the classes, in rank order: everything with the first class
// (with the second, ...), then everything without it. Each protein falls in exactly one.
export function combinationPatterns(sets) {
  if (!sets.length) return [[]];
  const [first, ...rest] = sets;
  const tail = combinationPatterns(rest);
  return [...tail.map((p) => [first, ...p]), ...tail];
}

export function combinations(proteins, sets) {
  const counts = new Map(combinationPatterns(sets).map((p) => [p.join("+"), 0]));
  for (const protein of proteins) {
    const has = presence(protein, sets);
    const key = sets.filter((s) => has[s]).join("+");
    counts.set(key, counts.get(key) + 1);
  }
  return combinationPatterns(sets).map((p) => ({ sets: p, n: counts.get(p.join("+")) }));
}

export const combinationName = (combo) => (combo.length ? combo.map((s) => LABEL[s]).join(" + ") : "No motif of these classes");

// ---------------------------------------------------------------- figures (SVG strings)
// style: { colors: {C, K, P}, ink, ink2, muted, absent, font }. With exportable: true the SVG gets a
// namespace, a fixed size and a white background, so it stands alone as a file.

const nf = (x) => x.toLocaleString("en");
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function topRoundedBar(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function wrap(body, W, H, label, style, exportable) {
  const head = exportable
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${escAttr(style.font)}"><rect width="${W}" height="${H}" fill="#ffffff"/>`
    : `<svg viewBox="0 0 ${W} ${H}" style="max-width:${W}px" role="img" aria-label="${escAttr(label)}" font-family="${escAttr(style.font)}">`;
  return `${head}${body}</svg>`;
}

// combos: in display order. setTotals: proteins carrying each class. total: all proteins.
export function upsetSVG(combos, sets, setTotals, total, style, { exportable = false } = {}) {
  const colW = 52, left = 268, top = 26, barH = 190, rowH = 32, gap = 18;
  const matrixTop = top + barH + gap;
  const W = left + combos.length * colW + 8, H = matrixTop + sets.length * rowH + 6;
  const maxN = Math.max(1, ...combos.map((c) => c.n));
  const maxSet = Math.max(1, ...sets.map((s) => setTotals[s]));
  let out = "";

  sets.forEach((s, i) => {
    const y = matrixTop + i * rowH;
    if (i % 2 === 0) out += `<rect x="${left}" y="${y}" width="${combos.length * colW}" height="${rowH}" fill="#f5f6f8"/>`;
    const w = Math.max(2, (setTotals[s] / maxSet) * 84);
    out += `<rect class="hit" x="0" y="${y}" width="${left}" height="${rowH}" fill="transparent" data-tip="${escAttr(`${NAME[s]}: ${nf(setTotals[s])} proteins (${pct(setTotals[s] / total)})`)}"/>`;
    out += `<path d="M${92 - w},${y + 8} H89 Q92,${y + 8} 92,${y + 11} V${y + rowH - 11} Q92,${y + rowH - 8} 89,${y + rowH - 8} H${92 - w} Z" fill="${style.colors[s]}"/>`;
    out += `<text x="102" y="${y + rowH / 2 + 5}" font-size="14" fill="${style.ink}">${LABEL[s]}</text>`;
    out += `<text x="${left - 10}" y="${y + rowH / 2 + 5}" font-size="13" fill="${style.muted}" text-anchor="end">${nf(setTotals[s])}</text>`;
  });

  combos.forEach((c, j) => {
    const cx = left + j * colW + colW / 2;
    const h = (c.n / maxN) * barH;
    const by = top + barH - h;
    out += `<rect class="hit" x="${cx - colW / 2}" y="${top - 20}" width="${colW}" height="${H - top + 20}" fill="transparent" data-tip="${escAttr(`${combinationName(c.sets)}: ${nf(c.n)} proteins (${pct(c.n / total)})`)}"/>`;
    if (h > 0) out += `<path d="${topRoundedBar(cx - 15, by, 30, h, 4)}" fill="${c.sets.length ? style.ink2 : "#b8bbc5"}"/>`;
    out += `<text x="${cx}" y="${by - 6}" font-size="13" fill="${style.ink}" text-anchor="middle">${nf(c.n)}</text>`;
    const rows = sets.map((s, i) => (c.sets.includes(s) ? i : -1)).filter((i) => i >= 0);
    if (rows.length > 1) {
      const y1 = matrixTop + rows[0] * rowH + rowH / 2, y2 = matrixTop + rows[rows.length - 1] * rowH + rowH / 2;
      out += `<line x1="${cx}" x2="${cx}" y1="${y1}" y2="${y2}" stroke="${style.ink2}" stroke-width="2"/>`;
    }
    sets.forEach((s, i) => {
      const on = c.sets.includes(s);
      out += `<circle cx="${cx}" cy="${matrixTop + i * rowH + rowH / 2}" r="8" fill="${on ? style.colors[s] : style.absent}" stroke="#ffffff" stroke-width="2"/>`;
    });
  });
  out += `<line x1="${left}" x2="${W - 8}" y1="${top + barH}" y2="${top + barH}" stroke="#c3c5cc"/>`;
  return wrap(out, W, H, "UpSet plot of motif class combinations", style, exportable);
}

// One band per combination, height proportional to its proteins, classes packed to the left
export function bandsSVG(combos, sets, total, style, { exportable = false } = {}) {
  const x0 = 44, colW = 58, top = 10, plotH = 400;
  const W = x0 + sets.length * colW + 110, H = top + plotH + 24 + sets.length * 18 + 8;
  const k = plotH / Math.max(1, total);
  let y = top, out = "";
  out += `<text transform="translate(16 ${top + plotH / 2}) rotate(-90)" font-size="14" fill="${style.ink2}" text-anchor="middle">Proteins</text>`;
  for (const c of combos) {
    const h = c.n * k;
    if (h <= 0) continue;
    out += `<rect class="hit" x="${x0}" y="${y}" width="${W - x0}" height="${h}" fill="transparent" data-tip="${escAttr(`${combinationName(c.sets)}: ${nf(c.n)} proteins (${pct(c.n / total)})`)}"/>`;
    for (let col = 0; col < sets.length; col++) {
      const s = c.sets[col];
      out += `<rect x="${x0 + col * colW}" y="${y}" width="${colW - 2}" height="${Math.max(0.5, h - 2)}" fill="${s ? style.colors[s] : style.absent}"/>`;
    }
    if (h >= 15) {
      const first = c.sets[0];
      const ink = first === "C" || !first ? style.ink : "#ffffff"; // white on green and blue, ink on yellow and grey
      out += `<text x="${x0 + colW / 2 - 1}" y="${y + h / 2 + 4}" font-size="13" font-weight="600" fill="${ink}" text-anchor="middle">${nf(c.n)}</text>`;
      out += `<text x="${x0 + sets.length * colW + 8}" y="${y + h / 2 + 4}" font-size="12" fill="${style.muted}">${c.sets.length ? c.sets.join(" + ") : "none"}</text>`;
    } else if (h >= 8) {
      // too thin for a label inside: put the count beside the band
      out += `<text x="${x0 + sets.length * colW + 8}" y="${y + h / 2 + 4}" font-size="11" fill="${style.muted}">${c.sets.length ? c.sets.join(" + ") : "none"}: ${nf(c.n)}</text>`;
    }
    y += h;
  }
  const ly = top + plotH + 24;
  sets.forEach((s, i) => {
    out += `<rect x="${x0}" y="${ly + i * 18 - 10}" width="12" height="12" rx="2" fill="${style.colors[s]}"/><text x="${x0 + 18}" y="${ly + i * 18}" font-size="13" fill="${style.ink}">${NAME[s]} (${s})</text>`;
  });
  return wrap(out, W, H, "Stacked bands of motif class combinations", style, exportable);
}
