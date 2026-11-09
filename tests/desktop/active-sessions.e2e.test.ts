import {_electron} from '@playwright/test';
import {expect,test} from 'vitest';
import {mkdtemp,writeFile,appendFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {sendLocal} from '../../src/bridge/transport.js';
import {createUuid7} from '../../src/domain/identity.js';
import type {RunHandle} from '../../src/shared/contracts.js';
test('new sessions appear without MCP reports, old turns stay hidden, closed selection follows other live work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'active-sessions-')),logs=join(dir,'logs');await mkdir(logs);
 const stamp=(r:object,old=false)=>JSON.stringify({...r,timestamp:new Date(Date.now()-(old?3600000:0)).toISOString()})+'\n';
 const turn=(id:string,old=false)=>stamp({type:'turn_context',payload:{turn_id:id}},old);
 const history=stamp({type:'session_meta',payload:{id:'history-session',cwd:'D:\\work\\历史项目'}},true)+Array.from({length:40},(_,i)=>turn('old-'+i,true)+stamp({type:'event_msg',payload:{type:'task_complete'}},true)).join('');
 await writeFile(join(logs,'history.jsonl'),history);await writeFile(join(dir,'settings.json'),JSON.stringify({sources:[{provider:'codex',root:logs,enabled:true},{provider:'claude',root:logs,enabled:true}]}));
 await writeFile(join(dir,'view.json'),JSON.stringify({activityView:'execution'}));
 const exe=process.env.SCHEDULE_TEST_PACKAGE_DIR;
 const app=await _electron.launch({...(exe?{executablePath:resolve(exe,'codingSchedule.exe')}:{}),args:exe?['--data-dir',dir]:['dist/desktop/main.cjs','--data-dir',dir]});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await expect.poll(()=>page.locator('#compact-title').textContent()).toBe('暂无活动会话');
  const a=join(logs,'new-codex.jsonl');await writeFile(a,stamp({type:'session_meta',payload:{id:'session-11112222',cwd:'D:\\work\\产品A'}})+stamp({type:'event_msg',payload:{type:'task_started',turn_id:'a'}})+turn('a'));
  await expect.poll(()=>page.locator('#compact-title').textContent(),{timeout:7000}).toContain('产品A');
  expect(await page.locator('#tasks option').count()).toBe(1);
  expect(await page.locator('#activity').textContent()).toBe('准备响应');
  expect(await page.locator('#progress').textContent()).toBe('进度未知');
  await appendFile(a,stamp({type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'work',arguments:'{}'}}));
  await expect.poll(()=>page.locator('#activity').textContent()).toBe('执行命令');
  await page.locator('#compact').hover();await page.waitForSelector('#details:not([hidden])');await page.locator('#pin').click();
  const b=join(logs,'new-claude.jsonl');await writeFile(b,stamp({type:'user',sessionId:'session-33334444',uuid:'b',cwd:'D:\\work\\产品B',message:{content:'go'}})+stamp({type:'assistant',sessionId:'session-33334444',message:{content:[{type:'tool_use',id:'read',name:'Read',input:{}}]}}));
  await expect.poll(()=>page.locator('#tasks option').count(),{timeout:7000}).toBe(2);
  await appendFile(b,stamp({type:'custom-title',sessionId:'session-33334444',customTitle:'Claude会话'}));
  await expect.poll(()=>page.locator('#tasks option').allTextContents(),{timeout:7000}).toContain('产品B · Claude会话');
  await page.locator('#tasks').selectOption({label:'产品A · 未命名会话'});
  await appendFile(a,stamp({type:'event_msg',payload:{type:'task_complete'}}));
  await expect.poll(()=>page.locator('#title').textContent()).toContain('产品B');expect(await page.locator('#tasks option').count()).toBe(1);
  await appendFile(a,turn('a-next')+stamp({type:'response_item',payload:{type:'function_call',name:'exec_command',call_id:'next',arguments:'{}'}}));
  await expect.poll(()=>page.locator('#tasks option').count()).toBe(2);
  await appendFile(b,stamp({type:'assistant',sessionId:'session-33334444',message:{content:[{type:'text',text:'done'}],stop_reason:'end_turn'}}));
  await expect.poll(()=>page.locator('#tasks option').count()).toBe(1);
  await page.clock.setFixedTime(Date.now()+600000);
  await expect.poll(()=>page.locator('#tasks option').count(),{timeout:6500}).toBe(1);
  expect(await page.locator('#title').textContent()).toContain('产品A');
  await appendFile(a,stamp({type:'event_msg',payload:{type:'task_complete'}}));
  await expect.poll(()=>page.locator('#tasks option').count()).toBe(0);
  // A newly ended selected task has a brief status acknowledgement, not a history row.
  await expect.poll(()=>page.locator('#compact-title').textContent(),{timeout:7000}).toBe('暂无活动会话');
 }finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},35000);

test('a saved session name and a correlated public marker produce one real window item with reporter progress',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'session-binding-')),logs=join(dir,'logs'),data=join(dir,'data');await mkdir(logs);await mkdir(data);
 const stamp=(record:object)=>JSON.stringify({...record,timestamp:new Date().toISOString()})+'\n',file=join(logs,'s.jsonl');
 await writeFile(join(dir,'session_index.jsonl'),JSON.stringify({id:'session-12345678',thread_name:'敏感性预警功能开发'})+'\n');
 await writeFile(join(data,'position.json'),JSON.stringify({x:24,y:24}));
 await writeFile(join(data,'settings.json'),JSON.stringify({sources:[{provider:'codex',root:logs,enabled:true},{provider:'claude',root:logs,enabled:false}]}));
 await writeFile(file,stamp({type:'session_meta',payload:{id:'session-12345678',cwd:'D:/work/project'}})+stamp({type:'event_msg',payload:{type:'task_started',turn_id:'turn'}}));
 const exe=process.env.SCHEDULE_TEST_PACKAGE_DIR,app=await _electron.launch({...(exe?{executablePath:resolve(exe,'codingSchedule.exe')}:{}),args:exe?['--data-dir',data]:['dist/desktop/main.cjs','--data-dir',data]});
 let stderr='';app.process().stderr?.on('data',chunk=>{stderr+=String(chunk);});
 try{
  const page=await app.firstWindow();await page.waitForSelector('#compact');await expect.poll(()=>page.locator('#compact-title').textContent(),{timeout:7000}).toBe('project · 敏感性预警功能开发');
  const paths={connectorId:'codex-reporter',credentialPath:join(data,'connectors',createHash('sha256').update('codex-reporter').digest('hex')+'.json'),endpointPath:join(data,'endpoint.json')};
  const begun=await sendLocal({...paths,operation:'begin',body:{idempotencyKey:createUuid7(Date.now()),title:'same reporter task',plan:{complete:true,revision:1,schedule:'serial',steps:[{id:'a',title:'done',weight:1,status:'completed',evidence:'declared'},{id:'b',title:'remaining',weight:1,status:'running',evidence:'declared'}]}}});expect(begun.status).toBe(200);
  const h=(begun.body as {handle:RunHandle}).handle;await expect.poll(()=>page.locator('#tasks option').count()).toBe(2);
  await appendFile(file,stamp({type:'response_item',payload:{type:'custom_tool_call',name:'exec',call_id:'binding',input:'const r=await tools.mcp__codingSchedule__progress_context({handle:load("private")});text({codingScheduleBinding:load("publicRef")});'}})+stamp({type:'response_item',payload:{type:'custom_tool_call_output',call_id:'binding',output:[{type:'input_text',text:'Script completed\nOutput:\n'},{type:'input_text',text:JSON.stringify({codingScheduleBinding:{runId:h.runId,generation:h.generation}})}]}}));
  await expect.poll(()=>page.locator('#tasks option').count()).toBe(1);await expect.poll(()=>page.locator('#compact-title').textContent()).toBe('project · 敏感性预警功能开发');
  expect(await page.locator('#progress').textContent()).toBe('50%');
  await writeFile(join(dir,'session_index.jsonl'),JSON.stringify({id:'session-12345678',thread_name:'会话已重命名'})+'\n');
  await expect.poll(()=>page.locator('#compact-title').textContent(),{timeout:6500}).toBe('project · 会话已重命名');
  await page.locator('#compact').dblclick();await page.waitForSelector('#settings:not([hidden])');
  await expect.poll(()=>page.locator('#native-run option').count()).toBe(1);expect(await page.locator('#native-run option').textContent()).toBe('project · 会话已重命名');
 }catch(error){await writeFile('.artifacts/session-identity-window-diagnostic.json',JSON.stringify({directory:dir,stderr,ui:await (await app.firstWindow()).locator('body').innerText()},null,2));throw error;}finally{await app.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
},25000);
