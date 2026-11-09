import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
// Build-only dependency. This pinned official archive is never included in releases.
const version='0.15.2',folder='zig-x86_64-windows-'+version,archive=folder+'.zip',sha256='3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c',root=resolve('.artifacts/relay-compiler'),destination=join(root,'fast'),zip=join(root,'zig-mirror.zip');
await mkdir(root,{recursive:true});let bytes;
try{bytes=await readFile(zip);}catch{/* Download once, verify before extraction. */}
if(!bytes){
 const base=process.env.SCHEDULE_ZIG_MIRROR||'https://ziglang.org/download';
 const url=base.replace(/\/$/,'')+'/'+version+'/'+archive;
 execFileSync('curl.exe',['--fail','--location','--silent','--show-error','--connect-timeout','10','--max-time','300','--output',zip,url],{windowsHide:true,timeout:305000});bytes=await readFile(zip);
}
if(createHash('sha256').update(bytes).digest('hex')!==sha256)throw new Error('Pinned Zig archive SHA-256 mismatch; refusing extraction');
await mkdir(destination,{recursive:true});await access(join(destination,folder,'zig.exe')).catch(()=>execFileSync('tar.exe',['-xf',zip,'-C',destination],{windowsHide:true,timeout:120000}));
const compiler=join(destination,folder,'zig.exe');
if(execFileSync(compiler,['version'],{encoding:'utf8',windowsHide:true}).trim()!==version)throw new Error('Unexpected compiler version');
await writeFile(join(root,'manifest.json'),JSON.stringify({version,archive,sha256,compiler},null,2));
console.log('Verified build-only Zig '+version+' cache. Read its README and LICENSE before use.');
