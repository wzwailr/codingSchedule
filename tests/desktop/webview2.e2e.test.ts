import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { parse as toml } from 'smol-toml';
import { expect, test } from 'vitest';
import { key } from '../helpers.js';

const exec = promisify(execFile);
const fixture = process.env.SCHEDULE_WEBVIEW2_TEST_DIR;
const command = (pid: number, action: 'handle' | 'close') => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$fixtureProcess=Get-Process -Id ${pid} -ErrorAction Stop; ${action === 'handle' ? '$fixtureProcess.MainWindowHandle.ToInt64()' : '[void]$fixtureProcess.CloseMainWindow()'}`
], { windowsHide: true, timeout: 8000 });

test.skipIf(process.platform !== 'win32' || !fixture)('WebView2 installs both AI tools, opens a native widget, accepts MCP progress and safely undoes setup', async () => {
  const bundle = resolve(fixture!);
  const artifacts = resolve('.artifacts/webview2-assessment');
  const isolated = await mkdtemp(join(artifacts, 'install-run-'));
  const profile = join(isolated, '测试用户'), data = join(profile, '.coding-schedule');
  const install = join(isolated, '程序 测试');
  const appData = join(profile, 'AppData/Roaming'), local = join(profile, 'AppData/Local');
  const env: NodeJS.ProcessEnv = {
    ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: appData, LOCALAPPDATA: local,
    SCHEDULE_TEST_PROFILE: data, PATH: join(process.env.SystemRoot || 'C:/Windows', 'System32')
  };
  delete env.CODEX_HOME;
  delete env.CLAUDE_CONFIG_DIR;
  for (const dir of [data, appData, local, join(profile, '.codex')]) await mkdir(dir, { recursive: true });
  const original = 'model = "test-preference"\n';
  await writeFile(join(profile, '.codex/config.toml'), original);
  await writeFile(join(data, 'position.json'), JSON.stringify({ anchor: { x: 420, y: 380 } }));
  await exec(join(bundle, 'win-unpacked/codingSchedule-webview2.exe'), ['--probe-runtime', '--data-dir', join(isolated, 'runtime-probe')], { env, windowsHide: true, timeout: 25000 });
  const manifest = JSON.parse(await readFile(join(bundle, 'manifest.json'), 'utf8'));
  expect(manifest.testing).toBe(true);
  const installer = join(bundle, `codingSchedule-WebView2-${manifest.version}-test.exe`);
  const installArgs = ['/S', `/D=${install}`];
  const installOnce = () => exec(installer, installArgs, { env, windowsVerbatimArguments: true, windowsHide: true, timeout: 90000 })
    .catch((error: NodeJS.ErrnoException) => { throw new Error(`Isolated installer exited ${error.code ?? 'unknown'}`); });
  await installOnce();
  expect(await readFile(join(install, 'resources/LICENSE'), 'utf8')).toBe(await readFile('LICENSE', 'utf8'));
  expect(Object.keys(JSON.parse(await readFile(join(data, 'receipts.json'), 'utf8')))).toHaveLength(8);
  expect(await readFile(join(profile, '.codex/config.toml'), 'utf8')).toContain(original.trim());
  expect(await readFile(join(profile, '.claude/CLAUDE.md'), 'utf8')).toContain('Reporting is enabled by default');

  const app = spawn(join(install, 'codingSchedule-webview2.exe'), ['--data-dir', data], { env, stdio: 'ignore' });
  const exited = once(app, 'exit');
  const clients: Client[] = [];
  const relayPids: number[] = [];
  let codexEntry: { command: string; args: string[] } | undefined;
  let native: unknown;
  try {
    const pid = app.pid!;
    let handle = '0';
    await expect.poll(async () => {
      handle = (await command(pid, 'handle')).stdout.trim();
      return Number(handle);
    }, { timeout: 20000 }).toBeGreaterThan(0);
    await expect.poll(() => readFile(join(data, 'endpoint.json'), 'utf8').then(() => true, () => false)).toBe(true);

    for (const provider of ['codex', 'claude'] as const) {
      const config = provider === 'codex' ? toml(await readFile(join(profile, '.codex/config.toml'), 'utf8')) : JSON.parse(await readFile(join(profile, '.claude.json'), 'utf8'));
      const entry = (config[provider === 'codex' ? 'mcp_servers' : 'mcpServers'] as Record<string, { command: string; args: string[] }>).codingSchedule!;
      expect(entry.command).toBe(join(install, 'resources/bridge/mcp-relay.exe'));
      if (provider === 'codex') codexEntry = entry;
      const client = new Client({ name: 'webview2-' + provider, version: '1' });
      clients.push(client);
      const transport = new StdioClientTransport({ ...entry, env: env as Record<string, string>, stderr: 'pipe' });
      await client.connect(transport);
      relayPids.push(transport.pid!);
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['progress_begin', 'progress_context', 'progress_finish', 'progress_report']);
      async function call(name: string, args: Record<string, unknown>) {
        const reply = await client.callTool({ name, arguments: args });
        expect(reply.isError).not.toBe(true);
        return JSON.parse((reply.content[0] as { text: string }).text);
      }
      const { handle } = await call('progress_begin', { idempotencyKey: key(Date.now()), title: provider + ' 迁移验收', plan: {
        revision: 1, complete: true, schedule: 'serial', steps: [{ id: 'a', title: '检查新窗口', status: 'running', evidence: 'declared', weight: 1 }]
      } });
      const context = await call('progress_context', { handle });
      await call('progress_report', { handle, seq: context.nextSeq, reportId: key(Date.now()), changes: [
        { type: 'activity.updated', activity: provider + ' 正在核对接入' },
        { type: 'eta.answered', requestId: context.etaQuestion.requestId, planRevision: 1, range: { minSec: 120, maxSec: 180 }, reason: '隔离验收计时样本' }
      ] });
      const next = await call('progress_context', { handle });
      expect(next.snapshot.activity).toBe(provider + ' 正在核对接入');
      expect(next.snapshot.eta.range).toMatchObject({ minSec: expect.any(Number), maxSec: expect.any(Number) });
      await call('progress_report', { handle, seq: next.nextSeq, reportId: key(Date.now()), changes: [
        { type: 'step.updated', revision: 1, step: { id: 'a', title: '检查新窗口', status: 'completed', evidence: 'verified', weight: 1 } }
      ] });
      const done = await call('progress_context', { handle });
      expect((await call('progress_finish', { handle, seq: done.nextSeq, reportId: key(Date.now()), summary: '验收任务完成' })).accepted).toBe(true);
    }

    const args = ['-WindowHandle', handle, '-OwnerPid', String(pid)];
    const region = JSON.parse((await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('tests/fixtures/fold-native-region.ps1'), ...args,
      '-PointsJson', JSON.stringify([{ name: 'corner', x: 0, y: 0 }, { name: 'center', x: 65, y: 120 }])
    ], { windowsHide: true, timeout: 10000 })).stdout);
    const flags = JSON.parse((await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('tests/fixtures/window-flags.ps1'), ...args], { windowsHide: true, timeout: 10000 })).stdout);
    expect(flags).toEqual({ visible: true, topmost: true });
    expect(region.foregroundOwner).not.toBe(pid);
    expect(region.points[0]).toMatchObject({ inRegion: false });
    expect(region.points[0].hitOwner).not.toBe(pid);
    expect(region.points[1]).toMatchObject({ inRegion: true, hitOwner: pid });
    const third = new Client({ name: 'webview2-extra', version: '1' });
    clients.push(third);
    const extra = new StdioClientTransport({ ...codexEntry!, env: env as Record<string, string>, stderr: 'pipe' });
    await third.connect(extra);
    expect((await third.listTools()).tools).toHaveLength(4);
    relayPids.push(extra.pid!);
    const resources = JSON.parse((await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', resolve('scripts/measure-process.ps1'),
      '-ProcessIds', [pid, ...relayPids].join(','), '-IncludeChildren', '-Details'
    ], { windowsHide: true, timeout: 15000 })).stdout);
    expect(resources.requestedCount).toBe(4);
    native = { region, flags, resources };
    await command(pid, 'close');
    const [exit] = await Promise.race([exited, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Host exit timed out')), 8000).unref())]);
    expect(exit).toBe(0);
    await expect.poll(() => readFile(join(data, 'endpoint.json'), 'utf8').then(() => false, () => true)).toBe(true);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    if (app.exitCode === null && app.pid) app.kill();
  }
  await installOnce();
  await exec(join(install, 'Uninstall.exe'), ['/S'], { env, windowsHide: true, timeout: 30000 });
  await expect.poll(() => readFile(join(install, 'codingSchedule-webview2.exe')).then(() => false, () => true), { timeout: 15000 }).toBe(true);
  expect(await readFile(join(profile, '.codex/config.toml'), 'utf8')).toBe(original);
  expect(Object.keys(JSON.parse(await readFile(join(data, 'receipts.json'), 'utf8')))).toHaveLength(0);
  expect((await readFile(join(data, 'schedule.db'))).length).toBeGreaterThan(0);
  await writeFile(join(artifacts, 'webview2-e2e-proof.json'), JSON.stringify({ isolated, native, installedComponents: 8, providers: ['codex', 'claude'], cleanExit: true, repeatInstallAndUndo: true }, null, 2));
}, 180000);
