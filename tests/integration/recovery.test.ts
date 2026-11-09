import {expect,test} from 'vitest';
import {RestartPolicy,collectorHealth} from '../../src/collector/supervisor.js';
test('crash restart delays bounded 1/2/5 seconds; explicit retry resets; health separate from task progress',()=>{
  const policy=new RestartPolicy();expect([policy.nextDelay(),policy.nextDelay(),policy.nextDelay(),policy.nextDelay()]).toEqual([1000,2000,5000,null]);policy.reset();expect(policy.nextDelay()).toBe(1000);
  expect(collectorHealth(1000,31000)).toBe('ok');expect(collectorHealth(1000,31001)).toBe('offline');
});
