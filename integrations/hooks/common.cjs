// No SDK, retries or model calls. Only opted-in async ETA hooks emit context.
const fs = require('node:fs');
const http = require('node:http');
module.exports = function hook() {
  const deadline = setTimeout(() => process.exit(0), 700);
  let text = '', size = 0;
  process.stdin.on('data', b => { size += b.length; if (size > 65536) process.exit(0); text += b; });
  process.stdin.on('end', () => {
    try {
      const body = JSON.parse(text);
      if (/progress_|codingSchedule/.test(String(body.tool_name || body.toolName || ''))) process.exit(0);
      const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
      if (!args.includes('--credential') || !args.includes('--endpoint')) process.exit(0);
      const estimate=args.includes('--estimate')&&body.hook_event_name==='PostToolUse';
      if(estimate)body.codingScheduleEstimate=true;
      const requestText=JSON.stringify(body);
      const credential = JSON.parse(fs.readFileSync(option('--credential'), 'utf8'));
      const endpoint = JSON.parse(fs.readFileSync(option('--endpoint'), 'utf8'));
      if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) process.exit(0);
      const req = http.request({host:'127.0.0.1',port:endpoint.port,path:'/v1/hook',method:'POST',headers:{Authorization:'Bearer '+credential.token,'X-Connector-Id':credential.connectorId,'Content-Type':'application/json','Content-Length':Buffer.byteLength(requestText)}},res=>{
        let response='',bytes=0;res.on('data',b=>{bytes+=b.length;if(bytes>8192)process.exit(0);response+=b;});
        res.on('end',()=>{clearTimeout(deadline);try{
          const result=JSON.parse(response);
          if(estimate&&res.statusCode===200&&typeof result.etaContext==='string'&&result.etaContext.length<=6000){
            const output=JSON.stringify({hookSpecificOutput:{hookEventName:'PostToolUse',additionalContext:result.etaContext}})+'\n';
            process.stdout.write(output,()=>process.exit(0));return;
          }
        }catch{/* Fail open without exposing errors in chat. */}process.exit(0);});
      });
      req.setTimeout(350,()=>req.destroy());req.on('error',()=>process.exit(0));req.end(requestText);
    } catch { process.exit(0); }
  });
  process.stdin.resume();
};
