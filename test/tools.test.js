import assert from "node:assert/strict";
import { test } from "node:test";
import { compareModels, estimateCost, findModels, modelRetirements, recommendModels, searchModels } from "../src/tools.js";

const model = (id, name, extra = {}) => ({
  id,
  name,
  provider: "Maker",
  url: `https://modelanalyzer.ai/models/${id}/`,
  modalities: ["text"],
  openWeights: false,
  apiAvailable: true,
  contextWindow: 200000,
  analyzerIndex: 80,
  indexRank: 5,
  inputPerMTokens: 1,
  outputPerMTokens: 5,
  blendedPerMTokens: 2,
  costPerTaskUSD: null,
  tokensPerSecond: 100,
  timeToFirstTokenMs: 500,
  retirement: null,
  ...extra,
});

const summary = {
  version: 1,
  generatedAt: "2026-11-15T03:00:00Z",
  site: "https://modelanalyzer.ai",
  attribution: "AI Model Analyzer.",
  models: [
    model("big-pro", "Big Pro", { analyzerIndex: 95, indexRank: 1 }),
    model("small-open", "Small Open", { openWeights: true, analyzerIndex: 70 }),
    model("old-one", "Old One", { retirement: { date: "2026-12-11", replacement: "big-pro", replacementId: "big-pro" } }),
  ],
  scenarios: [
    {
      id: "coding-assistant",
      name: "Coding Assistant",
      description: "Pair programming.",
      url: "https://modelanalyzer.ai/best/coding-assistant/",
      workload: { inputTokensPerRequest: 4000, outputTokensPerRequest: 1500, requestsPerDay: 200, costWeight: 0.2 },
      ranking: [
        { modelId: "big-pro", rank: 1, score: 90, quality: 95, monthlyCostUSD: 500 },
        { modelId: "small-open", rank: 2, score: 80, quality: 70, monthlyCostUSD: 20 },
      ],
    },
  ],
};

test("findModels matches exact ids first, then every query word", () => {
  assert.deepEqual(findModels(summary, "small-open").map((m) => m.id), ["small-open"]);
  assert.deepEqual(findModels(summary, "big pro").map((m) => m.id), ["big-pro"]);
  assert.equal(findModels(summary, "nothing like this").length, 0);
  assert.match(searchModels(summary, { query: "pro" }), /Big Pro \[big-pro\]/);
});

test("recommendModels applies budget and open-weight filters", () => {
  const all = recommendModels(summary, { scenario: "coding-assistant" });
  assert.match(all, /1\. Big Pro/);
  const cheap = recommendModels(summary, { scenario: "Coding Assistant", maxMonthlyCostUSD: 100 });
  assert.doesNotMatch(cheap, /Big Pro/);
  assert.match(cheap, /2\. Small Open/);
  assert.throws(() => recommendModels(summary, { scenario: "nope" }), /Unknown scenario/);
});

test("compareModels builds a table and a compare link", () => {
  const out = compareModels(summary, { models: ["big-pro", "Small Open"] });
  assert.match(out, /\| Model \| Big Pro \| Small Open \|/);
  assert.match(out, /compare\/\?ids=big-pro,small-open/);
  assert.throws(() => compareModels(summary, { models: ["big-pro"] }), /at least two/);
});

test("estimateCost multiplies list price by volume", () => {
  // 1M input at $1 + 1M output at $5 = $6 per request, 2 a day, 30 days.
  const out = estimateCost(summary, { model: "big-pro", inputTokens: 1_000_000, outputTokens: 1_000_000, requestsPerDay: 2 });
  assert.match(out, /per request \$6\.0000, per day \$12\.00, per 30-day month \$360\.00/);
  // 100 input at $1/M + 10 output at $5/M = $0.00015.
  const tiny = estimateCost(summary, { model: "big-pro", inputTokens: 100, outputTokens: 10 });
  assert.match(tiny, /per request \$0\.00015,/);
});

test("modelRetirements lists upcoming shutdowns with the replacement's name", () => {
  const out = modelRetirements(summary, { today: "2026-11-15" });
  assert.match(out, /2026-12-11: Old One \[old-one\], maker recommends Big Pro/);
  assert.match(modelRetirements(summary, { today: "2027-01-01" }), /No announced retirements/);
});
