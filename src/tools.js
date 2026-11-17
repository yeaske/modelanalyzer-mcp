// Pure functions over /data/summary.json. No network, no state: the server
// fetches the summary, cleans it with prepareSummary (summary.js) and passes
// it in; the tests use a fixture.

const usd = (v, digits = 2) =>
  v == null ? "n/a" : v < 0.01 && v > 0 ? `$${Number(v.toPrecision(2))}` : `$${v.toFixed(digits)}`;
const ctx = (v) => (!v ? "n/a" : v >= 1e6 ? `${Number((v / 1e6).toFixed(1))}M` : `${Math.round(v / 1000)}k`);
const num = (v, digits = 1) => (v == null ? "n/a" : v.toFixed(digits));

function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Find models by id or name; exact id first, then name matches. */
export function findModels(summary, query, limit = 10) {
  const q = normalise(query);
  if (!q) return [];
  const exact = summary.models.find((m) => m.id === query || normalise(m.id) === q);
  const words = q.split(" ");
  const scored = summary.models
    .map((m) => {
      const hay = `${normalise(m.name)} ${normalise(m.id)} ${normalise(m.provider)}`;
      const hits = words.filter((w) => hay.includes(w)).length;
      return { m, hits, starts: normalise(m.name).startsWith(q) };
    })
    .filter((x) => x.hits === words.length)
    .sort((a, b) => Number(b.starts) - Number(a.starts) || (b.m.analyzerIndex ?? -1) - (a.m.analyzerIndex ?? -1));
  const out = scored.map((x) => x.m);
  if (exact) return [exact, ...out.filter((m) => m.id !== exact.id)].slice(0, limit);
  return out.slice(0, limit);
}

/** Resolve one model id or name, or throw with suggestions. */
export function resolveModel(summary, idOrName) {
  const [best] = findModels(summary, idOrName, 1);
  if (!best) throw new Error(`No model matches "${idOrName}". Use search_models to find ids.`);
  return best;
}

function modelLine(m) {
  const parts = [
    `Analyzer Index ${num(m.analyzerIndex)}${m.indexRank ? ` (#${m.indexRank})` : ""}`,
    `${usd(m.blendedPerMTokens)}/M tokens blended`,
    m.costPerTaskUSD != null ? `${usd(m.costPerTaskUSD)}/task` : null,
    m.tokensPerSecond != null ? `${num(m.tokensPerSecond, 0)} tok/s` : null,
    m.contextWindow ? `${ctx(m.contextWindow)} context` : null,
    m.openWeights ? "open weights" : null,
    m.retirement ? `retires ${m.retirement.date}` : null,
  ].filter(Boolean);
  return `${m.name} [${m.id}] by ${m.provider}: ${parts.join(", ")}. ${m.url}`;
}

export function searchModels(summary, { query, limit = 10 }) {
  const found = findModels(summary, query, limit);
  if (!found.length) return `No models match "${query}".`;
  return found.map(modelLine).join("\n");
}

export function listScenarios(summary) {
  return summary.scenarios
    .map((s) => `${s.id}: ${s.name}. ${s.description.replace(/\s+/g, " ").trim()} ${s.url}`)
    .join("\n");
}

/**
 * The site's ranking for a scenario, optionally filtered by a monthly budget
 * (at the scenario's own workload) and open weights.
 */
export function recommendModels(summary, { scenario, maxMonthlyCostUSD, openWeightsOnly = false, limit = 5 }) {
  const s = summary.scenarios.find((x) => x.id === scenario || normalise(x.name) === normalise(scenario));
  if (!s) {
    throw new Error(`Unknown scenario "${scenario}". Options: ${summary.scenarios.map((x) => x.id).join(", ")}.`);
  }
  const byId = new Map(summary.models.map((m) => [m.id, m]));
  const rows = s.ranking.filter((r) => {
    const m = byId.get(r.modelId);
    if (!m) return false;
    if (openWeightsOnly && !m.openWeights) return false;
    if (maxMonthlyCostUSD != null && (r.monthlyCostUSD == null || r.monthlyCostUSD > maxMonthlyCostUSD)) return false;
    return true;
  });
  const workload = s.workload
    ? `Workload: ${s.workload.inputTokensPerRequest} input + ${s.workload.outputTokensPerRequest} output tokens x ${s.workload.requestsPerDay} requests/day; cost is ${Math.round(s.workload.costWeight * 100)}% of the score.`
    : "No cost component in this scenario.";
  const header = `${s.name} (${s.url})\n${workload}`;
  if (!rows.length) return `${header}\nNo models in the site's top ${s.ranking.length} meet those filters.`;
  const lines = rows.slice(0, limit).map((r) => {
    const m = byId.get(r.modelId);
    const cost = r.monthlyCostUSD != null ? `, about ${usd(r.monthlyCostUSD)}/month at this workload` : "";
    return `${r.rank}. ${m.name} [${m.id}]: score ${num(r.score)} (quality ${num(r.quality)})${cost}. ${m.url}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

export function compareModels(summary, { models }) {
  if (!Array.isArray(models) || models.length < 2) throw new Error("Give at least two models to compare.");
  const picked = models.slice(0, 6).map((x) => resolveModel(summary, x));
  const rows = [
    ["Model", ...picked.map((m) => m.name)],
    ["Analyzer Index", ...picked.map((m) => `${num(m.analyzerIndex)}${m.indexRank ? ` (#${m.indexRank})` : ""}`)],
    ["Input $/M", ...picked.map((m) => usd(m.inputPerMTokens))],
    ["Output $/M", ...picked.map((m) => usd(m.outputPerMTokens))],
    ["Cost per task", ...picked.map((m) => usd(m.costPerTaskUSD))],
    ["Output speed (tok/s)", ...picked.map((m) => num(m.tokensPerSecond, 0))],
    ["Time to first token (s)", ...picked.map((m) => (m.timeToFirstTokenMs == null ? "n/a" : (m.timeToFirstTokenMs / 1000).toFixed(2)))],
    ["Context", ...picked.map((m) => ctx(m.contextWindow))],
    ["Open weights", ...picked.map((m) => (m.openWeights ? "yes" : "no"))],
    ["Retirement", ...picked.map((m) => (m.retirement ? m.retirement.date : "none announced"))],
  ];
  // Escape pipes so a name can't add or shift table columns.
  const table = rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  table.splice(1, 0, `|${" --- |".repeat(picked.length + 1)}`);
  const compareUrl = `${summary.site}/compare/?ids=${picked.map((m) => m.id).join(",")}`;
  return `${table.join("\n")}\n\nSide by side on the site: ${compareUrl}`;
}

export function estimateCost(summary, { model, inputTokens, outputTokens, requestsPerDay = 1 }) {
  const m = resolveModel(summary, model);
  if (m.inputPerMTokens == null || m.outputPerMTokens == null) {
    return `${m.name} has no tracked API price. ${m.url}`;
  }
  const perRequest = (inputTokens / 1e6) * m.inputPerMTokens + (outputTokens / 1e6) * m.outputPerMTokens;
  const daily = perRequest * requestsPerDay;
  const lines = [
    `${m.name} [${m.id}] at list price (${usd(m.inputPerMTokens)} input, ${usd(m.outputPerMTokens)} output per M tokens):`,
    `per request ${usd(perRequest, 4)}, per day ${usd(daily)}, per 30-day month ${usd(daily * 30)}.`,
    "Excludes caching, batch discounts and hidden reasoning tokens; the site's cost calculator handles those:",
    `${summary.site}/cost/?pin=${m.id}`,
  ];
  if (m.costPerTaskUSD != null) {
    lines.splice(2, 0, `For reference, one Artificial Analysis Intelligence Index task costs ${usd(m.costPerTaskUSD)} on this model.`);
  }
  return lines.join("\n");
}

export function modelRetirements(summary, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const byId = new Map(summary.models.map((m) => [m.id, m]));
  const upcoming = summary.models
    .filter((m) => m.retirement && m.retirement.date >= today)
    .sort((a, b) => a.retirement.date.localeCompare(b.retirement.date));
  if (!upcoming.length) return "No announced retirements for tracked models.";
  const lines = upcoming.map((m) => {
    const r = m.retirement;
    const repl = r.replacementId && byId.get(r.replacementId) ? byId.get(r.replacementId).name : r.replacement;
    return `${r.date}: ${m.name} [${m.id}]${repl ? `, maker recommends ${repl}` : ""}. ${m.url}`;
  });
  return `${lines.join("\n")}\n\nCalendar with reminders: ${summary.site}/calendars/retirements.ics\nAll details: ${summary.site}/retirements/`;
}

export function footer(summary) {
  return `\n\nSource: ${summary.attribution} Data generated ${summary.generatedAt ?? "recently"}.`;
}
