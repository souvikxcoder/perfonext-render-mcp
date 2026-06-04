#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerLoadRenderProfile } from './tools/load-render-profile.js';
import { registerCompareRenders } from './tools/compare-renders.js';
import { registerGetRenderSummary } from './tools/get-render-summary.js';
import { registerGetHotCommits } from './tools/get-hot-commits.js';
import { registerGetSlowComponents } from './tools/get-slow-components.js';
import { registerGetRerenderCauses } from './tools/get-rerender-causes.js';

const server = new McpServer({
  name: 'perfonext-render-mcp',
  version: '0.2.0',
});

registerLoadRenderProfile(server);
registerCompareRenders(server);
registerGetRenderSummary(server);
registerGetHotCommits(server);
registerGetSlowComponents(server);
registerGetRerenderCauses(server);

const transport = new StdioServerTransport();
await server.connect(transport);
