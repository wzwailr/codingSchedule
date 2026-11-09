import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
const server = new McpServer({ name: 'codingSchedule-capability-probe', version: '0.1.0' });
server.registerTool('probe_ping', { description: 'Technical sample only', inputSchema: z.object({}) }, async () => ({ content: [{ type: 'text', text: 'probe-ok' }] }));
server.connect(new StdioServerTransport()).catch((error) => { console.error(error); process.exitCode = 1; });
