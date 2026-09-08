import { build } from 'vite-plus';
import { build as bundle } from 'esbuild';
import { resolve } from 'node:path';
import { sites } from '../packages/contracts/src/index.ts';
for(const site of sites) {
  const root=resolve('apps',site.id);
  await build({root,configFile:resolve(root,'vite.config.ts')});
}
await bundle({entryPoints:['apps/server/src/index.ts'],outfile:'dist/server.mjs',bundle:true,platform:'node',target:'node24',format:'esm',packages:'external'});
console.log('Built all sites and the single-port application server.');
