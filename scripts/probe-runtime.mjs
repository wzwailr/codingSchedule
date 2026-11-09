import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import electron from 'electron';
const output = resolve('.artifacts/probe');
await mkdir(output, { recursive: true });
const env = { ...process.env, PROBE_OUTPUT_DIR: output };
delete env.ELECTRON_RUN_AS_NODE;
const exe = process.argv.find((arg) => arg.startsWith('--exe='))?.slice(6) || electron;
const args = exe === electron ? [resolve('dist/probe/main.cjs')] : [];
const run = spawnSync(exe, args, { env, encoding: 'utf8', windowsHide: true, timeout: 30_000 });
if (run.status !== 0) throw new Error(run.stderr || run.stdout || 'Electron probe failed: ' + run.error);
const report = JSON.parse(await readFile(resolve(output, 'electron.json'), 'utf8'));
const runtimeDir = dirname(exe);
const bridgeNode = exe;
const bridgeScript = exe === electron ? resolve('dist/probe/mcp.cjs') : resolve(dirname(exe), 'resources/bridge/probe-mcp.cjs');
const transport = new StdioClientTransport({ command: bridgeNode, args: [bridgeScript], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: runtimeDir, ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe' });
const client = new Client({ name: 'probe-client', version: '0.1.0' });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  const result = await client.callTool({ name: 'probe_ping', arguments: {} });
  report.bridge = { tools: tools.tools.map((tool) => tool.name), reply: result.content[0].text, usedBundledRuntime: true };
} finally { await client.close(); }
await writeFile(resolve(output, exe === electron ? 'runtime.json' : 'packaged-runtime.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ electron: report.electron, node: report.node, sqlite: report.sqlite, bridge: report.bridge, displays: report.displays }));
