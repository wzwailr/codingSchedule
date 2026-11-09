import {createHash} from 'node:crypto';import {createReadStream} from 'node:fs';import {readdir,stat,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const releaseRoot=resolve(process.argv[2]||'release');
const version=JSON.parse(await readFile('package.json','utf8')).version,files=[];
for(const name of await readdir(releaseRoot)){
 if(!name.startsWith(`codingSchedule-${version}-win-x64-`)||!(/\.(zip|exe)$/.test(name)))continue;
 const path=join(releaseRoot,name),hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
 files.push({file:name,bytes:(await stat(path)).size,sha256:hash.digest('hex'),signed:false});
}
if(files.length!==2)throw new Error('Expected portable ZIP and NSIS installer');
await writeFile(join(releaseRoot,'SHA256SUMS.txt'),files.map(f=>`${f.sha256}  ${f.file}`).join('\n')+'\n');
const portable=files.find(f=>f.file.endsWith('.zip')),checks=[{name:'portableZipBytes',value:portable.bytes,limit:180*1048576,pass:portable.bytes<=180*1048576}];
const codeHash=createHash('sha256');for await(const b of createReadStream(join(releaseRoot,'win-unpacked/resources/app.asar')))codeHash.update(b);
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
await writeFile(join(releaseRoot,'manifest.json'),JSON.stringify({version,sourceCommit,appAsarSha256:codeHash.digest('hex'),platform:'win32-x64',distribution:'unsigned internal candidate; V1 acceptance remains open',checks,files},null,2));
console.log(JSON.stringify({version,checks,files}));if(checks.some(c=>!c.pass))process.exitCode=1;
