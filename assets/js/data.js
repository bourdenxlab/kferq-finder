// Precomputed proteome tables (data/*.json) and live UniProt lookups for everything else.
import { scan } from "./kferq.js";

const DATA = new URL("../../data/", import.meta.url);
const UNIPROT = "https://rest.uniprot.org/uniprotkb";
const FIELDS = "accession,reviewed,gene_primary,gene_names,protein_name,length,organism_id,sequence";

// UniProtKB accession format (uniprot.org/help/accession_numbers)
const ACC = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

export async function loadIndex() {
  const r = await fetch(new URL("index.json", DATA));
  if (!r.ok) throw new Error("Could not load the organism list (data/index.json).");
  return r.json();
}

function parseMotifs(str) {
  if (!str) return [];
  return str.split(";").map((m) => {
    const [start, motif, type] = m.split(":");
    return { start: Number(start), motif, type };
  });
}

const organisms = new Map();

export function loadOrganism(key) {
  if (!organisms.has(key)) {
    const p = fetch(new URL(`${key}.json`, DATA))
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load the ${key} proteome table.`);
        return r.json();
      })
      .then((d) => {
        const proteins = d.rows.map(([acc, genes, name, length, motifs]) => ({
          acc, genes, name, length, motifs: parseMotifs(motifs), reviewed: true, inReference: true,
        }));
        const byAcc = new Map(proteins.map((p) => [p.acc, p]));
        // primary gene names take precedence over synonyms
        const byGene = new Map();
        for (const p of proteins) {
          const g = p.genes.split(" ")[0];
          if (g && !byGene.has(g.toUpperCase())) byGene.set(g.toUpperCase(), p);
        }
        for (const p of proteins) {
          for (const g of p.genes.split(" ").slice(1)) {
            if (!byGene.has(g.toUpperCase())) byGene.set(g.toUpperCase(), p);
          }
        }
        return { ...d, proteins, byAcc, byGene };
      });
    p.catch(() => organisms.delete(key));
    organisms.set(key, p);
  }
  return organisms.get(key);
}

// Text -> list of entries. Entries are separated by new lines, commas, tabs or spaces;
// ";" separates alternatives within one entry (e.g. MaxQuant protein groups).
export function parseIdList(text) {
  return text
    .split(/[\n\r,\t ]+/)
    .map((t) => t.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

// One identifier -> { acc } or { gene }, with isoform suffixes collapsed to the canonical entry
function normalise(token) {
  let t = token.trim();
  if (t.includes("|")) t = t.split("|").find((part) => ACC.test(part.replace(/-\d+$/, ""))) || t;
  const up = t.toUpperCase();
  const iso = up.match(/^(.+)-\d+$/);
  if (iso && ACC.test(iso[1])) return { acc: iso[1], isoform: true };
  if (ACC.test(up)) return { acc: up };
  return { gene: up };
}

function proteinFromRow(row, taxon) {
  const [acc, reviewed, primary, names, pname, length, orgId, seq] = row;
  const primaries = primary ? primary.split(/;\s*/) : [];
  const others = names ? names.split(/[\s;]+/).filter((g) => g && !primaries.includes(g)) : [];
  return {
    acc,
    genes: [...primaries, ...others].join(" "),
    name: cleanName(pname),
    length: Number(length),
    motifs: scan(seq),
    seq,
    reviewed: reviewed === "reviewed",
    inReference: false,
    otherOrganism: taxon && Number(orgId) !== taxon ? Number(orgId) : null,
  };
}

export function cleanName(pname) {
  return (pname || "").split(/ \(| \[/)[0];
}

async function uniprotTsv(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`UniProt returned ${r.status} for a lookup.`);
  const rows = (await r.text()).trim().split("\n").slice(1);
  return rows.filter(Boolean).map((l) => l.split("\t"));
}

async function fetchByAccession(accs, taxon) {
  const out = new Map();
  for (let i = 0; i < accs.length; i += 100) {
    const batch = accs.slice(i, i + 100);
    const rows = await uniprotTsv(`${UNIPROT}/accessions?accessions=${batch.join(",")}&fields=${FIELDS}&format=tsv`);
    for (const row of rows) out.set(row[0], proteinFromRow(row, taxon));
  }
  return out;
}

async function fetchByGene(genes, taxon) {
  const out = new Map();
  for (let i = 0; i < genes.length; i += 25) {
    const batch = genes.slice(i, i + 25);
    const q = `(${batch.map((g) => `gene_exact:"${g}"`).join(" OR ")}) AND organism_id:${taxon}`;
    const rows = await uniprotTsv(`${UNIPROT}/search?query=${encodeURIComponent(q)}&fields=${FIELDS}&format=tsv&size=500`);
    // rows come sorted by annotation score, so reviewed entries come first;
    // a primary-name match beats a synonym match
    for (const pass of ["primary", "any"]) {
      for (const row of rows) {
        const primary = (row[2] || "").toUpperCase().split(/;\s*/);
        const all = (row[3] || "").toUpperCase().split(/[\s;]+/);
        for (const g of batch) {
          if (out.has(g)) continue;
          if ((pass === "primary" ? primary : all).includes(g)) out.set(g, proteinFromRow(row, taxon));
        }
      }
    }
  }
  return out;
}

// entries (from parseIdList) -> unique proteins in input order, plus what could not be matched
export async function resolveIds(entries, org, { live = true } = {}) {
  const resolved = new Array(entries.length).fill(null);
  const missingAcc = new Set(), missingGene = new Set();
  let isoforms = 0;
  const parsed = entries.map((e) => e.split(";").filter(Boolean).map(normalise));

  parsed.forEach((alts, i) => {
    for (const a of alts) {
      const p = a.acc ? org.byAcc.get(a.acc) : org.byGene.get(a.gene);
      if (p) {
        resolved[i] = p;
        if (a.isoform) isoforms++;
        return;
      }
    }
    const first = alts[0];
    if (first) first.acc ? missingAcc.add(first.acc) : missingGene.add(first.gene);
  });

  let liveCount = 0, liveError = null;
  if (live && (missingAcc.size || missingGene.size)) {
    try {
      const byAcc = await fetchByAccession([...missingAcc], org.taxon);
      const byGene = await fetchByGene([...missingGene], org.taxon);
      parsed.forEach((alts, i) => {
        if (resolved[i] || !alts[0]) return;
        const a = alts[0];
        const p = a.acc ? byAcc.get(a.acc) : byGene.get(a.gene);
        if (p) {
          resolved[i] = p;
          liveCount++;
          if (a.isoform) isoforms++;
        }
      });
    } catch (err) {
      liveError = err.message;
    }
  }

  const seen = new Set(), proteins = [], notFound = [];
  let duplicates = 0;
  resolved.forEach((p, i) => {
    if (!p) notFound.push(entries[i]);
    else if (seen.has(p.acc)) duplicates++;
    else {
      seen.add(p.acc);
      proteins.push(p);
    }
  });
  return { proteins, notFound, duplicates, isoforms, liveCount, liveError };
}

// Sequences for display, fetched from UniProt and cached
const sequences = new Map();
export async function fetchSequences(accs) {
  const missing = accs.filter((a) => !sequences.has(a));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const rows = await uniprotTsv(`${UNIPROT}/accessions?accessions=${batch.join(",")}&fields=accession,sequence&format=tsv`);
    for (const [acc, seq] of rows) sequences.set(acc, seq);
  }
  return new Map(accs.map((a) => [a, sequences.get(a)]));
}
