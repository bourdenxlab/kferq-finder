---
layout: default
title: About
permalink: /about/
---

<div class="prose" markdown="1">

# About KFERQ finder

Chaperone-mediated autophagy (CMA) degrades proteins that carry a KFERQ-like pentapeptide. The chaperone HSC70 recognises the motif and delivers the protein to lysosomes. KFERQ finder lists these motifs in any protein and tests whether they are over-represented in a protein list.

## Motif rules

A pentapeptide is a canonical motif when one end residue is glutamine (Q) and the other four residues contain:

- one or two basic residues (K, R)
- one or two hydrophobic residues (I, L, V, F)
- exactly one acidic residue (D, E)

Post-translational modifications can turn a near-miss into a motif. A phosphorylated serine, threonine or tyrosine can stand in for the acidic residue, and an acetylated lysine can stand in for the glutamine.

| Class | End residue | Middle residues | Pentapeptides |
|---|---|---|---|
| <span class="swatch m-C"></span> Canonical | Q | acidic D/E | 2,304 |
| <span class="swatch m-P"></span> Phosphorylation-activated | Q | S/T/Y instead of D/E | 3,456 |
| <span class="swatch m-K"></span> Acetylation-activated | K | acidic D/E | 2,112 |
| <span class="swatch m-KP"></span> Acetylation + phosphorylation | K | S/T/Y instead of D/E | 3,168 |
| <span class="swatch m-N"></span> Asparagine | N | acidic D/E | 2,304 |
| <span class="swatch m-NP"></span> Asparagine + phosphorylation | N | S/T/Y instead of D/E | 3,456 |

The first three classes are selected by default. Motifs with asparagine in place of glutamine have been shown to bind HSC70 in some proteins, but they appear necessary rather than sufficient for targeting, so use them with caution. When a pentapeptide fits more than one class, it is reported in the class higher in this table.

Motifs that contain a lysine can be inactivated when that lysine is ubiquitinated. Tick the lysine option to mark them.

These rules generate the same 16,800 pentapeptides as the original 2018 KFERQ finder. The test suite checks this on every change.

## Protein data

Precomputed tables hold every reviewed (Swiss-Prot) entry of each organism's UniProt reference proteome. IDs that are not in a table can be looked up live on UniProt, and their motifs are computed in your browser.

Reviewed entries cover some organisms far better than others. For poorly covered organisms, the whole-proteome background is a sample of well-studied proteins, not the full proteome. A background list from your own experiment avoids this.

<div id="coverage" class="coverage-table"></div>

## Enrichment test

The test asks whether more of your proteins carry at least one motif of the selected classes than expected by chance.

- **Statistic.** The number of proteins in your list with one or more selected motifs.
- **Background.** Either every reviewed protein of the organism, or your own list, such as every protein detected in the experiment. Your proteins are added to a custom background if they are missing from it. With the whole-proteome background, proteins outside the reviewed table are left out of the test, and the results say how many.
- **Random sets.** Sets the size of your list are drawn from the background without replacement, 10,000 times by default. The share of random sets with as many motif-carrying proteins as your list, or more, gives the p-value for enrichment, with one added to the numerator and the denominator so it is never zero. This null has an exact counterpart, the hypergeometric test (one-sided Fisher's exact test), which is reported alongside.
- **Length-matched sets.** Longer proteins carry more motifs by chance, and lists from proteomics experiments tend to be longer than the proteome. The background is split into 20 bins by protein length (quantiles), and each random set draws as many proteins from each bin as your list has in it. If enrichment disappears after length matching, protein length explains it.
- **Assumptions.** Proteins are treated as independent draws. Paralogous proteins share sequence and often share motifs, which makes p-values somewhat optimistic for lists rich in protein families. Isoforms are collapsed to the canonical UniProt entry, and only that sequence is scanned.

The seed setting makes a run reproducible: the same lists, settings and seed always give the same numbers.

## Changes from the 2018 version

- Runs in the browser. There is no server to go down, and pasted sequences are never uploaded.
- Searches by gene name as well as accession, for seven organisms, with tables built from a current UniProt release.
- Adds the enrichment test.
- Fixes problems in the original: very short sequences, the lysine option on pasted sequences, CSV files without a header row, and identical colours for two motif classes.

## Citation and credits

Kirchner P, Bourdenx M, Madrigal-Matute J, Tiano S, Diaz A, Bartholdy BA, Will B, Cuervo AM. Proteome-wide analysis of chaperone-mediated autophagy targeting motifs. *PLoS Biol* 2019;17(5):e3000301. [doi:10.1371/journal.pbio.3000301](https://doi.org/10.1371/journal.pbio.3000301), PMID [31150375](https://pubmed.ncbi.nlm.nih.gov/31150375/).

The original R Shiny application was written by Philipp Kirchner in 2018. Protein data from [UniProt](https://www.uniprot.org), licensed CC BY 4.0.

</div>

<script type="module">
  const index = await fetch("{{ '/data/index.json' | relative_url }}").then((r) => r.json());
  const rows = index.organisms.map((o) => `<tr><td>${o.common} <i>${o.name}</i></td><td class="num">${o.reviewed.toLocaleString("en")}</td><td class="num">${o.genes.toLocaleString("en")}</td><td class="num">${Math.min(100, Math.round((100 * o.reviewed) / o.genes))}%</td></tr>`).join("");
  const release = index.organisms[0];
  document.getElementById("coverage").innerHTML = `<table><thead><tr><th>Organism</th><th class="num">Reviewed entries</th><th class="num">Genes</th><th class="num">Coverage</th></tr></thead><tbody>${rows}</tbody></table><p class="hint">UniProt release ${release.release} (${release.releaseDate}), tables built ${release.built}.</p>`;
</script>
