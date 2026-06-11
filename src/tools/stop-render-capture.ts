import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { deleteCaptureSession, getCaptureSession, stopCaptureSession } from '../ingest/server.js';
import { adaptReactScanEvents } from '../parser/react-scan-lite.js';
import { storeRenderProfile } from '../store.js';
import { formatMs } from '../format.js';

export function registerStopRenderCapture(server: McpServer): void {
  server.registerTool('stop_render_capture', {
    title: 'Stop Render Capture',
    description:
      'Stop a live render-capture session, finalize the buffered events into a render profile, ' +
      'and return a profileId you can use with get_render_summary, get_slow_components, ' +
      'get_rerender_causes, and compare_renders.',
    inputSchema: {
      sessionId: z.string().describe('The sessionId returned by start_render_capture'),
    },
  }, async ({ sessionId }) => {
    const session = getCaptureSession(sessionId);

    if (!session) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session "${sessionId}" not found` }, null, 2) }],
        isError: true,
      };
    }

    if (session.status === 'stopped') {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: `Session "${sessionId}" is already stopped` }, null, 2) }],
        isError: true,
      };
    }

    // Mark stopped before processing so no new events are accepted.
    stopCaptureSession(sessionId);

    const commitCount = session.commits.length;

    if (commitCount === 0) {
      const warning =
        session.profilingAvailable === false
          ? 'No commits captured. The app reported profiling-hooks-status: false — ' +
            'this usually means the app is running a production build. ' +
            'Switch to `next dev` or alias react-dom to react-dom/profiling.'
          : 'No commits captured. Make sure the instrumentation snippet was loaded ' +
            'and you interacted with the app while the session was active.';

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ warning, sessionId, commitCount: 0 }, null, 2) }],
      };
    }

    const profile = adaptReactScanEvents(session.commits, sessionId);
    storeRenderProfile(profile);
    // Session data is no longer needed — free memory.
    deleteCaptureSession(sessionId);

    const result = {
      profileId: profile.id,
      sessionId,
      commitCount: profile.commits.length,
      componentCount: profile.components.length,
      totalCommitDuration: formatMs(profile.totalCommitDuration),
      profilingAvailable: session.profilingAvailable,
      nextStep: `call get_render_summary with profileId "${profile.id}"`,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
