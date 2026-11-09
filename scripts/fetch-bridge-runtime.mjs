import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const version = 'v24.22.0';
const archive = 'node-' + version + '-win-x64.zip';
const base = 'https://nodejs.org/dist/' + version + '/';
const target = resolve('.artifacts/bridge-runtime');
await mkdir(target, { recursive: true });
const download = async (name) => {
  const output = resolve('.artifacts', name + '.download');
  execFileSync('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--connect-timeout', '10', '--max-time', '300', ...(name.endsWith('.zip') ? ['--continue-at', '-'] : []), '--output', output, base + name], { windowsHide: true, timeout: 305_000 });
  return readFile(output);
};
const sums = (await download('SHASUMS256.txt')).toString('utf8');
const expected = sums.split(/\r?\n/).find((line) => line.endsWith('  ' + archive))?.split(/\s+/)[0];
if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('No exact official archive checksum');
const zipPath = resolve('.artifacts', archive);
let bytes;
try { bytes = await readFile(zipPath); } catch { bytes = await download(archive); }
if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Runtime SHA-256 mismatch; refusing extraction');
await writeFile(zipPath, bytes);
const unzip = resolve('.artifacts/runtime-unpacked');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& { param($archivePath,$destinationPath) Expand-Archive -LiteralPath $archivePath -DestinationPath $destinationPath -Force }', zipPath, unzip], { windowsHide: true });
for (const name of ['node.exe', 'LICENSE']) await copyFile(resolve(unzip, 'node-' + version + '-win-x64', name), resolve(target, name));
const exeHash = createHash('sha256').update(await readFile(resolve(target, 'node.exe'))).digest('hex');
await writeFile(resolve(target, 'manifest.json'), JSON.stringify({ version, archive, url: base + archive, sha256: expected, executableSha256: exeHash }, null, 2));
console.log(JSON.stringify({ version, sha256: expected, executableSha256: exeHash }));
