import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichment, hypergeometric } from "../assets/js/enrich.js";

// background where motif presence depends only on length
function lengthDrivenBackground(N, rand = Math.random) {
  return Array.from({ length: N }, (_, i) => {
    const length = 100 + Math.floor((i / N) * 1900);
    return { id: i, length, has: rand() < length / 2200 };
  });
}

test("hypergeometric tail matches a hand-computed case", () => {
  // N=10, K=4, n=3, P(X>=2) = [C(4,2)C(6,1) + C(4,3)] / C(10,3) = (36 + 4) / 120
  const { pEnrich, pDeplete } = hypergeometric(10, 4, 3, 2);
  assert.ok(Math.abs(pEnrich - 40 / 120) < 1e-12);
  // P(X<=2) = 1 - C(4,3)/C(10,3)
  assert.ok(Math.abs(pDeplete - (1 - 4 / 120)) < 1e-12);
});

test("same seed, same result", () => {
  const bg = lengthDrivenBackground(2000);
  const list = bg.slice(0, 200);
  const a = enrichment(list, bg, { iterations: 500, seed: 7 });
  const b = enrichment(list, bg, { iterations: 500, seed: 7 });
  assert.deepEqual(Array.from(a.random.counts), Array.from(b.random.counts));
  assert.deepEqual(Array.from(a.matched.counts), Array.from(b.matched.counts));
});

test("random-set p-value agrees with the hypergeometric test", () => {
  const bg = lengthDrivenBackground(3000);
  const list = bg.filter((p) => p.has).slice(0, 120).concat(bg.filter((p) => !p.has).slice(0, 80));
  const r = enrichment(list, bg, { iterations: 20000, seed: 3 });
  assert.ok(Math.abs(r.random.meanFrac - r.bgFrac) < 0.005);
  const hyper = r.random.hyper.pEnrich, emp = r.random.pEnrich;
  assert.ok(Math.abs(Math.log10(Math.max(hyper, 1 / 20001)) - Math.log10(emp)) < 0.5, `${hyper} vs ${emp}`);
});

test("a list of long proteins is enriched against random sets but not after length matching", () => {
  let s = 42;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const bg = lengthDrivenBackground(5000, rand);
  const list = bg.slice(-1000).filter((_, i) => i % 2 === 0); // long proteins
  const r = enrichment(list, bg, { iterations: 5000, seed: 11 });
  assert.ok(r.random.pEnrich < 0.001, `random p ${r.random.pEnrich}`);
  assert.ok(r.matched.pEnrich > 0.01, `matched p ${r.matched.pEnrich}`);
  assert.ok(r.medianLength.list > r.medianLength.background);
});
