import { readdir, open, mkdir, writeFile, stat } from 'node:fs/promises';
import { homedir, release, cpus, totalmem } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
async function candidates(root, depth = 0) {
  const result = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return result; }
  for (const entry of entries.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 100)) {
    const path = join(root, entry.name);
    if (entry.isDirectory() && depth < 3) result.push(...await candidates(path, depth + 1));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const info = await stat(path);
      result.push({ path, mtimeMs: info.mtimeMs });
    }
    if (result.length >= 200) break;
  }
  return result;
}
async function inspect(root) {
  const files = (await candidates(root)).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 3);
  const types = new Set(), fields = new Set(), payloadTypes = new Set(), toolNames = new Set(), identifierFields = new Set();
  let validRecords = 0, sampledBytes = 0;
  for (const file of files) {
    const handle = await open(file.path, 'r');
    try {
      const { size } = await handle.stat();
      for (const offset of new Set([0, Math.max(0, size - 131_072)])) {
        const buffer = Buffer.alloc(Math.min(size, 131_072));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        sampledBytes += bytesRead;
        const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
        if (offset) lines.shift();
        for (const line of lines) {
          let record; try { record = JSON.parse(line); } catch { continue; }
          validRecords++;
          Object.keys(record).forEach((k) => fields.add(k));
          for (const [container, value] of [['', record], ['payload.', record.payload], ['metadata.', record.metadata]]) {
            if (!value || typeof value !== 'object') continue;
            for (const name of ['id', 'sessionId', 'session_id', 'thread_id', 'turn_id', 'turnId', 'call_id', 'parent_thread_id']) {
              if (typeof value[name] === 'string') identifierFields.add(String(record.type) + ':' + container + name);
            }
          }
          if (typeof record.type === 'string') types.add(record.type);
          if (typeof record.payload?.type === 'string') payloadTypes.add(record.payload.type);
          if (typeof record.payload?.name === 'string') toolNames.add(record.payload.name);
          if (Array.isArray(record.message?.content)) for (const block of record.message.content) if (block.type === 'tool_use' && typeof block.name === 'string') toolNames.add(block.name);
        }
      }
    } finally { await handle.close(); }
  }
  return { available: files.length > 0, sampledFiles: files.length, sampledBytes, validRecords, identifierFields: [...identifierFields].sort(), topLevelFields: [...fields].sort(), recordTypes: [...types].sort(), payloadTypes: [...payloadTypes].sort(), toolNames: [...toolNames].sort() };
}
function version(command) {
  try {
    return command === 'codex.cmd'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'codex.cmd --version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim()
      : execFileSync(command, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }).trim();
  }
  catch { return 'unavailable'; }
}
const report = {
  verifiedAt: new Date().toISOString(), windows: release(), cpu: cpus()[0]?.model, logicalProcessors: cpus().length, ramGiB: Math.round(totalmem() / 1073741824),
  codex: { version: version('codex.cmd'), ...await inspect(resolve(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')) },
  claude: { version: version(resolve(homedir(), '.local/bin/claude.exe')), ...await inspect(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')) },
};
await mkdir('.artifacts/probe', { recursive: true });
await writeFile('.artifacts/probe/hosts.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
