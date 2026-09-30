import { describe,it,expect } from 'vitest';
import { createServer } from 'node:http';
import { assistantHostRequest,validateAssistantHost } from '../../apps/control/assistant-host';

describe('local assistant control boundary',()=>{
  it('requires loopback and refuses unauthorized workspace before forwarding',async()=>{
    expect(()=>validateAssistantHost({url:'https://example.com',token:'x'.repeat(32),connectionId:'local'})).toThrow();
    let forwarded=0;const server=createServer((_req,res)=>{forwarded++;res.writeHead(200,{'content-type':'application/json'});res.end('{}');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try{const port=(server.address() as {port:number}).port;await expect(assistantHostRequest({url:`http://127.0.0.1:${port}`,token:'x'.repeat(32),connectionId:'local'},{id:'alice',workspaceIds:['a'],scopes:['pipelines.read']},'b','GET','/sessions',undefined)).rejects.toThrow('Workspace');expect(forwarded).toBe(0);}finally{server.closeAllConnections();server.close();}
  });
  it('sends server-owned scope and does not retry uncertain mutations',async()=>{
    let forwarded=0;const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);expect(input.scope.actorId).toBe('alice');expect(input.scope.workspaceId).toBe('a');forwarded++;res.destroy();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    try{const port=(server.address() as {port:number}).port;await expect(assistantHostRequest({url:`http://127.0.0.1:${port}`,token:'x'.repeat(32),connectionId:'local'},{id:'alice',workspaceIds:['a'],scopes:['pipelines.read']},'a','POST','/sessions/x/turns',{text:'task'})).rejects.toThrow('not retried');expect(forwarded).toBe(1);}finally{server.closeAllConnections();server.close();}
  });
});
