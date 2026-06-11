import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createCaptureSession } from '../ingest/server.js';

export function registerBeginRenderAnalysis(server: McpServer): void {
  server.registerTool('begin_render_analysis', {
    title: 'Begin Render Analysis',
    description:
      'Entry point for render profiling. Choose an approach:\n' +
      '  live   — react-scan/lite streams events in real time; exact rerender causes, source locations, changeDescription.\n' +
      '  manual — no install needed; user exports a JSON from the React DevTools Profiler tab and shares the file path.\n' +
      'Ask the user which approach they prefer before calling this tool.',
    inputSchema: {
      approach: z
        .enum(['live', 'manual'])
        .describe(
          '"live": react-scan/lite live capture (richer data, needs npm install). ' +
          '"manual": React DevTools Profiler JSON export (no install, less detailed).',
        ),
    },
  }, async ({ approach }) => {
    if (approach === 'live') {
      const session = await createCaptureSession();

      const snippet = [
        `import { instrument } from "react-scan/lite";`,
        `instrument({`,
        `  endpoint: "${session.endpoint}",`,
        `  sessionId: "${session.sessionId}",`,
        `  recordChangeDescriptions: true,`,
        `  includeFiberSource: true,`,
        `  includeFiberIdentity: true,`,
        `});`,
      ].join('\n');

      const result = {
        approach: 'live',
        sessionId: session.sessionId,
        endpoint: session.endpoint,
        snippet,
        snippetFile: 'instrumentation-client.js',
        setup: [
          '1. npm install --save-dev react-scan',
          '2. Create (or overwrite) instrumentation-client.js at your project root with the content in `snippet`.',
          '   The ingest server runs on a fixed port (7721 by default), so only the sessionId line changes between runs.',
          '3. Import it from your app\'s client-side entry point (e.g. _app.tsx, root layout, main.tsx)',
          '   — inspect the project structure to find the right file.',
          '   The import must run on the client (add "use client" if the entry is a Server Component).',
        ].join('\n'),
        nextStep: `run_render_capture({ sessionId: "${session.sessionId}", method: <ask the user> })`,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    // manual path — no session created
    const result = {
      approach: 'manual',
      setup: [
        '1. Install the React DevTools browser extension if not already (Chrome/Firefox/Edge).',
        '2. Run your app (next dev or next start).',
        '3. Open browser DevTools → React DevTools panel → "Profiler" tab.',
        '4. Click the Record button (filled circle ●) to start profiling.',
        '5. Interact with your app — navigate pages, trigger state changes, etc.',
        '6. Click the Stop button (■) to end the recording.',
        '7. Click the Export icon (download arrow ↓ in the top-right of the Profiler panel) and save the JSON file.',
        '8. Share the saved file path — Copilot will call load_render_profile to load it.',
      ].join('\n'),
      nextStep: 'load_render_profile({ filePath: "<path-to-exported-json>" })',
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
