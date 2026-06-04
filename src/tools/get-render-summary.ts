import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs, formatPct } from '../format.js';
import { getRenderSummary as summarizeRenderProfile } from '../parser/analysis.js';
import { getRenderProfile, listRenderProfiles } from '../store.js';

export function registerGetRenderSummary(server: McpServer): void {
  server.registerTool('get_render_summary', {
    title: 'Get Render Summary',
    description: 'Summarize the loaded Next.js render profile, including top components by render cost and detected render issues (rerender storms, commit spikes).',
    inputSchema: {
      profileId: z.string().optional().describe('Profile ID from load_render_profile. Omit to list loaded profiles.'),
      limit: z.number().int().positive().max(25).optional().describe('How many top components to include. Defaults to 10.'),
    },
  }, async ({ profileId, limit }) => {
    if (!profileId) {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            profiles: listRenderProfiles().map(profile => ({
              ...profile,
              totalCommitDuration: `${profile.totalCommitDuration.toFixed(2)}ms`,
            })),
          }, null, 2),
        }],
      };
    }

    const profile = getRenderProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found. Call get_render_summary without a profileId to list all loaded profiles.`);
    }

    const summary = summarizeRenderProfile(profile, limit ?? 10);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ...summary,
          totalCommitDuration: formatMs(summary.totalCommitDuration),
          totalRenderDuration: formatMs(summary.totalRenderDuration),
          topComponents: summary.topComponents.map(component => ({
            ...component,
            totalActualDuration: formatMs(component.totalActualDuration),
            averageActualDuration: formatMs(component.averageActualDuration),
            maxActualDuration: formatMs(component.maxActualDuration),
          })),
          hotCommits: summary.hotCommits.map(commit => ({
            ...commit,
            duration: formatMs(commit.duration),
            totalActualDuration: formatMs(commit.totalActualDuration),
            topComponents: commit.topComponents.map(component => ({
              ...component,
              actualDuration: formatMs(component.actualDuration),
              selfDuration: formatMs(component.selfDuration),
              shareOfCommitWork: formatPct(component.shareOfCommitWork),
            })),
          })),
        }, null, 2),
      }],
    };
  });
}
