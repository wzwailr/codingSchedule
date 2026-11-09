import {spawn} from 'node:child_process';import {resolve} from 'node:path';import {createInterface} from 'node:readline';
export function resourceSampler(){
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',resolve('scripts/measure-process.ps1'),'-Stream','-IncludeChildren'],{windowsHide:true,stdio:['pipe','pipe','pipe']});let pending=null,stderr='';
 child.stderr.on('data',b=>stderr+=b);child.on('error',e=>pending?.reject(e));child.on('exit',code=>{if(pending)pending.reject(new Error(`Resource sampler exited ${code}: ${stderr.slice(-1000)}`));});
 createInterface({input:child.stdout}).on('line',line=>{if(!pending)return;const p=pending;pending=null;clearTimeout(p.timer);try{const value=JSON.parse(line);if(value.error)p.reject(new Error('Resource sampler: '+value.error));else p.resolve(value);}catch(e){p.reject(e);}});
 return {measure(ids){if(pending)throw new Error('Concurrent sampler request');return new Promise((resolveResult,reject)=>{pending={resolve:resolveResult,reject,timer:setTimeout(()=>{pending=null;reject(new Error('Resource sampler timeout; benchmark is incomplete'));},30000)};child.stdin.write(ids.join(',')+'\n');});},close(){child.stdin.end();child.kill();}};
}
