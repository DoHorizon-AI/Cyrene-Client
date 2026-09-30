import { mkdir, readdir, lstat, realpath, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { parseArgs } from 'node:util';

const {values}=parseArgs({options:{navigator:{type:'string'},output:{type:'string'}}});
if(!values.navigator||!values.output)throw new Error('Usage: node scripts/package-assistant.mjs --navigator PATH --output NEW_DIRECTORY');
const client=process.cwd(),navigator=resolve(values.navigator),output=resolve(values.output);
if(existsSync(output))throw new Error('Output directory must not exist; choose a new package destination');
for(const path of ['dist/index.html','node_modules/esbuild/package.json'])if(!existsSync(join(client,path)))throw new Error('Build the Client before packaging');
for(const path of ['assistant/dist/main.js','harness/dist/assistant-bridge.js','.upstream/deepseek-harness/apps/cli/lib/bin.js','.venv/Scripts/python.exe'])if(!existsSync(join(navigator,path)))throw new Error(`Navigator runtime is not built: ${path}`);
const python=spawnSync(join(navigator,'.venv/Scripts/python.exe'),['-X','utf8','-c','import sys; print(sys.base_prefix)'],{encoding:'utf8',windowsHide:true});if(python.status!==0)throw new Error('Cannot locate packaged Python runtime');const pythonRoot=await realpath(python.stdout.trim());
const mappings=[{source:client,target:output},{source:navigator,target:join(output,'navigator')},{source:pythonRoot,target:join(output,'navigator/python')}];
const links=[];
function mapped(path){for(const {source,target} of mappings){const rel=relative(source,path);if(!rel.startsWith('..')&&!isAbsolute(rel))return join(target,rel);}throw new Error(`Runtime link points outside package inputs: ${path}`);}
async function copy(source,target){
  const info=await lstat(source);
  if(info.isSymbolicLink()){const original=await realpath(source),destination=mapped(original);links.push({path:relative(output,target),target:relative(output,destination),directory:(await lstat(original)).isDirectory()});return;}
  if(info.isDirectory()){await mkdir(target,{recursive:true});for(const item of await readdir(source)){if(['.git','.cache','__pycache__','.pytest_cache'].includes(item)||item.startsWith('_editable_')||item==='_virtualenv.pth')continue;await copy(join(source,item),join(target,item));}}else{await mkdir(dirname(target),{recursive:true});await copyFile(source,target);}
}
await mkdir(output,{recursive:true});
await build({entryPoints:[join(client,'apps/control/main.ts')],outfile:join(output,'control.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
for(const [source,target]of [[join(client,'dist'),join(output,'web')],[join(client,'node_modules'),join(output,'node_modules')],[join(client,'node-packages'),join(output,'node-packages')],[join(navigator,'assistant'),join(output,'navigator/assistant')],[join(navigator,'harness'),join(output,'navigator/harness')],[join(navigator,'src'),join(output,'navigator/src')],[join(navigator,'scripts/serve-persistence.py'),join(output,'navigator/scripts/serve-persistence.py')],[join(navigator,'.upstream/deepseek-harness'),join(output,'navigator/.upstream/deepseek-harness')],[pythonRoot,join(output,'navigator/python')]])await copy(source,target);
await copy(join(navigator,'.venv/Lib/site-packages'),join(output,'navigator/python/Lib/site-packages'));
await copyFile(process.execPath,join(output,'node.exe'));await copyFile(join(client,'scripts/start-local.mjs'),join(output,'start-local.mjs'));
await writeFile(join(output,'runtime-links.json'),JSON.stringify(links));await writeFile(join(output,'Cyrene.cmd'),'@echo off\r\n"%~dp0node.exe" "%~dp0start-local.mjs"\r\n');
await writeFile(join(output,'package-info.json'),JSON.stringify({version:1,builtAt:new Date().toISOString(),harness:JSON.parse(await readFile(join(navigator,'harness/upstream.lock.json'),'utf8'))},null,2));
console.log(`Portable Windows assistant written to ${output}. Run Cyrene.cmd; no compilation is performed on launch.`);
