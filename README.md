# KFERQ finder

Find KFERQ-like motifs, the pentapeptides that target proteins to chaperone-mediated autophagy, in protein sequences or UniProt entries, and test whether they are enriched in a protein list.

A static site: all analysis runs in the browser, so it can be hosted on GitHub Pages with no server. It replaces the 2018 R Shiny application described in Kirchner et al., *PLoS Biol* 2019, [doi:10.1371/journal.pbio.3000301](https://doi.org/10.1371/journal.pbio.3000301).

## Layout

| Path | What it is |
|---|---|
| `index.html`, `about.md`, `_layouts/` | Pages (Jekyll) |
| `assets/js/kferq.js` | Motif rules and scanner, shared by the site, the data build and the tests |
| `assets/js/enrich.js` | Enrichment test (random and length-matched resampling, hypergeometric test) |
| `assets/js/data.js` | Loads the proteome tables, resolves IDs, falls back to the UniProt REST API |
| `assets/js/app.js` | User interface |
| `data/` | Precomputed tables: reviewed UniProt entries per organism, with motifs |
| `scripts/build-data.mjs` | Rebuilds `data/` from the current UniProt release |
| `tests/` | Rule and statistics tests, including the 2018 motif table as a fixture |

## Run locally

Needs Jekyll 3.9 (the `github-pages` gem) and Node 18 or later.

```bash
jekyll serve --port 4010
```

Then open http://localhost:4010.

## Test

```bash
npm test
```

## Update the protein data

```bash
npm run build-data
```

This downloads every reviewed entry of each organism's UniProt reference proteome (about 40 seconds for all seven) and rewrites `data/*.json`. To rebuild only some organisms, use `node scripts/build-data.mjs human mouse`. To add an organism, add a line to `ORGANISMS` in `scripts/build-data.mjs`.

## Deploy

Live at https://bourdenxlab.github.io/kferq-finder/. GitHub Pages builds the Jekyll site from the `main` branch on every push, so pushing a change is all it takes to update the site.

## Credits

Original R Shiny application by Philipp Kirchner (2018). Protein data from [UniProt](https://www.uniprot.org) (CC BY 4.0). Code under the MIT licence.
