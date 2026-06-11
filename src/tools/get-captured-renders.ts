import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { getCaptureSession } from '../ingest/server.js';

export function registerGetCapturedRenders(server: McpServer): void {
  server.registerTool('get_captured_renders', {
    title: 'Get Captured Renders',
    description:
      'Optional diagnostic: peek at the live progress of a render-capture session without stopping it. ' +
      'Returns commit count, components seen, whether actualDuration is populating, and an unknownEvents ' +
      'count (non-zero = instrumentation may not be wired correctly). ' +
      'Only call this if something seems wrong — it is not a required step before stop_render_capture.',
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

    const commitCount = session.commits.length;
    const unknownEvents = session.unknownEvents;
    const componentsSeen = new Set<string>();
    let hasActualDuration = false;

    for (const commit of session.commits) {
      for (const fiber of commit.fibers ?? []) {
        if (fiber.name) componentsSeen.add(fiber.name);
        if ((fiber.actualDuration ?? 0) > 0) hasActualDuration = true;
      }
    }

    // Summarize the top components by total actualDuration so the agent can
    // see which components are hot without stopping the session.
    const durationByComponent = new Map<string, number>();
    for (const commit of session.commits) {
      for (const fiber of commit.fibers ?? []) {
        const name = fiber.name ?? `(fiber:${fiber.fiberId})`;
        durationByComponent.set(name, (durationByComponent.get(name) ?? 0) + (fiber.actualDuration ?? 0));
      }
    }
    const topComponents = Array.from(durationByComponent.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([componentName, totalActualDuration]) => ({ componentName, totalActualDuration }));

    let profilingStatus: string;
    if (session.profilingAvailable === null) {
      profilingStatus = 'unknown (no profiling-hooks-status event received yet)';
    } else if (session.profilingAvailable) {
      profilingStatus = 'available';
    } else {
      profilingStatus = 'unavailable — app may be running a production build; switch to `next dev`';
    }

    const diagnosis = unknownEvents > 0 && commitCount === 0
      ? `${unknownEvents} unrecognized POST(s) received — the instrumentation snippet may not be imported correctly, or it is running server-side. Check that the import is in a client-side entry point and the file path is correct.`
      : null;

    const result = {
      sessionId,
      status: session.status,
      commitCount,
      componentCount: componentsSeen.size,
      hasActualDuration,
      profilingStatus,
      ...(diagnosis ? { diagnosis } : {}),
      topComponents,
      nextStep:
        session.status === 'active'
          ? `call stop_render_capture({ sessionId: "${sessionId}" }) when you are done`
          : `session is stopped — call stop_render_capture({ sessionId: "${sessionId}" }) to finalize`,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  });
}
