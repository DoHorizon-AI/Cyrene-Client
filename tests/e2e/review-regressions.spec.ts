import { test, expect } from '@playwright/test';
import { examplePipeline } from '../../packages/pipeline-model';

test('untrusted transcript is passive and pending legacy writes cannot cross documents', async ({page}) => {
const session={id:'review-session',runtime:'codex',cwd:'C:\\review',permission:'ask',state:'idle',title:'Review fixture',updatedAt:Date.now()};
let imageRequests=0,polls=0; const toolWrites:any[]=[],legacyTurns:any[]=[];
const events:any[]=[{seq:1,sessionId:session.id,turnId:'t',requestId:'r',type:'text',time:Date.now(),data:{id:'answer',text:'![synthetic](https://audit-image.invalid/pixel?data=synthetic-only)'}}];
await page.route('**/*',async route=>{
 const q=route.request(),u=new URL(q.url()),p=u.pathname;
 if(u.hostname==='audit-image.invalid'){imageRequests++;return route.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});}
 if(u.origin!=='http://127.0.0.1:5181')return route.abort();
 if(p==='/studio-team/v1/session')return route.fulfill({json:{authenticated:true,token:'a'.repeat(64),mode:'local',actor:{id:'review',workspaceIds:['local'],scopes:['pipelines.read','pipelines.write']}}});
 if(p==='/studio-mcp/v1/info')return route.fulfill({json:{protocolVersion:'2025-11-25',readOnly:false,assistant:{configured:true,model:'fixture'}}});
 if(p==='/studio-mcp'){
  if(q.method()!=='POST')return route.fulfill({status:405});
  const rpc=q.postDataJSON();if(rpc.id===undefined)return route.fulfill({status:202});
  let result;
  if(rpc.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'review',version:'1'}};
  if(rpc.method==='tools/list')result={tools:[{name:'pipelines.patch',inputSchema:{type:'object',properties:{workspaceId:{type:'string'},pipelineId:{type:'string'}}},annotations:{readOnlyHint:false}}]};
  if(rpc.method==='tools/call'){toolWrites.push(rpc.params);result={content:[{type:'text',text:'{}'}],structuredContent:{}};}
  return route.fulfill({json:{jsonrpc:'2.0',id:rpc.id,result}});
 }
 if(p==='/studio-assistant/v1/turn'){const body=q.postDataJSON();legacyTurns.push(body);return route.fulfill({json:{message:{role:'assistant',content:'Edit pipeline A'},calls:legacyTurns.length===1?[{id:'call-a',name:'pipelines.patch',readOnly:false,arguments:{workspaceId:'local',pipelineId:'instruction-tuning',expectedGraphRevision:1,expectedLayoutRevision:1,idempotencyKey:'review',edits:[{op:'rename',name:'old-target'}]}}]:[]}});}
 if(p.startsWith('/studio-assistant/v1/')){
  if(p.endsWith('/info'))return route.fulfill({json:{version:'cyrene.assistant.v1',cwd:'C:\\review',workspaceId:'local',providers:[],runtimes:[{id:'codex',available:true,models:[{id:'fixture',name:'Fixture',efforts:[],images:false}]}]}});
  if(p.endsWith('/sessions'))return route.fulfill({json:q.method()==='POST'?session:[session]});
  if(p.endsWith('/events')){polls++;const after=Number(u.searchParams.get('after'));return route.fulfill({json:{session,events:events.filter(e=>e.seq>after)}});}
  return route.fulfill({json:{}});
 }
 if(p.startsWith('/studio-')||p.startsWith('/api/'))return route.fulfill({json:{}});
 return route.continue();
});

 await page.goto('/');
 await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
 const chat=page.getByRole('region',{name:'AI Assistant',exact:true});
 await chat.getByLabel('历史记录',{exact:true}).click();
 await chat.getByRole('button',{name:/Review fixture/}).click();
 await expect(chat).toContainText('图片未自动加载');
 await expect(chat.locator('.assistant-transcript img')).toHaveCount(0);
 expect(imageRequests).toBe(0);
 await chat.getByLabel('助手设置').click();
 const before=polls;
 await page.clock.install();
 await page.clock.fastForward(60_000);
 expect(polls).toBe(before);
 await chat.getByRole('button',{name:/返回聊天/}).click();
 await expect.poll(()=>polls).toBeGreaterThan(before);
 await chat.getByRole('button',{name:'MCP',exact:true}).click();
 const mcp=page.getByRole('region',{name:'MCP 工作台',exact:true});
 await mcp.getByRole('button',{name:'连接 MCP',exact:true}).click();
 await mcp.getByLabel('助手任务').fill('Edit current pipeline');
 await mcp.getByRole('button',{name:'发送',exact:true}).click();
 await expect(mcp.getByRole('button',{name:'确认写操作',exact:true})).toBeVisible();
 const other=examplePipeline(); other.id='pipeline-b'; other.name='Pipeline B';
 await page.getByLabel('导入流程文件').setInputFiles({name:'b.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(other))});
 await expect(page.getByLabel('流水线名称')).toHaveValue('Pipeline B');
 await expect(mcp.getByRole('button',{name:'确认写操作',exact:true})).toHaveCount(0);
 await expect(mcp.getByRole('button',{name:'让 AI 根据结果继续',exact:true})).toHaveCount(0);
 expect(toolWrites).toEqual([]);
 await mcp.getByRole('button',{name:'连接 MCP',exact:true}).click();
 await mcp.getByLabel('助手任务').fill('Explain pipeline B');
 await mcp.getByRole('button',{name:'发送',exact:true}).click();
 await expect.poll(()=>legacyTurns.length).toBe(2);
 expect(legacyTurns[1].pipelineId).toBe('pipeline-b');
 expect(legacyTurns[1].messages.some((m:any)=>m.content==='Edit pipeline A')).toBe(false);
 expect(imageRequests).toBe(0);
});
