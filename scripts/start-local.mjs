// Production entry point included in the portable Windows distribution.
import { createServer, request as proxyRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, mkdir, symlink, link, stat, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root=dirname(fileURLToPath(import.meta.url)),home=join(process.env.LOCALAPPDATA??root,'Cyrene'),children=[];
// Junctions are recreated at the installed location, so the archive contains
// no absolute links to the developer's checkout and needs no administrator.
const links=JSON.parse(await readFile(join(root,'runtime-links.json'),'utf8'));
for(const item of links){
  const path=resolve(root,item.path),target=resolve(root,item.target);
  for(const value of [path,target]){const rel=relative(root,value);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Invalid packaged runtime link');}
  const entry=await lstat(path).catch(error=>{if(error.code==='ENOENT')return undefined;throw error;});
  // Moving a previously started portable directory leaves absolute junctions.
  // Replace the link itself; never remove its destination or a real directory.
  if(entry?.isSymbolicLink()&&await realpath(path).catch(()=>null)!==await realpath(target))await unlink(path);
  if(!existsSync(path)){await mkdir(dirname(path),{recursive:true});if(item.directory)await symlink(target,path,process.platform==='win32'?'junction':'dir');else await link(target,path);}
}
const web=createServer(),webPort=Number(process.env.CYRENE_PORT??5180);
let closing=false;function close(){if(closing)return;closing=true;for(const p of children)p.kill();web.closeAllConnections();web.close();}
process.once('SIGINT',close);process.once('SIGTERM',close);process.once('exit',close);
await new Promise((resolve,reject)=>{web.once('error',reject);web.listen(webPort,'127.0.0.1',resolve);});
const hostToken=randomBytes(32).toString('hex'),mcpToken=randomBytes(32).toString('hex');
const controlPort=webPort+100,origin=`http://127.0.0.1:${webPort}`;
const env={...process.env,STUDIO_MODE:'local',STUDIO_CONTROL_PORT:String(controlPort),STUDIO_CONTROL_DATA_DIR:join(home,'control'),STUDIO_PUBLIC_ORIGINS:origin,STUDIO_LOCAL_API_TOKEN:mcpToken,STUDIO_NODE_PACKAGES_DIR:join(root,'node-packages'),CYRENE_ASSISTANT_HOME:join(home,'assistant'),CYRENE_ASSISTANT_CWD:process.env.CYRENE_ASSISTANT_CWD??home,CYRENE_ASSISTANT_TOKEN:hostToken,CYRENE_PYTHON_PATH:join(root,'navigator/python/python.exe'),CYRENE_STUDIO_MCP_URL:`http://127.0.0.1:${controlPort}/studio-mcp`,CYRENE_STUDIO_MCP_TOKEN:mcpToken};
await mkdir(home,{recursive:true});
function child(path,environment){const process=spawn(join(root,'node.exe'),[path],{cwd:root,env:environment,windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(process);process.stderr.resume();return process;}
const assistant=child(join(root,'navigator/assistant/dist/main.js'),env);
const endpoint=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Local assistant did not start')),20000);const lines=createInterface({input:assistant.stdout});lines.on('line',line=>{try{const v=JSON.parse(line);if(v.service==='cyrene-assistant'){clearTimeout(timer);lines.close();resolve(`http://127.0.0.1:${v.port}`);}}catch{}});assistant.once('error',reject);assistant.once('exit',()=>reject(new Error('Assistant stopped')));});
const control=child(join(root,'control.mjs'),{...env,STUDIO_ASSISTANT_HOST_URL:endpoint,STUDIO_ASSISTANT_HOST_TOKEN:hostToken});control.stdout.resume();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
web.on('request',async(req,res)=>{
  if(req.url?.startsWith('/studio-')||req.url?.startsWith('/api/')){const upstream=proxyRequest({hostname:'127.0.0.1',port:controlPort,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503);res.end('Local control unavailable');});req.pipe(upstream);res.once('close',()=>upstream.destroy());return;}
  try{if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}const url=new URL(req.url??'/',origin),base=join(root,'web'),file=resolve(base,'.'+decodeURIComponent(url.pathname));const rel=relative(base,file);if(rel.startsWith('..')||isAbsolute(rel)){res.writeHead(403);res.end();return;}const selected=await stat(file).then(s=>s.isFile()?file:join(base,'index.html')).catch(()=>join(base,'index.html'));res.writeHead(200,{'content-type':types[extname(selected)]??'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-cache'});if(req.method==='HEAD')res.end();else createReadStream(selected).pipe(res);}catch{res.writeHead(400);res.end();}
});
for(const p of children)p.once('exit',close);
let ready=false;
for(let i=0;i<100&&!closing;i++){try{const response=await fetch(origin+'/studio-team/v1/session',{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
if(!ready)throw new Error('Local control did not become ready. Check that the configured ports are available.');
console.log(`Cyrene workbench: ${origin}`);
if(process.env.CYRENE_NO_OPEN!=='1')spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Start-Process '${origin}'`],{windowsHide:true,stdio:'ignore'});
