import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, scan, parseFasta, hasLysine } from "../assets/js/kferq.js";

const AA = "ACDEFGHIKLMNPQRSTVWY";

test("rules reproduce the 2018 KFERQ finder motif table exactly (16,800 pentapeptides)", () => {
  const lines = readFileSync(new URL("fixtures/motif_reference_2018.csv", import.meta.url), "utf8").trim().split("\n").slice(1);
  const reference = new Map(lines.map((l) => l.split(",")));
  const found = new Map();
  const p = new Array(5);
  const rec = (d) => {
    if (d === 5) {
      const s = p.join("");
      const t = classify(s);
      if (t) found.set(s, t);
      return;
    }
    for (const a of AA) {
      p[d] = a;
      rec(d + 1);
    }
  };
  rec(0);
  assert.equal(found.size, 16800);
  assert.deepEqual(found, reference);
});

test("known motifs", () => {
  assert.equal(classify("KFERQ"), "C");
  assert.equal(classify("QRFEK"), "C"); // Q on the left
  assert.equal(classify("KFSRQ"), "P");
  assert.equal(classify("KFERK"), "K");
  assert.equal(classify("KFERN"), "N");
  assert.equal(classify("AFERQ"), null);
  assert.equal(classify("KFERQX"), null);
});

test("alpha-synuclein has a single canonical motif, VKKDQ at 95", () => {
  const snca = "MDVFMKGLSKAKEGVVAAAEKTKQGVAEAAGKTKEGVLYVGSKTKEGVVHGVATVAEKTKEQVTNVGGAVVTGVTAVAQKTVEGAGSIAAATGFVKKDQLGKNEEGAPQEGILEDMPVDPDNEAYEMPSEEGYQDYEPEA";
  assert.deepEqual(scan(snca), [{ start: 95, motif: "VKKDQ", type: "C" }]);
});

test("short sequences and edges", () => {
  assert.deepEqual(scan(""), []);
  assert.deepEqual(scan("KFER"), []);
  assert.deepEqual(scan("KFERQ"), [{ start: 1, motif: "KFERQ", type: "C" }]);
});

test("ubiquitination flag", () => {
  assert.equal(hasLysine("VKKDQ"), true);
  assert.equal(hasLysine("RFEVQ"), false);
});

test("FASTA parsing", () => {
  const recs = parseFasta(">sp|P1|A test\nkfer q\n\n  >second\nMKF*\n");
  assert.deepEqual(recs.map((r) => [r.name, r.seq]), [["sp|P1|A test", "KFERQ"], ["second", "MKF"]]);
  const plain = parseFasta("MKFERQ\n\nAAAA 12");
  assert.deepEqual(plain.map((r) => [r.name, r.seq]), [["Sequence 1", "MKFERQ"], ["Sequence 2", "AAAA"]]);
  assert.equal(parseFasta(">x\nKF-ERQ")[0].removed, 1);
});
