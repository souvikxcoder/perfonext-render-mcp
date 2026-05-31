import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { getSlowComponents } from '../parser/analysis.js';
import { getRenderProfile } from '../store.js';

export function registerGetSlowComponents(server: McpServer): void {
  server.registerTool('get_slow_components', {
    title: 'Get Slow Components',
    description: 'Return the slowest components in a loaded Next.js render profile, ranked by total actual render time.',
    inputSchema: {
      profileId: z.string().describe('Profile ID from load_render_profile'),
      limit: z.number().int().positive().max(25).optional().describe('How many components to return. Defaults to 10.'),
      sortBy: z.enum(['total', 'average', 'max']).optional().describe('Sort metric: "total" = total render time (default), "average" = average per render, "max" = peak single render time.'),
      minDuration: z.number().nonnegative().optional().describe('Minimum total actual duration in ms to include. Filters sub-millisecond noise. Defaults to 0.'),
    },
  }, async ({ profileId, limit, sortBy, minDuration }) => {
    const profile = getRenderProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found. Call get_render_summary without a profileId to list all loaded profiles.`);
    }

    const slowComponents = getSlowComponents(profile, limit ?? 10, sortBy ?? 'total', minDuration ?? 0).map((component, index) => ({
      rank: index + 1,
      ...component,
      totalActualDuration: formatMs(component.totalActualDuration),
      averageActualDuration: formatMs(component.averageActualDuration),
      maxActualDuration: formatMs(component.maxActualDuration),
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ profileId, slowComponents }, null, 2),
      }],
    };
  });
}
