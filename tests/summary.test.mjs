import { test } from "node:test";
import assert from "node:assert/strict";
import { combinationPatterns, combinations, summarySets, bestClass, presence, rankOrder } from "../assets/js/summary.js";

const protein = (...types) => ({ motifs: types.map((type, i) => ({ start: i + 1, motif: "XXXXX", type })) });

test("rank order puts the chosen class right after canonical", () => {
  assert.deepEqual(rankOrder("P").slice(0, 3), ["C", "P", "K"]);
  assert.deepEqual(rankOrder("K").slice(0, 3), ["C", "K", "P"]);
});

test("summary uses only selected single-modification classes, in rank order", () => {
  assert.deepEqual(summarySets(["C", "P", "K", "KP", "N"], "K"), ["C", "K", "P"]);
  assert.deepEqual(summarySets(["P", "C"], "P"), ["C", "P"]);
  assert.deepEqual(summarySets(["KP", "N", "NP"], "P"), []);
});

test("combinations come in rank order, as in the lab's figure", () => {
  assert.deepEqual(combinationPatterns(["C", "K", "P"]).map((p) => p.join("")), ["CKP", "CK", "CP", "C", "KP", "K", "P", ""]);
  assert.deepEqual(combinationPatterns(["C", "P"]).map((p) => p.join("")), ["CP", "C", "P", ""]);
});

test("each protein falls in exactly one combination; combined classes are ignored", () => {
  const proteins = [protein("C", "C", "K"), protein("K", "P"), protein("KP"), protein(), protein("P", "N"), protein("C", "K", "P")];
  const sets = ["C", "K", "P"];
  const combos = combinations(proteins, sets);
  assert.equal(combos.reduce((s, c) => s + c.n, 0), proteins.length);
  const n = Object.fromEntries(combos.map((c) => [c.sets.join(""), c.n]));
  assert.deepEqual(n, { CKP: 1, CK: 1, CP: 0, C: 0, KP: 1, K: 0, P: 1, "": 2 });
  assert.deepEqual(presence(protein("KP", "N"), sets), { C: false, K: false, P: false });
});

test("best class follows the chosen rank", () => {
  const p = protein("K", "P");
  assert.equal(bestClass(p, ["C", "K", "P"], "P"), "P");
  assert.equal(bestClass(p, ["C", "K", "P"], "K"), "K");
  assert.equal(bestClass(protein("N"), ["C", "K", "P"], "P"), "none");
});
