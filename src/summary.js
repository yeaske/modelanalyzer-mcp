// Check and clean /data/summary.json before any of it reaches the assistant.
//
// Everything in the file ends up in the assistant's context, and some of it
// (model names, makers) comes from third-party catalogs through the site's
// nightly pipeline. So treat it as untrusted: keep only the fields the tools
// use, strip control, zero-width and bidi characters, cap text lengths, keep
// ids to a safe alphabet, and only allow links on the site we fetched from.

export const SUPPORTED_VERSION = 1;
export const DEFAULT_BASE_URL = "https://modelanalyzer.ai";
// The real file is about 170 KB; anything near this cap is not a summary.
export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin to read from: MODELANALYZER_BASE_URL or the public site. Only
 * https is allowed, except plain http to this machine for a local build.
 */
export function resolveBaseUrl(value) {
  if (value == null || value === "") return DEFAULT_BASE_URL;
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`MODELANALYZER_BASE_URL is not a URL: ${cleanText(value, 100)}`);
  }
  if (u.username || u.password) throw new Error("MODELANALYZER_BASE_URL must not contain a username or password.");
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname))) {
    throw new Error("MODELANALYZER_BASE_URL must use https (plain http is allowed only for localhost).");
  }
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/**
 * Download and clean `${base}/data/summary.json`, giving up after
 * `timeoutMs` and refusing bodies over `maxBytes`.
 */
export async function fetchSummary(base, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  const url = `${base}/data/summary.json`;
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? `no response within ${timeoutMs / 1000}s` : "network error";
    throw new Error(`Could not load ${url} (${reason}).`);
  }
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new Error(`${url} is too large (${declared} bytes).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error(`${url} is too large (over ${maxBytes} bytes).`);
    chunks.push(chunk);
  }
  let raw;
  try {
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error(`${url} is not valid JSON.`);
  }
  return prepareSummary(raw, base);
}

const LIMITS = { name: 100, provider: 60, description: 600, attribution: 300, replacement: 100 };
const MAX_MODELS = 5000;
const MAX_RANKING = 100;
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// C0/C1 controls, zero-width and joiner characters, bidi embeddings/overrides/isolates, BOM.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/** Plain single-line text: unsafe characters removed, whitespace collapsed, length capped. */
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const id = (v) => (typeof v === "string" && ID.test(v) ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v) => (typeof v === "string" && DATE.test(v) ? v : null);

/** A link on `site`, or the fallback path on `site`. */
function siteUrl(value, site, fallbackPath) {
  if (typeof value === "string") {
    try {
      const u = new URL(value);
      const origin = new URL(site).origin;
      if (u.origin === origin) return `${origin}${u.pathname}`;
    } catch {
      // fall through
    }
  }
  return `${site}${fallbackPath}`;
}

function model(raw, site) {
  const mid = id(raw?.id);
  const name = cleanText(raw?.name, LIMITS.name);
  if (!mid || !name) return null;
  let retirement = null;
  if (raw.retirement && date(raw.retirement.date)) {
    retirement = {
      date: raw.retirement.date,
      replacement: cleanText(raw.retirement.replacement, LIMITS.replacement) || null,
      replacementId: id(raw.retirement.replacementId),
    };
  }
  return {
    id: mid,
    name,
    provider: cleanText(raw.provider, LIMITS.provider) || "Unknown",
    url: siteUrl(raw.url, site, `/models/${mid}/`),
    openWeights: raw.openWeights === true,
    contextWindow: num(raw.contextWindow),
    analyzerIndex: num(raw.analyzerIndex),
    indexRank: num(raw.indexRank),
    inputPerMTokens: num(raw.inputPerMTokens),
    outputPerMTokens: num(raw.outputPerMTokens),
    blendedPerMTokens: num(raw.blendedPerMTokens),
    costPerTaskUSD: num(raw.costPerTaskUSD),
    tokensPerSecond: num(raw.tokensPerSecond),
    timeToFirstTokenMs: num(raw.timeToFirstTokenMs),
    retirement,
  };
}

function scenario(raw, site) {
  const sid = id(raw?.id);
  const name = cleanText(raw?.name, LIMITS.name);
  if (!sid || !name || !Array.isArray(raw.ranking)) return null;
  const w = raw.workload;
  const workload =
    w && [w.inputTokensPerRequest, w.outputTokensPerRequest, w.requestsPerDay, w.costWeight].every((v) => num(v) != null)
      ? {
          inputTokensPerRequest: w.inputTokensPerRequest,
          outputTokensPerRequest: w.outputTokensPerRequest,
          requestsPerDay: w.requestsPerDay,
          costWeight: w.costWeight,
        }
      : null;
  const ranking = raw.ranking
    .slice(0, MAX_RANKING)
    .map((r) => ({
      modelId: id(r?.modelId),
      rank: num(r?.rank),
      score: num(r?.score),
      quality: num(r?.quality),
      monthlyCostUSD: num(r?.monthlyCostUSD),
    }))
    .filter((r) => r.modelId && r.rank != null);
  return {
    id: sid,
    name,
    description: cleanText(raw.description, LIMITS.description),
    url: siteUrl(raw.url, site, `/best/${sid}/`),
    workload,
    ranking,
  };
}

/**
 * Validate the downloaded summary and return a cleaned copy. `site` is the
 * origin we fetched from; it replaces the file's own `site` field, and every
 * link must be on it. Throws when the file is not a usable summary.
 */
export function prepareSummary(raw, site) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("summary.json is not a JSON object.");
  if (!Number.isInteger(raw.version)) throw new Error("summary.json has no version.");
  if (raw.version > SUPPORTED_VERSION) {
    throw new Error(`summary.json version ${raw.version} is newer than this package supports; update modelanalyzer-mcp.`);
  }
  if (!Array.isArray(raw.models) || !Array.isArray(raw.scenarios)) {
    throw new Error("summary.json is missing its models or scenarios.");
  }
  const seen = new Set();
  const models = [];
  for (const m of raw.models.slice(0, MAX_MODELS)) {
    const clean = model(m, site);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      models.push(clean);
    }
  }
  if (!models.length) throw new Error("summary.json has no usable models.");
  return {
    version: raw.version,
    generatedAt: typeof raw.generatedAt === "string" && !Number.isNaN(Date.parse(raw.generatedAt)) ? raw.generatedAt : null,
    site,
    attribution: cleanText(raw.attribution, LIMITS.attribution) || "AI Model Analyzer (modelanalyzer.ai).",
    models,
    scenarios: raw.scenarios.map((s) => scenario(s, site)).filter(Boolean),
  };
}
