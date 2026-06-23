import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCaptureSession } from '../ingest/server.js';

export function registerRunRenderCapture(server: McpServer): void {
  server.registerTool('run_render_capture', {
    title: 'Run Render Capture',
    description:
      'Called after instrumentation is wired up (steps 1–3 of begin_render_analysis). ' +
      'Ask the user how they want to generate renders before calling this tool:\n' +
      '  manual-interaction — start the dev server and the user clicks through the app.\n' +
      '  test-suite         — run an existing automated test suite against the running app.',
    inputSchema: {
      sessionId: z.string().describe('The sessionId returned by begin_render_analysis.'),
      method: z
        .enum(['manual-interaction', 'test-suite'])
        .describe(
          '"manual-interaction": user navigates the app manually (fast, focused). ' +
          '"test-suite": run an existing test suite (automated; scope to one file/feature to keep payload manageable).',
        ),
    },
  }, async ({ sessionId, method }) => {
    const session = getCaptureSession(sessionId);
    if (!session || session.status !== 'active') {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ error: `No active session for sessionId "${sessionId}". Call begin_render_analysis first.` }, null, 2),
        }],
        isError: true,
      };
    }

    if (method === 'manual-interaction') {
      const result = {
        method,
        sessionId,
        instructions: [
          '1. Start the dev server (e.g. `npm run dev`).',
          '2. Open the app in your browser and interact with the pages/flows you want to profile.',
          '3. When done, call stop_render_capture to end the session.',
        ].join('\n'),
        nextStep: `stop_render_capture({ sessionId: "${sessionId}" })`,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }

    // test-suite
    const result = {
      method,
      sessionId,
      instructions: [
        '1. Start the dev server if not already running (e.g. `npm run dev`).',
        '2. Inspect the project to find available Playwright test files. Pick one relevant to what you want to profile.',
        '3. Run the test suite with the --headed flag:',
        '   npx playwright test <test-file> --headed',
        '4. When the test run finishes, call stop_render_capture to end the session.',
      ].join('\n'),
      nextStep: `stop_render_capture({ sessionId: "${sessionId}" })`,
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
