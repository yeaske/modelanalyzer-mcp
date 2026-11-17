# modelanalyzer-mcp

An [MCP](https://modelcontextprotocol.io/) server that lets your coding assistant recommend, compare and price AI models, and check when they retire, using the free open data from [AI Model Analyzer](https://modelanalyzer.ai).

It runs locally over stdio and reads one public file, `https://modelanalyzer.ai/data/summary.json`, which the site rebuilds every night. There is no API key, no account and no server to host. Answers link back to the matching page on the site.

## Install

Add it to your assistant's MCP configuration:

```json
{
  "mcpServers": {
    "modelanalyzer": { "command": "npx", "args": ["-y", "modelanalyzer-mcp"] }
  }
}
```

For Claude Code:

```bash
claude mcp add modelanalyzer -- npx -y modelanalyzer-mcp
```

Requires Node.js 20 or later.

## Tools

| Tool | What it does |
| --- | --- |
| `list_scenarios` | The use-case scenarios that `recommend_models` ranks for |
| `recommend_models` | The site's ranking for a scenario (quality blended with cost at a typical workload), optionally under a monthly budget or open weights only |
| `search_models` | Find models by name, id or maker, with Analyzer Index, price, cost per task, speed and context |
| `compare_models` | Side-by-side table of 2 to 6 models |
| `estimate_cost` | Cost per request, day and month at list price for a token volume |
| `model_retirements` | Announced API shutdown dates with each maker's recommended replacement |

Example prompts: "Which model should I use for a customer support bot under $100 a month?", "Compare Claude Opus 5.5 and GPT-6.1 Sol", "Is any model I use being retired soon?"

## Data and credit

Numbers are exactly what modelanalyzer.ai shows, generated nightly. Cost per task and speed come from [Artificial Analysis](https://artificialanalysis.ai/); Arena scores from [LMArena](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) (CC-BY 4.0). See the [methodology](https://modelanalyzer.ai/about/) and [open data](https://modelanalyzer.ai/open-data/) pages.

The summary is cached in memory for six hours. Set `MODELANALYZER_BASE_URL` to read from another host: https only, or plain http to `localhost` for a local build.

## Security

The server only reads: it runs no commands, touches no files, opens no ports and sends nothing about you. It downloads one public file and treats it as untrusted before any of it reaches your assistant: the structure is checked, text is stripped of control and invisible characters and capped in length, ids are limited to a safe alphabet, links must be on the site it read from, and the download is limited to 15 seconds and 5 MB. Report security issues privately through GitHub's "Report a vulnerability" on this repository.

## Development

```bash
npm install
npm test
```

Bug reports and ideas are welcome in [issues](https://github.com/yeaske/modelanalyzer-mcp/issues). The rankings and numbers themselves come from the site; see its [methodology](https://modelanalyzer.ai/about/).

## Releasing

Bump the version in `package.json`, `server.json` (twice) and `src/server.js`; `npm test` checks they agree. Then:

```bash
npm publish
mcp-publisher login github
mcp-publisher publish
```

The second step lists the new version in the [MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.yeaske/modelanalyzer-mcp`.

## License

MIT, © Digital Designs Now.
