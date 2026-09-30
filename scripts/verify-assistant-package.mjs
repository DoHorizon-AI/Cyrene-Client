// Run against an already-started portable package; uses no paid model service.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const {values}=parseArgs({options:{origin:{type:'string',default:'http://127.0.0.1:5180'}}});
const origin=values.origin;
const {token}=await (await fetch(origin+'/studio-team/v1/session')).json();
assert.ok(token,'Local session must be available');
async function api(path,body){const response=await fetch(origin+'/studio-assistant/v1'+path,{method:body?'POST':'GET',headers:{'x-studio-control-token':token,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();assert.equal(response.ok,true,JSON.stringify(result));return result;}
const info=await api('/info');
assert.equal(info.runtimes.find(r=>r.id==='harness')?.available,true);
assert.ok(info.runtimes.some(r=>r.id==='cursor'),'Cursor Agent ACP adapter must be packaged');
assert.ok(info.runtimes.some(r=>r.id==='codebuddy'),'CodeBuddy Code ACP adapter must be packaged');
let requests=0;
const provider=createServer(async(req,res)=>{for await(const chunk of req){}requests++;res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{role:'assistant',content:'Portable Harness works'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'fixture',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:4,total_tokens:16}})+'\n\ndata: [DONE]\n\n');});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
try{
  await api('/providers',{id:'portable-fixture',name:'Portable fixture',protocol:'openai-completions',baseURL:`http://127.0.0.1:${provider.address().port}/v1`,models:[{id:'fixture',name:'Fixture',efforts:[],images:false,contextWindow:32768,maxTokens:512}]});
  const session=await api('/sessions',{requestId:randomUUID(),runtime:'harness',providerId:'portable-fixture',cwd:info.cwd,permission:'read-only'});
  await api(`/sessions/${session.id}/turns`,{requestId:randomUUID(),text:'Hello',model:'fixture',permission:'read-only'});
  let result;
  for(let i=0;i<120;i++){result=await api(`/sessions/${session.id}/events`);if(result.session.state!=='running')break;await new Promise(r=>setTimeout(r,500));}
  assert.equal(result.session.state,'idle',JSON.stringify(result.events));
  assert.ok(result.events.some(e=>e.type==='text'&&e.data.text.includes('Portable Harness works')),JSON.stringify(result.events));
  assert.equal(requests,1);
  console.log('Portable package passed: local session, scoped MCP, bundled Python, pinned Harness, API streaming.');
}finally{provider.closeAllConnections();provider.close();}
