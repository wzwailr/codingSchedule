import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { v8MemoryArgs } from '../src/shared/runtime-memory.ts';

const version = '1.0.3537.50';
const sha256 = '5ea526bbd728adda0da4d31219267e96460494a427e4894c4e09d9f320f4b9aa';
const cache = resolve('.artifacts/webview2-sdk');
const archive = join(cache, 'v2.zip');
const sdk = join(cache, version);
const compiler = resolve(process.env.SCHEDULE_RELAY_ZIG || '.artifacts/relay-compiler/fast/zig-x86_64-windows-0.15.2/zig.exe');
const out = resolve('dist/webview2');
const run = (command, args) => execFileSync(command, args, { windowsHide: true, stdio: 'inherit', timeout: 600000 });
await mkdir(cache, { recursive: true });
if (!await stat(archive).catch(() => null)) {
  run('curl.exe', ['--fail', '--location', '--silent', '--show-error', '--max-time', '90', '--output', archive, `https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/${version}`]);
}
if (createHash('sha256').update(await readFile(archive)).digest('hex') !== sha256) throw new Error('Unexpected WebView2 SDK digest');
run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${sdk.replaceAll("'", "''")}' -Force`]);
await mkdir(out, { recursive: true });
const headers = join(sdk, 'build/native/include');
const idl = await readFile(join(headers, 'WebView2.h'), 'utf8');
const source = await readFile('src/webview2/host.cpp', 'utf8');
const names = new Set(Array.from(source.matchAll(/(?:callback<|__uuidof\()(ICoreWebView2\w*)/g), item => item[1]));
const declarations = [];
for (const name of names) {
  const id = new RegExp(`MIDL_INTERFACE\\("([a-fA-F0-9-]+)"\\)\\s+${name}\\s*:`).exec(idl)?.[1];
  if (!id) throw new Error(`Missing SDK interface ID for ${name}`);
  const [a, b, c, d, e] = id.split('-');
  declarations.push(`__CRT_UUID_DECL(${name}, ${[a, b, c, ...(d + e).match(/../g)].map(part => `0x${part}`).join(', ')})`);
}
await writeFile(join(cache, 'webview2-iids.h'), declarations.join('\n') + '\n');
await writeFile(join(cache, 'node-runtime-args.h'), `constexpr wchar_t ScheduleNodeArgs[] = L${JSON.stringify(' ' + v8MemoryArgs.join(' '))};\n`);
run(compiler, ['c++', '-target', 'x86_64-windows-gnu', '-std=c++17', '-fms-extensions', '-Os', '-s', '-municode', '-Wl,--subsystem,windows', '-DUNICODE', '-D_UNICODE', '-I', 'src/webview2/sdk-compat', '-I', headers, '-I', cache, 'src/webview2/host.cpp', '-lole32', '-luuid', '-ldcomp', '-lshell32', '-luser32', '-lgdi32', '-ladvapi32', '-o', join(out, 'codingSchedule-webview2.exe')]);
await copyFile(join(sdk, 'build/native/x64/WebView2Loader.dll'), join(out, 'WebView2Loader.dll'));
for (const name of ['LICENSE.txt', 'NOTICE.txt']) await copyFile(join(sdk, name), join(out, `WebView2-${name}`));
await build({ entryPoints: ['src/webview2/main.ts'], outfile: join(out, 'main.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node24', mainFields: ['module', 'main'] });
await build({ entryPoints: ['src/webview2/renderer.ts'], outfile: join(out, 'renderer/app.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome120' });
for (const name of ['index.html', 'styles.css']) await copyFile(join('src/renderer', name), join(out, 'renderer', name));
