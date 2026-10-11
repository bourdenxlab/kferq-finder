// Builds data/<organism>.json and data/index.json from the current UniProt release.
// Each table holds every reviewed (Swiss-Prot) entry of the organism's reference proteome
// with its precomputed KFERQ-like motifs.
//
//   node scripts/build-data.mjs            # all organisms
//   node scripts/build-data.mjs human rat  # selected organisms
import { writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { scan } from "../assets/js/kferq.js";
import { cleanName } from "../assets/js/data.js";

export const ORGANISMS = [
  { key: "human", common: "Human", name: "Homo sapiens", taxon: 9606, proteome: "UP000005640" },
  { key: "mouse", common: "Mouse", name: "Mus musculus", taxon: 10090, proteome: "UP000000589" },
  { key: "rat", common: "Rat", name: "Rattus norvegicus", taxon: 10116, proteome: "UP000002494" },
  { key: "zebrafish", common: "Zebrafish", name: "Danio rerio", taxon: 7955, proteome: "UP000000437" },
  { key: "fly", common: "Fruit fly", name: "Drosophila melanogaster", taxon: 7227, proteome: "UP000000803" },
  { key: "worm", common: "Nematode", name: "Caenorhabditis elegans", taxon: 6239, proteome: "UP000001940" },
  { key: "yeast", common: "Budding yeast", name: "Saccharomyces cerevisiae S288C", taxon: 559292, proteome: "UP000002311" },
];

const API = "https://rest.uniprot.org";
const DATA = new URL("../data/", import.meta.url);

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url);
    if (r.ok) return r;
    if (attempt === 3) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}

async function build(org) {
  const query = encodeURIComponent(`proteome:${org.proteome} AND reviewed:true`);
  const fields = "accession,gene_primary,gene_names,protein_name,length,sequence";
  const r = await get(`${API}/uniprotkb/stream?query=${query}&fields=${fields}&format=tsv`);
  const release = r.headers.get("x-uniprot-release");
  const releaseDate = r.headers.get("x-uniprot-release-date");
  const lines = (await r.text()).trim().split("\n").slice(1);

  const rows = lines.map((line) => {
    const [acc, primary, names, pname, length, seq] = line.split("\t");
    const primaries = primary ? primary.split(/;\s*/) : [];
    const others = names ? names.split(/[\s;]+/).filter((g) => g && !primaries.includes(g)) : [];
    const motifs = scan(seq).map((m) => `${m.start}:${m.motif}:${m.type}`).join(";");
    return [acc, [...primaries, ...others].join(" "), cleanName(pname), Number(length), motifs];
  });
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const proteome = await (await get(`${API}/proteomes/${org.proteome}?format=json`)).json();
  const meta = {
    ...org,
    release, releaseDate,
    built: new Date().toISOString().slice(0, 10),
    reviewed: rows.length,
    genes: proteome.geneCount,
  };
  const file = new URL(`${org.key}.json`, DATA);
  writeFileSync(file, JSON.stringify({ ...meta, fields: ["acc", "genes", "name", "length", "motifs"], rows }));
  console.log(`${org.key.padEnd(10)} ${rows.length} reviewed entries, ${proteome.geneCount} genes, release ${release}, ${(statSync(file).size / 1e6).toFixed(1)} MB`);
  return meta;
}

const wanted = process.argv.slice(2);
const targets = wanted.length ? ORGANISMS.filter((o) => wanted.includes(o.key)) : ORGANISMS;
if (wanted.length && targets.length !== wanted.length) {
  throw new Error(`Unknown organism. Choose from: ${ORGANISMS.map((o) => o.key).join(", ")}`);
}

const indexFile = new URL("index.json", DATA);
const previous = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")).organisms : [];
const built = new Map(previous.map((o) => [o.key, o]));
for (const org of targets) built.set(org.key, await build(org));

const list = ORGANISMS.filter((o) => built.has(o.key)).map((o) => built.get(o.key));
const releases = [...new Set(list.map((o) => o.release))];
if (releases.length > 1) console.warn(`Warning: tables come from different UniProt releases: ${releases.join(", ")}`);
writeFileSync(indexFile, JSON.stringify({ organisms: list }, null, 2) + "\n");
