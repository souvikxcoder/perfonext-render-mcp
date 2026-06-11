#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerLoadRenderProfile } from './tools/load-render-profile.js';
import { registerCompareRenders } from './tools/compare-renders.js';
import { registerGetRenderSummary } from './tools/get-render-summary.js';
import { registerGetHotCommits } from './tools/get-hot-commits.js';
import { registerGetSlowComponents } from './tools/get-slow-components.js';
import { registerGetRerenderCauses } from './tools/get-rerender-causes.js';
import { registerBeginRenderAnalysis } from './tools/begin-render-analysis.js';
import { registerRunRenderCapture } from './tools/run-render-capture.js';
import { registerStopRenderCapture } from './tools/stop-render-capture.js';
import { registerGetCapturedRenders } from './tools/get-captured-renders.js';

const server = new McpServer({
  name: 'perfonext-render-mcp',
  version: '0.3.0',
});

registerLoadRenderProfile(server);
registerCompareRenders(server);
registerGetRenderSummary(server);
registerGetHotCommits(server);
registerGetSlowComponents(server);
registerGetRerenderCauses(server);
registerBeginRenderAnalysis(server);
registerRunRenderCapture(server);
registerStopRenderCapture(server);
registerGetCapturedRenders(server);

const transport = new StdioServerTransport();
await server.connect(transport);
