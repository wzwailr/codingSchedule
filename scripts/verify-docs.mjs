import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const root=resolve(process.argv[2]||'.');
const files=(await readdir(root,{withFileTypes:true})).filter(item=>item.isFile()&&item.name.endsWith('.md')).map(item=>root+'/'+item.name);
async function walk(dir) { for (const item of await readdir(dir, { withFileTypes: true })) { const p = dir + '/' + item.name; if (item.isDirectory()) await walk(p); else if (p.endsWith('.md')) files.push(p); } }
await walk(root+'/docs');
let links = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const url = match[1]; if (/^(https?:|#)/.test(url)) continue;
    await stat(resolve(dirname(file), url.split('#')[0])); links++;
  }
}
console.log(JSON.stringify({ documents: files.length, localLinks: links, ok: true }));
