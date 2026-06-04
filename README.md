# perfonext-render-mcp

[![npm](https://img.shields.io/npm/v/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)

`perfonext-render-mcp` is an MCP server for loading and analyzing React DevTools Profiler exports captured from Next.js apps. It gives GitHub Copilot and other MCP clients structured render data they can reason over instead of forcing the model to inspect raw profiler JSON.

## What It Does

- loads exported React Profiler JSON files from Next.js apps
- summarizes commits, the most expensive components, and detected render issues in one call
- ranks the hottest commits and shows the top components inside each spike
- identifies the slowest components by total render cost
- highlights components with repeated rerenders using deterministic heuristics, evidence signals, and confidence levels
- compares two render profiles to surface regressions and improvements
- keeps the loaded profiles in memory so an MCP client can iterate without re-reading the file

## Tools

| Tool | Description |
|------|-------------|
| `load_render_profile` | Parse and load an exported React Profiler JSON file from disk |
| `get_render_summary` | Summarize a loaded profile: top components by render cost, hottest commits, and detected render issues (rerender storms, commit spikes) |
| `get_hot_commits` | Rank the most expensive commits and show the top components inside each spike |
| `get_slow_components` | Rank the slowest components by total actual render time |
| `get_rerender_causes` | Explain likely rerender causes using profile-derived heuristics, evidence, confidence, and a documented score |
| `compare_renders` | Diff two loaded render profiles and rank regressions, improvements, additions, and removals |

`get_rerender_causes` is heuristic by design. It works from structural signals in the profiler export — update frequency, nested update propagation, commit spread, and self-intensive renders. When you record with **"Record why each component rendered"** enabled in React DevTools Profiler settings, the export includes richer `changeDescriptions` data; future versions of this tool will parse that field to surface exact prop/state/context diffs natively.

`get_render_summary` includes an `issues` field with up to 5 detected render issues (commit spikes and rerender storms) so you get actionable findings in the same call as the summary.

## Rerender Score Contract

`get_rerender_causes` returns a `score`, `scoreBand`, `confidence`, and `evidence[]` for each component.

- `score`: a `0-10` heuristic rerender-risk score
- `scoreBand`:
  - `low`: `0.0-2.9`
  - `medium`: `3.0-5.9`
  - `high`: `6.0-10.0`
- `confidence`: how many independent evidence signals supported the finding
  - `low`: one weak signal or only fallback export evidence
  - `medium`: two independent signals
  - `high`: three or more independent signals
- `evidence[]`: machine-readable signals such as repeated updates, nested-update propagation, wide commit spread, or high actual-vs-self duration ratio

Current score inputs are:

- repeated update-phase renders
- nested update propagation
- appearance across many commits
- high actual-vs-self duration ratio

The score is meant to help rank investigation order, not to claim exact root cause. Enable **"Record why each component rendered"** in React DevTools Profiler settings before recording to capture richer change metadata in the export.

## Install

Run directly with `npx`:

```bash
npx -y @perfonext/render-mcp
```

Or install globally:

```bash
npm install -g @perfonext/render-mcp
```

The executable command remains `perfonext-render-mcp` after installation.

## MCP Configuration

Add this server to VS Code settings:

```json
{
  "mcp": {
    "servers": {
      "perfonext-render": {
        "command": "npx",
        "args": ["-y", "@perfonext/render-mcp"]
      }
    }
  }
}
```

Local workspace MCP config is also included in `.vscode/mcp.json` for development.

## Example Copilot Prompts

- "Load the React Profiler export at `./profile.json` and summarize the hottest components."
- "Show me the hottest commits in `./profile.json` and which components dominated each spike."
- "Compare `before.json` and `after.json` and tell me which components regressed."
- "Which components are consuming the most render time in this Next.js profile?"
- "Show me the likely rerender causes for the slowest components, including evidence and confidence."

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures for local validation live under `tests/fixtures/`.

## License

MIT
