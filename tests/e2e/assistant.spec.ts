import { expect, test } from '@playwright/test';

test('assistant preserves draft, attachment and approval while docking during a stream', async ({page}) => {
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/studio-team/v1/session',route=>route.fulfill({json:{authenticated:true,token:'fixture',mode:'local',actor:{id:'viewer',workspaceIds:['local'],scopes:['pipelines.read','pipelines.write']}}}));
  const session={id:'fixture-chat',runtime:'codex',cwd:'C:\\project',permission:'ask',state:'idle',title:'Fixture chat',updatedAt:Date.now()};
  const events:any[]=[];let submitted=0,approvalForAll=false;
  await page.route('**/studio-assistant/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/info'))return route.fulfill({json:{version:'cyrene.assistant.v1',cwd:'C:\\project',workspaceId:'local',providers:[],runtimes:[{id:'codex',available:true,models:[{id:'fixture',name:'Fixture model',efforts:['low','high'],images:true}]}]}});
    if(path.endsWith('/sessions'))return route.fulfill({json:route.request().method()==='POST'?session:[session]});
    if(path.endsWith('/attachments'))return route.fulfill({json:{id:'file-1',name:'node.ts',mediaType:'text/plain',size:10}});
    if(path.endsWith('/turns')){submitted++;session.state='running';events.push({seq:1,sessionId:session.id,turnId:'turn',requestId:'request',type:'text',data:{id:'answer',text:'Streaming answer',delta:true},time:Date.now()},{seq:2,sessionId:session.id,turnId:'turn',requestId:'request',type:'approval',data:{id:'approval-1',title:'Write node.ts',detail:{diff:'+ export const node = 1'}},time:Date.now()});return route.fulfill({json:{accepted:true}});}
    if(path.endsWith('/events')){const after=Number(new URL(route.request().url()).searchParams.get('after'));return route.fulfill({json:{session,events:events.filter(e=>e.seq>after)}});}
    if(path.endsWith('/approval-1')){approvalForAll=route.request().postDataJSON().forAll===true;events.push({seq:3,sessionId:session.id,turnId:'turn',requestId:'request',type:'approval-resolved',data:{id:'approval-1'},time:Date.now()});return route.fulfill({json:{accepted:true}});}
    if(path.endsWith('/stop')){session.state='idle';return route.fulfill({json:{accepted:true}});}
    return route.fulfill({status:404,json:{error:{message:'Unknown fixture endpoint'}}});
  });
  await page.goto('/');await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
  const chat=page.getByRole('region',{name:'AI Assistant',exact:true});
  await expect(chat).toContainText('当前工作空间: local');
  await chat.getByLabel('智能体',{exact:true}).selectOption('codex');
  await expect(chat.getByLabel('模型',{exact:true})).toHaveValue('fixture');
  await chat.getByLabel('权限模式').selectOption('full-access');
  await expect(chat.getByLabel('权限模式')).toHaveValue('full-access');
  await chat.getByLabel('权限模式').selectOption('ask');
  await chat.getByLabel('助手消息').fill('Create a node');await chat.getByLabel('发送消息').click();
  await expect(chat).toContainText('Streaming answer');await expect(chat.getByRole('button',{name:'允许本次'})).toBeVisible();
  await chat.getByLabel('助手消息').fill('Unsent draft');
  await chat.locator('input[type=file]').setInputFiles({name:'node.ts',mimeType:'text/plain',buffer:Buffer.from('const x=1;')});
  await expect(chat).toContainText('node.ts ×');
  await chat.getByLabel('在主页面打开').click();
  await expect(page.getByRole('tab',{name:'AI Assistant',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(chat.getByLabel('助手消息')).toHaveValue('Unsent draft');await expect(chat).toContainText('node.ts ×');
  await chat.getByLabel('停靠右侧').click();await expect(chat.getByLabel('助手消息')).toHaveValue('Unsent draft');
  await chat.getByRole('button',{name:'允许本轮全部'}).click();await expect(chat.getByRole('button',{name:'允许本轮全部'})).toHaveCount(0);
  await chat.getByLabel('停止生成').click();await expect(chat.getByLabel('发送消息')).toBeVisible();
  await chat.getByLabel('历史记录',{exact:true}).click();await chat.getByRole('button',{name:/Fixture chat/}).click();
  await expect(chat).toContainText('Streaming answer');
  expect(submitted).toBe(1);expect(approvalForAll).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:'test-results/assistant-docked.png',fullPage:true});
});

test('provider settings retain multiple models and never refill the saved key',async({page})=>{
  const providers:any[]=[];
  await page.route('**/studio-team/v1/session',r=>r.fulfill({json:{authenticated:true,token:'fixture',mode:'local',actor:{id:'viewer',workspaceIds:['local'],scopes:['pipelines.read']}}}));
  await page.route('**/studio-assistant/v1/info',r=>r.fulfill({json:{runtimes:[{id:'harness',available:true,models:[]}],providers,cwd:'C:\\project'}}));
  await page.route('**/studio-assistant/v1/sessions',r=>r.fulfill({json:[]}));
  await page.route('**/studio-assistant/v1/providers',r=>{const {apiKey,...provider}=r.request().postDataJSON();expect(apiKey).toBe('fixture-key');providers.push({...provider,credentialConfigured:true});return r.fulfill({json:providers[0]});});
  await page.goto('/');await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
  const chat=page.getByRole('region',{name:'AI Assistant',exact:true});await chat.getByLabel('助手设置').click();
  await chat.getByLabel('名称',{exact:true}).fill('My provider');await chat.getByLabel('Base URL',{exact:true}).fill('https://api.example.test/v1');await chat.getByLabel('API Key',{exact:true}).fill('fixture-key');
  await chat.getByLabel('模型 ID',{exact:true}).fill('first');await chat.getByRole('button',{name:'添加模型',exact:true}).click();await chat.getByLabel('模型 ID',{exact:true}).nth(1).fill('second');
  await chat.getByRole('button',{name:'保存提供方',exact:true}).click();await expect(chat.getByLabel('API Key',{exact:true})).toHaveValue('');
  expect(providers[0].models.map((m:any)=>m.id)).toEqual(['first','second']);
  await chat.getByRole('button',{name:'返回聊天',exact:false}).click();await expect(chat.getByLabel('模型',{exact:true})).toHaveValue('first');await chat.getByLabel('模型',{exact:true}).selectOption('second');
});

test('Chinese IME Enter does not submit',async({page})=>{
  await page.route('**/studio-team/v1/session',r=>r.fulfill({json:{authenticated:true,token:'fixture',mode:'local',actor:{id:'viewer',workspaceIds:['local'],scopes:['pipelines.read']}}}));
  await page.route('**/studio-assistant/v1/info',r=>r.fulfill({json:{runtimes:[],providers:[],cwd:'C:\\project'}}));
  await page.route('**/studio-assistant/v1/sessions',r=>r.fulfill({json:[]}));
  await page.goto('/');await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
  const input=page.getByLabel('助手消息');await input.fill('中文输入');
  await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});
  await expect(input).toHaveValue('中文输入');
});

test('Cursor and CodeBuddy appear as separate local agents with clear prerequisites',async({page})=>{
  await page.route('**/studio-team/v1/session',r=>r.fulfill({json:{authenticated:true,token:'fixture',mode:'local',actor:{id:'viewer',workspaceIds:['local'],scopes:['pipelines.read']}}}));
  await page.route('**/studio-assistant/v1/info',r=>r.fulfill({json:{runtimes:[
    {id:'cursor',available:false,reason:'Install Cursor Agent CLI and run agent login.',models:[]},
    {id:'codebuddy',available:false,reason:'Install CodeBuddy Code CLI.',models:[]}
  ],providers:[],cwd:'C:\\project'}}));
  await page.route('**/studio-assistant/v1/sessions',r=>r.fulfill({json:[]}));
  await page.goto('/');await page.getByRole('button',{name:'平台 MCP',exact:true}).click();
  const chat=page.getByRole('region',{name:'AI Assistant',exact:true}),agent=chat.getByLabel('智能体',{exact:true});
  await expect(agent.locator('option')).toContainText(['Cyrene · API','Codex','Claude Code','Cursor Agent','CodeBuddy Code']);
  await agent.selectOption('cursor');await expect(chat).toContainText('Install Cursor Agent CLI and run agent login.');
  await expect(chat.getByLabel('发送消息')).toBeDisabled();
  await agent.selectOption('codebuddy');await expect(chat).toContainText('Install CodeBuddy Code CLI.');
});
