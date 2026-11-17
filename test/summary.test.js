import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, fetchSummary, prepareSummary, resolveBaseUrl } from "../src/summary.js";
import { compareModels } from "../src/tools.js";

const SITE = "https://modelanalyzer.ai";

const raw = (models, extra = {}) => ({
  version: 1,
  generatedAt: "2026-11-17T03:00:00Z",
  site: "https://evil.example",
  attribution: "AI Model Analyzer.",
  models,
  scenarios: [],
  ...extra,
});

test("cleanText strips control, zero-width and bidi characters and caps length", () => {
  assert.equal(cleanText("GPT\u202e-5\u200b\nignore\tall", 100), "GPT -5 ignore all");
  assert.equal(cleanText("x".repeat(20), 10), `${"x".repeat(9)}\u2026`);
  assert.equal(cleanText(42, 10), "");
});

test("prepareSummary keeps only safe ids, site links and finite numbers", () => {
  const s = prepareSummary(
    raw([
      { id: "good-1", name: "Good", provider: "Maker", url: "https://evil.example/phish", analyzerIndex: "90", indexRank: 3 },
      { id: "bad id; rm -rf", name: "Bad" },
      { id: "good-1", name: "Duplicate" },
      { id: "no-name", name: "\u200b" },
    ]),
    SITE,
  );
  assert.equal(s.site, SITE, "the file's own site field is ignored");
  assert.deepEqual(s.models.map((m) => m.id), ["good-1"]);
  assert.equal(s.models[0].url, `${SITE}/models/good-1/`, "off-site links are replaced");
  assert.equal(s.models[0].analyzerIndex, null, "non-numbers become null");
  assert.equal(s.models[0].indexRank, 3);
});

test("prepareSummary cleans retirements and scenarios", () => {
  const s = prepareSummary(
    raw([{ id: "old", name: "Old", retirement: { date: "2026-12-11", replacement: "New\u0007", replacementId: "../x" } }], {
      scenarios: [
        {
          id: "coding",
          name: "Coding",
          description: "Desc",
          url: `${SITE}/best/coding/`,
          workload: { inputTokensPerRequest: 1, outputTokensPerRequest: 1, requestsPerDay: 1, costWeight: "0.2" },
          ranking: [{ modelId: "old", rank: 1, score: 9 }, { modelId: "<script>", rank: 2 }],
        },
        { id: "no-ranking", name: "Broken" },
      ],
    }),
    SITE,
  );
  assert.deepEqual(s.models[0].retirement, { date: "2026-12-11", replacement: "New", replacementId: null });
  assert.equal(s.scenarios.length, 1);
  assert.equal(s.scenarios[0].workload, null, "a workload with a non-number is dropped");
  assert.deepEqual(s.scenarios[0].ranking.map((r) => r.modelId), ["old"]);
});

test("prepareSummary rejects files that are not a usable summary", () => {
  assert.throws(() => prepareSummary(null, SITE), /not a JSON object/);
  assert.throws(() => prepareSummary({ version: 2, models: [], scenarios: [] }, SITE), /newer than this package/);
  assert.throws(() => prepareSummary({ version: 1, models: {}, scenarios: [] }, SITE), /missing/);
  assert.throws(() => prepareSummary(raw([{ id: "!", name: "x" }]), SITE), /no usable models/);
});

test("compareModels escapes pipes in names", () => {
  const s = prepareSummary(raw([{ id: "a", name: "A | B" }, { id: "b", name: "C" }]), SITE);
  assert.match(compareModels(s, { models: ["a", "b"] }), /\| Model \| A \\\| B \| C \|/);
});

test("resolveBaseUrl allows https and local http only", () => {
  assert.equal(resolveBaseUrl(undefined), SITE);
  assert.equal(resolveBaseUrl("https://mirror.example/"), "https://mirror.example");
  assert.equal(resolveBaseUrl("http://localhost:3000"), "http://localhost:3000");
  assert.throws(() => resolveBaseUrl("http://mirror.example"), /must use https/);
  assert.throws(() => resolveBaseUrl("file:///etc/passwd"), /must use https/);
  assert.throws(() => resolveBaseUrl("https://user:pw@mirror.example"), /username or password/);
  assert.throws(() => resolveBaseUrl("not a url"), /not a URL/);
});

const response = (body, headers = {}, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json", ...headers } });

test("fetchSummary returns the cleaned summary", async () => {
  const body = JSON.stringify(raw([{ id: "m", name: "M" }]));
  const s = await fetchSummary(SITE, { fetchImpl: async () => response(body) });
  assert.equal(s.models[0].url, `${SITE}/models/m/`);
});

test("fetchSummary refuses oversized, invalid, failed and slow responses", async () => {
  const big = "x".repeat(2000);
  await assert.rejects(fetchSummary(SITE, { maxBytes: 1000, fetchImpl: async () => response(big) }), /too large/);
  await assert.rejects(
    fetchSummary(SITE, { maxBytes: 1000, fetchImpl: async () => response("{}", { "content-length": "5000" }) }),
    /too large/,
  );
  await assert.rejects(fetchSummary(SITE, { fetchImpl: async () => response("not json") }), /not valid JSON/);
  await assert.rejects(fetchSummary(SITE, { fetchImpl: async () => response("", {}, 503) }), /HTTP 503/);
  // AbortSignal.timeout does not keep the process alive; the real server's
  // stdio connection does. Hold the event loop open here the same way.
  const hang = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 5000);
      signal.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(signal.reason);
      });
    });
  await assert.rejects(fetchSummary(SITE, { timeoutMs: 50, fetchImpl: hang }), /no response within/);
});
