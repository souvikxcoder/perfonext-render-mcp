import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { compareRenders } from '../parser/analysis.js';
import { getRenderProfile } from '../store.js';

function formatDiffEntry<T extends {
  baseTotalActualDuration: number;
  currentTotalActualDuration: number;
  totalActualDurationDelta: number;
  averageActualDurationDelta: number;
  maxActualDurationDelta: number;
  percentChange: number | null;
}>(entry: T) {
  return {
    ...entry,
    baseTotalActualDuration: formatMs(entry.baseTotalActualDuration),
    currentTotalActualDuration: formatMs(entry.currentTotalActualDuration),
    totalActualDurationDelta: formatMs(entry.totalActualDurationDelta),
    averageActualDurationDelta: formatMs(entry.averageActualDurationDelta),
    maxActualDurationDelta: formatMs(entry.maxActualDurationDelta),
    percentChange: entry.percentChange == null ? null : `${entry.percentChange.toFixed(1)}%`,
  };
}

export function registerCompareRenders(server: McpServer): void {
  server.registerTool('compare_renders', {
    title: 'Compare Renders',
    description: 'Diff two loaded render profiles and rank the biggest regressions, improvements, additions, and removals.',
    inputSchema: {
      baseProfileId: z.string().describe('Baseline profile ID from load_render_profile'),
      currentProfileId: z.string().describe('Current profile ID from load_render_profile'),
      limit: z.number().int().positive().max(25).optional().describe('How many changed components to include. Defaults to 10.'),
      minDeltaMs: z.number().nonnegative().optional().describe('Minimum absolute total render delta in ms for changed components. Defaults to 0.'),
    },
  }, async ({ baseProfileId, currentProfileId, limit, minDeltaMs }) => {
    const baseProfile = getRenderProfile(baseProfileId);
    if (!baseProfile) {
      throw new Error(`Base profile "${baseProfileId}" not found.`);
    }

    const currentProfile = getRenderProfile(currentProfileId);
    if (!currentProfile) {
      throw new Error(`Current profile "${currentProfileId}" not found.`);
    }

    const comparison = compareRenders(baseProfile, currentProfile, limit ?? 10, minDeltaMs ?? 0);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          ...comparison,
          regressions: comparison.regressions.map(formatDiffEntry),
          improvements: comparison.improvements.map(formatDiffEntry),
          added: comparison.added.map(formatDiffEntry),
          removed: comparison.removed.map(formatDiffEntry),
        }, null, 2),
      }],
    };
  });
}