import { expect, test } from '@playwright/test';
import { createNode } from '../../packages/pipeline-model';

test('assistant binds the visible draft and opens saved results without losing later edits', async ({page}) => {
  await page.route('**/studio-team/v1/session',r=>r.fulfill({json:{authenticated:true,token:'fixture',mode:'local',actor:{id:'viewer',workspaceIds:['local'],scopes:['pipelines.read','pipelines.write']}}}));
  const session={id:'workflow-chat',runtime:'codex',cwd:'C:\\project',permission:'ask',state:'idle',title:'Workflow chat',updatedAt:Date.now()};
  let submitted:any, record:any, events:any[]=[];
  let delay=false, requested=false, release!:()=>void;
  await page.route('**/studio-pipelines/v1/session',r=>r.fulfill({json:{token:'a'.repeat(64)}}));
  await page.route('**/studio-pipelines/v1/commands',async r=>{
    const body=r.request().postDataJSON();expect(body.name).toBe('pipelines.get');expect(body.input.pipelineId).toBe(submitted.workflow.pipelineId);
    if(delay){requested=true;await new Promise<void>(resolve=>{release=resolve;});delay=false;}
    return r.fulfill({json:{result:record}});
  });
  await page.route('**/studio-assistant/v1/**',async r=>{
    const path=new URL(r.request().url()).pathname;
    if(path.endsWith('/info'))return r.fulfill({json:{version:'cyrene.assistant.v1',cwd:'C:\\project',workspaceId:'local',providers:[],runtimes:[{id:'codex',available:true,models:[{id:'fixture',name:'Fixture',efforts:[],images:false}]}]}});
    if(path.endsWith('/sessions'))return r.fulfill({json:r.request().method()==='POST'?session:[]});
    if(path.endsWith('/turns')){
      submitted=r.request().postDataJSON();
      const document=structuredClone(submitted.workflow.document);
      document.nodes.push(createNode('compute','added-by-agent'));
      document.presentation.nodes['added-by-agent']={x:4000,y:4000};
      record={workspaceId:'local',graphRevision:2,layoutRevision:2,document,updatedBy:'local-mcp',updatedAt:new Date().toISOString()};
      events=[{seq:1,sessionId:session.id,turnId:'turn',requestId:submitted.requestId,type:'tool',time:Date.now(),data:{id:'patch',name:'pipelines.patch',status:'completed',detail:{content:[],structuredContent:{record,summary:['Added node']}}}}];
      return r.fulfill({json:{accepted:true}});
    }
    if(path.endsWith('/events')){const after=Number(new URL(r.request().url()).searchParams.get('after'));return r.fulfill({json:{session,events:events.filter(e=>e.seq>after)}});}
    return r.fulfill({status:404,json:{error:{message:'Unknown endpoint'}}});
  });
  await page.goto('/');
  const name=page.getByLabel('流水线名称');await name.fill('当前画布');
  await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
  const chat=page.getByRole('region',{name:'AI Assistant',exact:true});
  await expect(chat).toContainText('当前流程: 当前画布');
  await chat.getByLabel('智能体',{exact:true}).selectOption('codex');
  await chat.getByLabel('助手消息').fill('添加一个算力节点');await chat.getByLabel('发送消息').click();
  await expect(chat.getByRole('button',{name:'在画布中查看'})).toBeVisible();
  expect(submitted.workflow).toMatchObject({pipelineId:'instruction-tuning',name:'当前画布',hasLocalChanges:true});
  expect(submitted.workflow.document.nodes).toHaveLength(7);
  await chat.getByLabel('在主页面打开').click();
  await name.fill('等待回复时的新编辑');
  delay=true;await chat.getByRole('button',{name:'在画布中查看'}).click();
  await expect.poll(()=>requested).toBe(true);
  await name.fill('读取期间的新编辑');release();
  await expect(chat).toContainText('读取期间画布已修改或切换');
  await expect(name).toHaveValue('读取期间的新编辑');
  page.once('dialog',d=>d.dismiss());await chat.getByRole('button',{name:'在画布中查看'}).click();
  await expect(name).toHaveValue('读取期间的新编辑');
  page.once('dialog',d=>d.accept());await chat.getByRole('button',{name:'在画布中查看'}).click();
  await expect(page.getByRole('tab',{name:/instruction-tuning.pipeline/})).toHaveAttribute('aria-selected','true');
  await expect(name).toHaveValue('当前画布');
  await expect(page.locator('.canvas-toolbar')).toContainText('8 节点');
  await expect(page.locator('.ide-version')).toContainText('服务端 v2 / 布局 v2 · 已同步');
  // Check pixels inside the actual canvas: toolbar counts alone do not prove nodes rendered.
  await expect.poll(()=>page.locator('canvas[aria-label="流水线编辑画布"]').evaluate((canvas:HTMLCanvasElement)=>{const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;let ports=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>180&&pixels[i]<170&&pixels[i+2]<170)ports++;return ports;})).toBeGreaterThan(3);
  const backups=await page.evaluate(async()=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('cyrene-studio-recovery',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<any[]>((resolve,reject)=>{const r=db.transaction('drafts').objectStore('drafts').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}finally{db.close();}});
  expect(backups.some(row=>row.document.name==='读取期间的新编辑'&&row.document.nodes.length===7)).toBe(true);
  // A clean loaded workflow follows MCP revisions; later local edits prevent replacement.
  record=structuredClone(record);record.graphRevision=3;record.layoutRevision=3;
  record.document.nodes.push(createNode('compute','another-agent-node'));record.document.presentation.nodes['another-agent-node']={x:8000,y:8000};
  await expect(page.locator('.ide-version')).toContainText('服务端 v3 / 布局 v3 · 已同步');
  await expect(page.locator('.canvas-toolbar')).toContainText('9 节点');
  await name.fill('保留我的本地修改');
  record=structuredClone(record);record.graphRevision=4;record.document.name='服务端的新名称';
  await expect(page.locator('.pipeline-conflict')).toContainText('服务端已有新版本 v4/3');
  await expect(name).toHaveValue('保留我的本地修改');
  await page.screenshot({path:'test-results/assistant-workflow-opened.png',fullPage:true});
});
