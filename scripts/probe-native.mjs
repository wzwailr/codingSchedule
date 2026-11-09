import { _electron } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const output = resolve('.artifacts/probe/native-' + Date.now());
const withInput = process.argv.includes('--with-input');
const reportPath = withInput ? '.artifacts/probe/native-keyboard.json' : '.artifacts/probe/native.json';
await mkdir(output, { recursive: true });
const env = { ...process.env, PROBE_OUTPUT_DIR: output };
delete env.ELECTRON_RUN_AS_NODE;
const application = await _electron.launch({ args: [resolve('dist/probe/main.cjs'), '--interactive'], env });
try {
  const page = await application.firstWindow();
  await page.waitForLoadState();
  let meta;
  for (let i = 0; i < 100; i++) {
    try { meta = JSON.parse(await readFile(resolve(output, 'electron.json'), 'utf8')); break; } catch { await new Promise((done) => setTimeout(done, 100)); }
  }
  if (!meta) throw new Error('Sample never became ready');
  const { bounds } = meta;
  const focus = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-File', resolve('tests/fixtures/native-focus.ps1'), '-WidgetHandle', meta.nativeWindowId, '-TargetX', String(bounds.x + bounds.width - 100), '-TargetY', String(bounds.y + bounds.height - 24), ...(withInput ? ['-WithInput'] : [])], { encoding: 'utf8', windowsHide: true, timeout: 40_000 }));
  await page.locator('header').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve('.artifacts/probe/widget-expanded.png') });
  const metrics = await application.evaluate(({ app }) => app.getAppMetrics().map((p) => ({ type: p.type, privateKiB: p.memory.privateBytes, workingSetKiB: p.memory.workingSetSize, cpu: p.cpu.percentCPUUsage })));
  const report = { verifiedAt: new Date().toISOString(), ...focus, displays: meta.displays, metrics, privateMiB: metrics.reduce((sum, p) => sum + p.privateKiB, 0) / 1024, measurement: 'visible technical sample, Playwright attached; not a five-minute product benchmark', unverified: ['actual text input during hover', 'physical 150% DPI', 'multiple physical displays', 'human acceptance'] };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ focusPass: report.focusPass, inputPass: report.inputPass, cycles: report.cycles.length, privateMiB: report.privateMiB, unverified: report.unverified }));
} catch (error) {
  try { await (await application.firstWindow()).screenshot({ path: resolve('.artifacts/probe/widget-failed.png') }); } catch { /* Preserve the original failure. */ }
  await writeFile(reportPath, JSON.stringify({ verifiedAt: new Date().toISOString(), focusPass: false, error: error.message, inputPass: null }, null, 2));
  throw error;
} finally { await application.close(); }
