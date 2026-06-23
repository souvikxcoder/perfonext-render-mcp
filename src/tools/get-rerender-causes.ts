import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { getRerenderCauses } from '../parser/analysis.js';
import { getRenderProfile } from '../store.js';

export function registerGetRerenderCauses(server: McpServer): void {
  server.registerTool('get_rerender_causes', {
    title: 'Get Rerender Causes',
    description: 'Highlight components with repeated rerenders and explain likely causes using heuristics derived from the exported profile.',
    inputSchema: {
      profileId: z.string().describe('Profile ID from load_render_profile'),
      limit: z.number().int().positive().max(25).optional().describe('How many components to include. Defaults to 10.'),
      minDuration: z.number().nonnegative().optional().describe('Minimum total actual duration in ms for a component to appear. Filters sub-millisecond noise. Defaults to 0.'),
    },
  }, async ({ profileId, limit, minDuration }) => {
    const profile = getRenderProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found. Call get_render_summary without a profileId to list all loaded profiles.`);
    }

    const causes = getRerenderCauses(profile, limit ?? 10, minDuration ?? 0).map(cause => ({
      ...cause,
      score: Number(cause.score.toFixed(1)),
      totalActualDuration: formatMs(cause.totalActualDuration),
    }));

    const dataQuality = profile.hasChangeDescriptions ? 'exact' : 'heuristic';
    const qualityNote = profile.hasChangeDescriptions
      ? 'Causes are based on exact prop/state changeDescription data from react-scan/lite.'
      : 'Causes are heuristic — no prop/state diff data available. Run live capture (begin_render_analysis, approach: live) in a real browser to get exact change descriptions.';

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          profileId,
          dataQuality,
          note: qualityNote,
          scoreDocumentation: {
            meaning: '0-10 rerender risk score. Factors: update frequency, nested updates, commit spread, self-intensive render, average render duration.',
            thresholds: { low: '0.0-2.9', medium: '3.0-5.9', high: '6.0-10.0' },
          },
          causes,
        }, null, 2),
      }],
    };
  });
}
