import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await import('./build-relay.mjs');
await mkdir('dist/probe', { recursive: true });
for (const name of ['main.cjs', 'worker.cjs', 'preload.cjs', 'widget.html']) {
  await copyFile('tests/fixtures/probe/' + name, 'dist/probe/' + name);
}
await build({ entryPoints: ['tests/fixtures/probe/mcp.mjs'], outfile: 'dist/probe/mcp.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node24' });
for (const entry of ['desktop/main','desktop/preload','collector/main','bridge/main','integration/remove-cli']) {
  await build({entryPoints:['src/'+entry+'.ts'],outfile:'dist/'+entry+'.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron'],mainFields:['module','main']});
}
await build({entryPoints:['src/integration/setup-cli.ts'],outfile:'dist/integration/setup-cli.cjs',bundle:true,platform:'node',format:'cjs',target:'node24',mainFields:['module','main']});
await mkdir('dist/renderer',{recursive:true});
for(const name of ['index.html','styles.css','themes.css'])await copyFile('src/renderer/'+name,'dist/renderer/'+name);
await build({entryPoints:['src/renderer/app.ts'],outfile:'dist/renderer/app.js',bundle:true,platform:'browser',format:'iife',target:'chrome145'});
console.log('Built production widget, collector and isolated capability sample.');
