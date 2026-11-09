import {mkdir,readFile,readdir,writeFile,copyFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
const out='.artifacts/distribution';await mkdir(join(out,'licenses'),{recursive:true});
const lock=JSON.parse(await readFile('package-lock.json','utf8')),dependencies=[];
for(const [path,pkg] of Object.entries(lock.packages)){
 if(!path||pkg.dev)continue;
 const names=(await readdir(path)).filter(n=>/^(licen[sc]e|notice|copying)([.-]|$)/i.test(n));
 if(!names.length)throw new Error(`Missing dependency license: ${path}`);
 const name=path.slice(path.lastIndexOf('node_modules/')+13),files=[];
 for(const file of names){const target=name.replaceAll('/','__')+'-'+basename(file);await copyFile(join(path,file),join(out,'licenses',target));files.push('licenses/'+target);}
 dependencies.push({name,version:pkg.version,license:pkg.license??'see license files',files});
}
await writeFile(join(out,'dependencies.json'),JSON.stringify({scope:'Bundled production npm dependencies; Electron/Chromium and embedded Node notices are adjacent resources',dependencies},null,2));
console.log(JSON.stringify({dependencies:dependencies.length,output:out}));
