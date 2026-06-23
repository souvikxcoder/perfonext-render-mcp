# perfonext-render-mcp

[![npm](https://img.shields.io/npm/v/@perfonext/render-mcp)](https://www.npmjs.com/package/@perfonext/render-mcp)

`perfonext-render-mcp` is an MCP server for analyzing React render behavior in Next.js apps and applying fixes
in the editor. It is the **agent companion** to React DevTools Profiler and `react-scan` — best at
machine-readable summaries, exact rerender-cause attribution, source-aware follow-up, and diffing.

The loop is **collect → analyze → fix**, all locally:

- **collect** — choose live capture (react-scan/lite streams events in real time) or manual DevTools export
- **analyze** — the MCP returns structured, machine-readable evidence: component costs, rerender causes, commit breakdowns, and regressions
- **fix** — Copilot uses that evidence to propose and apply concrete code changes

> **Note:** while a live capture session is active, React DevTools Timeline Profiler will not receive events
> (react-scan/lite takes over the profiling channel). Calling `stop_render_capture` restores it.

## What It Does

- **live capture** — streams per-commit fiber events from a running React app directly into the MCP over a local HTTP endpoint; no manual export required
- **manual export** — loads exported React DevTools Profiler JSON files as an alternative input path
- summarizes commits, the most expensive components, and detected render issues in one call
- ranks the hottest commits and shows the top components inside each spike
- identifies the slowest components by total render cost
- highlights components with repeated rerenders, reporting the **exact** changed props/state/hooks when live
  capture provides `changeDescription` data, and falling back to deterministic heuristics otherwise
- annotates ranked components with their source file and line when available
- filters DOM host elements (`div`, `span`, …) and unnamed components out of ranked output so findings stay actionable
- compares two render profiles to surface regressions and improvements
- keeps profiles in memory so Copilot can iterate without re-loading

## Tools

### Entry point

| Tool | Description |
|------|-------------|
| `begin_render_analysis` | Entry point. Accepts `approach: "live" \| "manual"`. For `live`: starts a capture session and returns the instrumentation snippet. For `manual`: returns React DevTools Profiler export steps. |

### Live capture

| Tool | Description |
|------|-------------|
| `run_render_capture` | Called after instrumentation is wired up. Accepts `method: "manual-interaction" \| "test-suite"`. Returns focused instructions for whichever method the user picks. Test suites must run **headed** (e.g. `playwright test --headed`) so React profiling hooks activate. |
| `stop_render_capture` | Stop the session, finalize buffered events into a profile, and return a `profileId` plus `dataQuality` (`exact` \| `heuristic`) for analysis |
| `get_captured_renders` | Optional diagnostic: peek at session progress without stopping (commit count, unknown events). Only call if something seems wrong. |

### Analysis

| Tool | Description |
|------|-------------|
| `load_render_profile` | Parse and load an exported React DevTools Profiler JSON file from disk (manual path entry point) |
| `get_render_summary` | Summarize a loaded profile: top components by render cost, hottest commits, and detected render issues |
| `get_hot_commits` | Rank the most expensive commits and show the top components inside each spike |
| `get_slow_components` | Rank the slowest components by total actual render time |
| `get_rerender_causes` | Explain rerender causes with evidence, confidence, and a risk score. Reports exact changed props/state/hooks when `changeDescription` data is present (`dataQuality: "exact"`), heuristics otherwise |
| `compare_renders` | Diff two loaded render profiles and rank regressions, improvements, additions, and removals |

## Quickstart

Ask Copilot: *"Run a render analysis on my app."*

Copilot calls `begin_render_analysis` and asks you to choose:

**Option A — Live capture (recommended)**

Copilot will:
1. Start a capture session (ingest server on `127.0.0.1:7721`)
2. Install `react-scan` as a devDependency if not present
3. Write `instrumentation-client.js` at your project root with the session snippet
4. Import it from your app's client-side entry point
5. Ask whether you want to interact manually or run a test suite (`run_render_capture`)
6. Stop the session and run analysis

> Running a test suite? Launch it **headed** (e.g. `playwright test --headed`). A headless browser does not
> expose the React DevTools profiling channel, so `changeDescription` data is unavailable and causes fall back
> to heuristics (`dataQuality: "heuristic"`).

The ingest server runs on a **fixed port (7721)**. Only the `sessionId` line in `instrumentation-client.js` changes between sessions — the file does not need to be re-wired each time.

**Option B — Manual DevTools export**

1. Open React DevTools in the browser → Profiler tab → Record
2. Interact with the app
3. Export the JSON and share the file path
4. Copilot calls `load_render_profile({ filePath: "..." })`

## Rerender Score Contract

`get_rerender_causes` returns a `dataQuality`, and per component a `score`, `scoreBand`, `confidence`,
`evidence[]`, and (when known) a `source` file/line.

- `dataQuality`:
  - `exact`: at least one fiber carried real `changeDescription` data (live capture in a headed browser), so
    causes name the specific props/state/hooks that changed
  - `heuristic`: no diff data available (DevTools JSON export, or a headless run), so causes are inferred from
    render patterns
- `score`: a `0-10` rerender-risk score
- `scoreBand`:
  - `low`: `0.0-2.9`
  - `medium`: `3.0-5.9`
  - `high`: `6.0-10.0`
- `confidence`: how many independent evidence signals supported the finding
  - `low`: one weak signal or only fallback export evidence
  - `medium`: two independent signals
  - `high`: three or more independent signals
- `evidence[]`: machine-readable signals such as exact change descriptions, repeated updates, nested-update
  propagation, wide commit spread, or high actual-vs-self duration ratio

The score ranks investigation order, not exact root cause.

## Example Copilot Prompts

- "Run a render analysis on my app."
- "Stop the capture and show me the slowest components."
- "Which components are re-rendering the most and why?"
- "Compare this run to the profile I captured before the refactor."
- "I already have a React DevTools export — load it and tell me what's slow."

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

Add to your VS Code `settings.json`:

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

## Example Copilot Prompts

- "Run a render analysis on my app."
- "Stop the capture and show me the slowest components."
- "Which components are re-rendering the most and why?"
- "Compare this run to the profile I captured before the refactor."
- "I already have a React DevTools export — load it and tell me what's slow."
- "Show me the hottest commits and which components dominated each spike."

## Development

```bash
npm install
npm run build
npm test
```

Sample fixtures live under `tests/fixtures/`.

## License

MIT
