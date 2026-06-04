import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs, formatPct } from '../format.js';
import { getHotCommits } from '../parser/analysis.js';
import { getRenderProfile } from '../store.js';

export function registerGetHotCommits(server: McpServer): void {
  server.registerTool('get_hot_commits', {
    title: 'Get Hot Commits',
    description: 'Rank the most expensive commits in a loaded render profile and show the top components inside each spike.',
    inputSchema: {
      profileId: z.string().describe('Profile ID from load_render_profile'),
      limit: z.number().int().positive().max(25).optional().describe('How many commits to include. Defaults to 10.'),
      componentLimit: z.number().int().positive().max(10).optional().describe('How many top components to include per commit. Defaults to 3.'),
      priorityLevel: z.string().optional().describe('Filter to commits with this priority level only. Common values: "Immediate" (synchronous, input-blocking), "Normal" (async, e.g. API responses). Omit to include all priorities.'),
    },
  }, async ({ profileId, limit, componentLimit, priorityLevel }) => {
    const profile = getRenderProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found. Call get_render_summary without a profileId to list all loaded profiles.`);
    }

    const hotCommits = getHotCommits(profile, limit ?? 10, componentLimit ?? 3, priorityLevel).map(commit => ({
      ...commit,
      duration: formatMs(commit.duration),
      totalActualDuration: formatMs(commit.totalActualDuration),
      topComponents: commit.topComponents.map(component => ({
        ...component,
        actualDuration: formatMs(component.actualDuration),
        selfDuration: formatMs(component.selfDuration),
        shareOfCommitWork: formatPct(component.shareOfCommitWork),
      })),
    }));

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          profileId,
          timestampNote: 'timestamp values are milliseconds since the profiling session started, not Unix epoch',
          hotCommits,
        }, null, 2),
      }],
    };
  });
}