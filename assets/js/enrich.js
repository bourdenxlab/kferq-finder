// Over-representation of motif-containing proteins in a protein list relative to a background.
//
// Statistic: number of list proteins with at least one motif of the selected classes.
// Null distributions come from drawing sets of the same size from the background, without
// replacement, many times:
//   random:          sets drawn uniformly from the background
//   length-matched:  sets drawn within background length bins, so each set has the same
//                    length profile as the list (longer proteins carry more motifs by chance)
// The background is expected to contain the list (classic over-representation design).
// Proteins are treated as independent draws; paralogous families violate this mildly.

// Small seeded PRNG so a given seed always reproduces the same result
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Draws k of the flags in arr without replacement (partial Fisher-Yates, in place) and sums them
function drawSum(arr, k, rand) {
  let s = 0;
  const n = arr.length;
  for (let j = 0; j < k; j++) {
    const r = j + Math.floor(rand() * (n - j));
    const tmp = arr[j];
    arr[j] = arr[r];
    arr[r] = tmp;
    s += arr[j];
  }
  return s;
}

function drawSumWithReplacement(arr, k, rand) {
  let s = 0;
  for (let j = 0; j < k; j++) s += arr[Math.floor(rand() * arr.length)];
  return s;
}

// Quantile bin edges of the background lengths (upper edges, last one = +Infinity)
export function lengthBinEdges(lengths, nBins) {
  const sorted = Float64Array.from(lengths).sort();
  const edges = [];
  for (let b = 1; b < nBins; b++) {
    const e = sorted[Math.floor((b * sorted.length) / nBins)];
    if (edges.length === 0 || e > edges[edges.length - 1]) edges.push(e);
  }
  edges.push(Infinity);
  return edges;
}

function binOf(len, edges) {
  let lo = 0, hi = edges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (len < edges[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function summarise(nullCounts, k, n) {
  const iters = nullCounts.length;
  let sum = 0, sumSq = 0, ge = 0, le = 0;
  for (const c of nullCounts) {
    sum += c;
    sumSq += c * c;
    if (c >= k) ge++;
    if (c <= k) le++;
  }
  const mean = sum / iters;
  const sd = Math.sqrt(Math.max(0, sumSq / iters - mean * mean));
  const sorted = Int32Array.from(nullCounts).sort();
  const q = (p) => sorted[Math.min(iters - 1, Math.floor(p * iters))];
  return {
    counts: nullCounts,
    meanFrac: mean / n,
    sdFrac: sd / n,
    loFrac: q(0.025) / n,
    hiFrac: q(0.975) / n,
    fold: mean > 0 ? k / mean : NaN,
    z: sd > 0 ? (k - mean) / sd : NaN,
    // add-one empirical p-values: never reported as exactly zero
    pEnrich: (ge + 1) / (iters + 1),
    pDeplete: (le + 1) / (iters + 1),
  };
}

// log-gamma (Lanczos approximation), for the hypergeometric tail
function lgamma(x) {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

// P(X >= k) and P(X <= k) for X ~ Hypergeometric(population N, K successes, n draws).
// This is the exact counterpart of the random-set null (one-sided Fisher's exact test).
export function hypergeometric(N, K, n, k) {
  const lo = Math.max(0, n - (N - K)), hi = Math.min(n, K);
  const denom = lchoose(N, n);
  let upper = 0, lower = 0;
  for (let i = lo; i <= hi; i++) {
    const p = Math.exp(lchoose(K, i) + lchoose(N - K, n - i) - denom);
    if (i >= k) upper += p;
    if (i <= k) lower += p;
  }
  return { pEnrich: Math.min(1, upper), pDeplete: Math.min(1, lower) };
}

// list, background: arrays of { length, has } (has = protein carries a selected motif)
export function enrichment(list, background, { iterations = 10000, seed = 1, nBins = 20 } = {}) {
  const n = list.length, N = background.length;
  if (n === 0 || N === 0) throw new Error("Both the list and the background need at least one protein.");
  if (n > N) throw new Error("The list is larger than the background.");
  const k = list.reduce((s, p) => s + (p.has ? 1 : 0), 0);
  const K = background.reduce((s, p) => s + (p.has ? 1 : 0), 0);
  const rand = mulberry32(seed);

  // random sets
  const flags = Uint8Array.from(background, (p) => (p.has ? 1 : 0));
  const randomCounts = new Int32Array(iterations);
  for (let it = 0; it < iterations; it++) randomCounts[it] = drawSum(flags, n, rand);

  // length-matched sets: as many proteins per length bin as the list has in that bin
  const bins = Math.max(1, Math.min(nBins, Math.floor(N / 25)));
  const edges = lengthBinEdges(background.map((p) => p.length), bins);
  const pools = edges.map(() => []);
  for (const p of background) pools[binOf(p.length, edges)].push(p.has ? 1 : 0);
  const need = new Int32Array(edges.length);
  for (const p of list) need[binOf(p.length, edges)]++;
  const poolArrays = pools.map((a) => Uint8Array.from(a));
  let replacementBins = 0;
  for (let b = 0; b < edges.length; b++) if (need[b] > poolArrays[b].length) replacementBins++;
  const matchedCounts = new Int32Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let s = 0;
    for (let b = 0; b < edges.length; b++) {
      if (!need[b]) continue;
      s += need[b] <= poolArrays[b].length
        ? drawSum(poolArrays[b], need[b], rand)
        : drawSumWithReplacement(poolArrays[b], need[b], rand);
    }
    matchedCounts[it] = s;
  }

  const median = (xs) => {
    const s = Float64Array.from(xs).sort();
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };

  return {
    n, k, N, K,
    obsFrac: k / n,
    bgFrac: K / N,
    iterations, seed,
    bins: edges.length, replacementBins,
    medianLength: { list: median(list.map((p) => p.length)), background: median(background.map((p) => p.length)) },
    random: { ...summarise(randomCounts, k, n), hyper: hypergeometric(N, K, n, k) },
    matched: summarise(matchedCounts, k, n),
  };
}
