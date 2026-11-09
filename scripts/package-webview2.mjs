import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import windows from 'app-builder-lib/out/toolsets/windows.js';

const release = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'release/webview2-v1');
const payload = join(release, 'win-unpacked');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const nodeDir = resolve('.artifacts/bridge-runtime');
const bootstrapper = resolve('.artifacts/webview2-sdk/MicrosoftEdgeWebview2Setup.exe');
const bootstrapSha = 'cf2f2445fef0c5c14e372045f84998771eeb8bb01d59be4afd00692fa160082e';
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const run = (file, args, env = process.env) => execFileSync(file, args, { env, windowsHide: true, stdio: 'inherit', timeout: 600000 });

if (await sha(join(nodeDir, 'node.exe')) !== 'ba93f9a70bd86fce3ebbb39ec758501458453467aa92a34a0a3602d1e3fc2b9c') throw new Error('Unexpected private Node runtime digest');
if (!await stat(bootstrapper).catch(() => null)) {
  run('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--max-time', '90', '--output', bootstrapper, 'https://go.microsoft.com/fwlink/p/?LinkId=2124703']);
}
if (await sha(bootstrapper) !== bootstrapSha) throw new Error('WebView2 bootstrapper changed. Verify the official signature before updating the digest.');
const assets = new Map();
function include(from, to) {
  const name = relative(payload, resolve(payload, to));
  if (name !== join(to) || /["$\r\n]/.test(name) || name.startsWith('..')) throw new Error('Invalid NSIS payload path');
  assets.set(name, from);
}
for (const name of ['codingSchedule-webview2.exe', 'WebView2Loader.dll', 'WebView2-LICENSE.txt', 'WebView2-NOTICE.txt']) include(join('dist/webview2', name), name);
include('dist/webview2/main.cjs', 'resources/webview2/main.cjs');
for (const name of ['node.exe', 'LICENSE']) include(join(nodeDir, name), `resources/bridge-runtime/${name}`);
for (const name of ['collector/main.cjs', 'bridge/main.cjs', 'bridge/mcp-relay.exe', 'integration/setup-cli.cjs', 'integration/remove-cli.cjs']) include(join('dist', name), `resources/${name}`);
for (const name of ['index.html', 'styles.css', 'app.js']) include(join('dist/webview2/renderer', name), `resources/renderer/${name}`);
for (const name of ['skill/SKILL.md', 'reporting-rule.md', 'hooks/common.cjs', 'hooks/codex.cjs', 'hooks/claude.cjs']) include(join('integrations', name), `resources/integrations/${name}`);
for (const name of (await readdir('third_party/licenses')).filter(name => name.endsWith('.txt'))) include(join('third_party/licenses', name), `resources/third-party-licenses/${name}`);
const notices = '.artifacts/distribution';
const { dependencies } = JSON.parse(await readFile(join(notices, 'dependencies.json'), 'utf8'));
include(join(notices, 'dependencies.json'), 'resources/dependency-notices/dependencies.json');
for (const name of dependencies.flatMap(dependency => dependency.files)) {
  if (!/^licenses\/[\w@.-]+$/.test(name)) throw new Error('Invalid dependency notice path');
  include(join(notices, name), `resources/dependency-notices/${name}`);
}
include('THIRD_PARTY_NOTICES.md', 'resources/THIRD_PARTY_NOTICES.md');
include('LICENSE', 'resources/LICENSE');

const dirs = new Set();
for (const name of assets.keys()) for (let dir = dirname(name); dir !== '.'; dir = dirname(dir)) dirs.add(dir);
async function checkExisting(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), name = relative(payload, path);
    if (entry.isDirectory() && dirs.has(name)) await checkExisting(path);
    else if (!entry.isFile() || !assets.has(name)) throw new Error(`Unexpected package entry: ${name}. Use a fresh --output directory.`);
  }
}
await mkdir(payload, { recursive: true });
if (!(await lstat(payload)).isDirectory()) throw new Error('Package payload must be a regular directory');
await checkExisting(payload);
for (const [name, from] of assets) {
  const dest = join(payload, name);
  if (!(await lstat(from)).isFile()) throw new Error(`Package input must be a regular file: ${name}`);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(from, dest);
}

const installList = ['!macro InstallPayload ROOT'];
for (const dir of ['.', ...dirs]) {
  const names = [...assets.keys()].filter(name => dirname(name) === dir);
  if (!names.length) continue;
  installList.push(`SetOutPath "\${ROOT}${dir === '.' ? '' : '\\' + dir}"`);
  for (const name of names) installList.push(`File "\${PAYLOAD}\\${name}"`);
}
installList.push('!macroend');
const deleteList = ['!macro DeletePayload ROOT'];
for (const name of assets.keys()) deleteList.push(`Delete "\${ROOT}\\${name}"`);
for (const name of ['Uninstall.exe', '.codingSchedule-WebView2']) deleteList.push(`Delete "\${ROOT}\\${name}"`);
for (const dir of [...dirs].sort((a, b) => b.length - a.length)) deleteList.push(`RMDir "\${ROOT}\\${dir}"`);
deleteList.push('RMDir "${ROOT}"', '!macroend');
const payloadMacros = join(release, 'payload-files.nsh');
await writeFile(payloadMacros, [...installList, ...deleteList].join('\n') + '\n');
const tool = await windows.getMakeNsisPath();
const testing = process.argv.includes('--test-installer');
const installer = join(release, `codingSchedule-WebView2-${version}-${testing ? 'test' : 'setup'}.exe`);
run(tool.path, [
  '/V3', '/INPUTCHARSET', 'UTF8', `/DOUTPUT=${installer}`, `/DPAYLOAD=${payload}`, `/DPAYLOAD_FILES=${payloadMacros}`, `/DVERSION=${version}`, `/DBOOTSTRAPPER=${bootstrapper}`,
  ...(testing ? ['/DSCHEDULE_TEST_INSTALL'] : []), resolve('build/webview2-installer.nsi')
], { ...process.env, ...tool.env });
const manifest = {
  version, installer: { file: installer, bytes: (await stat(installer)).size, sha256: await sha(installer) },
  unpackedBytes: (await Promise.all([...assets.keys()].map(async name => (await stat(join(payload, name))).size))).reduce((sum, value) => sum + value, 0),
  webview2: { bootstrapperSha256: bootstrapSha, mode: 'detect and install Evergreen if needed' },
  testing, signed: false
};
await writeFile(join(release, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
