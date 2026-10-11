// KFERQ-like motif scanner. Used by the website, the data build script and the tests.
//
// Rules (Kirchner et al. 2019, PLoS Biol, doi:10.1371/journal.pbio.3000301):
// a pentapeptide is a motif when one end residue is Q and the other four residues are
// 1-2 basic (K, R), 1-2 hydrophobic (I, L, V, F) and exactly one acidic (D, E).
// Phosphorylation-activated motifs carry S, T or Y in place of the acidic residue,
// acetylation-activated motifs carry K in place of the flanking Q, and the "advanced"
// asparagine motifs carry N in place of Q.

export const TYPES = [
  { code: "C", name: "Canonical", short: "canonical" },
  { code: "P", name: "Phosphorylation-activated", short: "phospho" },
  { code: "K", name: "Acetylation-activated", short: "acetyl" },
  { code: "KP", name: "Acetylation + phosphorylation", short: "acetyl + phospho" },
  { code: "N", name: "Asparagine", short: "asparagine" },
  { code: "NP", name: "Asparagine + phosphorylation", short: "asparagine + phospho" },
];
export const DEFAULT_TYPES = ["C", "P", "K"];
// When a pentapeptide qualifies for several classes, the best-characterised one wins.
export const RANK = { C: 0, P: 1, K: 2, KP: 3, N: 4, NP: 5 };

// residue classes: 1 basic, 2 hydrophobic, 3 acidic, 4 phosphorylatable
const CLS = new Uint8Array(128);
for (const c of "KR") CLS[c.charCodeAt(0)] = 1;
for (const c of "ILVF") CLS[c.charCodeAt(0)] = 2;
for (const c of "DE") CLS[c.charCodeAt(0)] = 3;
for (const c of "STY") CLS[c.charCodeAt(0)] = 4;

// end residue -> [type with acidic core, type with phosphorylatable core]
const END = { 81: ["C", "P"], 75: ["K", "KP"], 78: ["N", "NP"] }; // Q, K, N

// Checks the four residues s[i..i+3]: 0 = not a motif core, 1 = acidic core, 2 = S/T/Y core
function core(s, i) {
  let b = 0, h = 0, a = 0, p = 0;
  for (let j = i; j < i + 4; j++) {
    const c = CLS[s.charCodeAt(j)];
    if (c === 1) b++;
    else if (c === 2) h++;
    else if (c === 3) a++;
    else if (c === 4) p++;
    else return 0;
  }
  if (b < 1 || b > 2 || h < 1 || h > 2 || a + p !== 1) return 0;
  return a ? 1 : 2;
}

// Type of the pentapeptide starting at s[i], or null
function typeAt(s, i) {
  let best = null;
  const left = END[s.charCodeAt(i)];
  if (left) {
    const c = core(s, i + 1);
    if (c) best = left[c - 1];
  }
  const right = END[s.charCodeAt(i + 4)];
  if (right) {
    const c = core(s, i);
    if (c) {
      const t = right[c - 1];
      if (best === null || RANK[t] < RANK[best]) best = t;
    }
  }
  return best;
}

export function classify(penta) {
  return penta.length === 5 ? typeAt(penta, 0) : null;
}

// All motifs in an upper-case sequence, as { start (1-based), motif, type }
export function scan(seq) {
  const out = [];
  for (let i = 0; i + 5 <= seq.length; i++) {
    const t = typeAt(seq, i);
    if (t) out.push({ start: i + 1, motif: seq.slice(i, i + 5), type: t });
  }
  return out;
}

// Motifs containing a lysine can be inactivated by ubiquitination of that lysine
export function hasLysine(motif) {
  return motif.includes("K");
}

// FASTA or plain text -> [{ name, seq, removed }]. Without headers, blank lines separate sequences.
export function parseFasta(text) {
  const clean = (raw) => {
    const up = raw.toUpperCase();
    const seq = up.replace(/[^A-Z]/g, "");
    const removed = up.replace(/[\sA-Z0-9*]/g, "").length; // characters other than residues, spaces, numbers, stop
    return { seq, removed };
  };
  const src = text.replace(/\r\n?/g, "\n").trim();
  if (!src) return [];
  if (!src.includes(">")) {
    return src
      .split(/\n\s*\n/)
      .map((block, i) => ({ name: `Sequence ${i + 1}`, ...clean(block) }))
      .filter((r) => r.seq.length > 0);
  }
  return src
    .split(/^\s*>/m)
    .filter((block) => block.trim())
    .map((block, i) => {
      const nl = block.indexOf("\n");
      const header = (nl === -1 ? block : block.slice(0, nl)).trim();
      const body = nl === -1 ? "" : block.slice(nl + 1);
      return { name: header || `Sequence ${i + 1}`, ...clean(body) };
    });
}
