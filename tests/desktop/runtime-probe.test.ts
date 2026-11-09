import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('packaged runtime capability probe', () => {
  it('executes isolated SQLite, secure window and bundled MCP probes', () => {
    const result = spawnSync(process.execPath, ['scripts/probe-runtime.mjs'], {
      cwd: resolve('.'), encoding: 'utf8', timeout: 90_000,
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const report = JSON.parse(readFileSync('.artifacts/probe/runtime.json', 'utf8'));
    expect(report.sqlite.transactionRollback).toBe(true);
    expect(report.sqlite.reopenValue).toBe(7);
    expect(report.utilityProcess).toBe(true);
    expect(report.window.nodeIntegration).toBe(false);
    expect(report.window.contextIsolation).toBe(true);
    expect(report.window.sandbox).toBe(true);
    expect(report.window.focusable).toBe(false);
    expect(report.window.alwaysOnTop).toBe(true);
    expect(report.bridge.tools).toEqual(['probe_ping']);
    expect(report.bridge.reply).toBe('probe-ok');
    expect(report.bridge.usedBundledRuntime).toBe(true);
    expect(report.electron).toBe('45.0.0');
  }, 100_000);
});
