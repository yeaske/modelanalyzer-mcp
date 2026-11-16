#!/usr/bin/env node
// MCP server for AI Model Analyzer. Reads the site's public summary file
// (https://modelanalyzer.ai/data/summary.json); nothing is hosted for it and
// no key is needed. Runs over stdio.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  compareModels,
  estimateCost,
  footer,
  listScenarios,
  modelRetirements,
  recommendModels,
  searchModels,
} from "./tools.js";

const BASE_URL = (process.env.MODELANALYZER_BASE_URL ?? "https://modelanalyzer.ai").replace(/\/$/, "");
const SUPPORTED_VERSION = 1;
// The site rebuilds nightly; refetch at most every six hours.
const TTL_MS = 6 * 60 * 60 * 1000;

let cache = null;

async function summary() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await fetch(`${BASE_URL}/data/summary.json`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Could not load ${BASE_URL}/data/summary.json (HTTP ${res.status}).`);
  const data = await res.json();
  if (data.version > SUPPORTED_VERSION) {
    throw new Error(`summary.json version ${data.version} is newer than this package supports; update modelanalyzer-mcp.`);
  }
  cache = { at: Date.now(), data };
  return data;
}

function tool(fn) {
  return async (args) => {
    try {
      const s = await summary();
      return { content: [{ type: "text", text: fn(s, args ?? {}) + footer(s) }] };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
    }
  };
}

const server = new McpServer({ name: "modelanalyzer", version: "0.1.2" });
const readOnly = { readOnlyHint: true, openWorldHint: true };

server.registerTool(
  "list_scenarios",
  {
    title: "List use-case scenarios",
    description: "List the use-case scenarios (coding assistant, customer support bot, bulk classification, ...) that recommend_models ranks for.",
    annotations: readOnly,
  },
  tool((s) => listScenarios(s)),
);

server.registerTool(
  "recommend_models",
  {
    title: "Recommend models for a use case",
    description:
      "AI Model Analyzer's current ranking for a use-case scenario, blending benchmark quality with cost at a typical workload. Optionally filter by a monthly budget at that workload or by open weights.",
    inputSchema: {
      scenario: z.string().describe("Scenario id or name from list_scenarios, e.g. coding-assistant"),
      maxMonthlyCostUSD: z.number().positive().optional().describe("Only models at or under this monthly cost at the scenario's workload"),
      openWeightsOnly: z.boolean().optional().describe("Only models with downloadable weights"),
      limit: z.number().int().min(1).max(20).optional().describe("How many to return (default 5)"),
    },
    annotations: readOnly,
  },
  tool(recommendModels),
);

server.registerTool(
  "search_models",
  {
    title: "Search models",
    description: "Find models by name, id or maker. Returns ids for the other tools, plus Analyzer Index, price, cost per task, speed and context.",
    inputSchema: {
      query: z.string().describe("Model name, id or maker, e.g. 'claude sonnet' or 'gpt-6'"),
      limit: z.number().int().min(1).max(25).optional(),
    },
    annotations: readOnly,
  },
  tool(searchModels),
);

server.registerTool(
  "compare_models",
  {
    title: "Compare models",
    description: "Side-by-side table of 2 to 6 models: Analyzer Index and rank, input/output price, cost per task, speed, time to first token, context, open weights and announced retirement.",
    inputSchema: {
      models: z.array(z.string()).min(2).max(6).describe("Model ids or names"),
    },
    annotations: readOnly,
  },
  tool(compareModels),
);

server.registerTool(
  "estimate_cost",
  {
    title: "Estimate API cost",
    description: "Cost per request, day and month for a model at list price, given tokens per request and requests per day.",
    inputSchema: {
      model: z.string().describe("Model id or name"),
      inputTokens: z.number().int().nonnegative().describe("Input tokens per request"),
      outputTokens: z.number().int().nonnegative().describe("Output tokens per request"),
      requestsPerDay: z.number().int().positive().optional().describe("Requests per day (default 1)"),
    },
    annotations: readOnly,
  },
  tool(estimateCost),
);

server.registerTool(
  "model_retirements",
  {
    title: "Upcoming model retirements",
    description: "Announced API shutdown dates for tracked models, with each maker's recommended replacement.",
    annotations: readOnly,
  },
  tool((s) => modelRetirements(s)),
);

await server.connect(new StdioServerTransport());
