import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { expect,test } from 'vitest';
test('real hook process fails open silently within deadline; reporting tools filtered',()=>{
  for(const input of ['{}','not-json',JSON.stringify({tool_name:'progress_report'})]){
    const start=performance.now(),child=spawnSync(process.execPath,['integrations/hooks/claude.cjs','--credential','missing','--endpoint','missing'],{input,encoding:'utf8',windowsHide:true});
    expect(child.status).toBe(0);expect(child.stdout).toBe('');expect(child.stderr).toBe('');expect(performance.now()-start).toBeLessThanOrEqual(750);
  }
});
