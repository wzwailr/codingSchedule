import {access,mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve,join,dirname} from 'node:path';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {build} from 'esbuild';
if(process.platform==='win32'){
 const folder='zig-x86_64-windows-0.15.2',candidates=[process.env.SCHEDULE_RELAY_ZIG,resolve('.artifacts/relay-compiler/fast',folder,'zig.exe'),resolve('.artifacts/relay-compiler',folder,'zig.exe')].filter(Boolean);let compiler;
 for(const p of candidates)try{await access(p);compiler=p;break;}catch{/* Try the next verified cache. */}
 if(!compiler)throw new Error('Relay compiler unavailable; fetch the pinned Zig 0.15.2 compiler first.');
 if(execFileSync(compiler,['version'],{encoding:'utf8',windowsHide:true}).trim()!=='0.15.2')throw new Error('Unexpected relay compiler version');
 await mkdir('dist/bridge',{recursive:true});const output=resolve('dist/bridge/mcp-relay.exe');
 const generated=resolve('.artifacts/relay-manifest');await mkdir(generated,{recursive:true});const manifest=join(generated,'generate.mjs');await build({entryPoints:['scripts/relay-manifest.ts'],outfile:manifest,bundle:true,platform:'node',format:'esm',packages:'external'});execFileSync(process.execPath,[manifest,join(generated,'mcp-manifest.h')],{windowsHide:true,timeout:15000,stdio:'pipe'});
 execFileSync(compiler,['cc','-target','x86_64-windows-gnu','-Os','-fno-builtin','-fno-stack-protector','-nostdlib','-isystem',join(dirname(compiler),'lib/libc/include/any-windows-any'),'-I',generated,'-Wl,-e,mainCRTStartup','-Wl,--subsystem,windows',resolve('src/bridge/native-relay.c'),'-lkernel32','-lshell32','-lwinhttp','-o',output],{windowsHide:true,timeout:120000,stdio:'pipe'});
 await writeFile(join('dist/bridge','mcp-relay-build.json'),JSON.stringify({compiler:'Zig 0.15.2 cc',target:'x86_64-windows-gnu',runtime:'Win32 system libraries; no CRT or managed runtime',sourceSha256:createHash('sha256').update(await readFile('src/bridge/native-relay.c')).digest('hex'),jsonParserSha256:createHash('sha256').update(await readFile('src/bridge/native-json.h')).digest('hex'),toolManifestSha256:createHash('sha256').update(await readFile(join(generated,'mcp-manifest.h'))).digest('hex'),sha256:createHash('sha256').update(await readFile(output)).digest('hex')},null,2));
 console.log('Built bounded Win32 MCP facade with generated SDK tool manifest.');
}
