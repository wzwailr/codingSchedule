import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(await readFile('third_party/origins.json','utf8'));
if(!/^[0-9a-f]{40}$/.test(manifest.commit)||manifest.license!=='MIT')throw new Error('Invalid upstream pin');
await readFile('third_party/licenses/CCAM-MIT.txt');
for(const entry of manifest.entries){const bytes=await readFile(entry.path);if(!entry.sha256||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Origin manifest drift: '+entry.path);}
console.log(JSON.stringify({entries:manifest.entries.length,commit:manifest.commit,ok:true}));
