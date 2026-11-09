import {expect,test} from 'vitest';
import {configuredSources} from '../../src/collector/sources.js';
test('ordinary launch detects known sources; isolated launch is opt-in and preserves explicit opt-out',()=>{
 expect(configuredSources(undefined,true).every(s=>s.enabled)).toBe(true);
 expect(configuredSources(undefined,false).every(s=>!s.enabled)).toBe(true);
 const saved={sources:[{provider:'codex',root:'C:\\custom',enabled:false}]};
 expect(configuredSources(saved,true).find(s=>s.provider==='codex')).toMatchObject({root:'C:\\custom',enabled:false});
});
