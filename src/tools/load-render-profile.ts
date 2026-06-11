import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatMs } from '../format.js';
import { parseRenderProfile } from '../parser/react-profile.js';
import { storeRenderProfile } from '../store.js';

export function registerLoadRenderProfile(server: McpServer): void {
  server.registerTool('load_render_profile', {
    title: 'Load Render Profile',
    description: 'Load a React DevTools Profiler JSON export. ' +
      'This is the entry point for the manual profiling path: open React DevTools in the browser → Profiler tab → Record → interact → Stop → Export JSON → share the file path here. ' +
      'Returns a profileId for use with get_render_summary, get_slow_components, get_rerender_causes, and the other analysis tools.',
    inputSchema: {
      filePath: z.string().describe('Absolute or relative path to the exported React Profiler JSON file'),
    },
  }, async ({ filePath }) => {
    const absPath = resolve(filePath);
    const content = await readFile(absPath, 'utf-8');
    const profile = parseRenderProfile(content, absPath);
    storeRenderProfile(profile);

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          profileId: profile.id,
          filename: profile.filename,
          version: profile.version,
          commitCount: profile.commits.length,
          componentCount: profile.components.length,
          totalCommitDuration: formatMs(profile.totalCommitDuration),
        }, null, 2),
      }],
    };
  });
}
