import { expect, test } from 'vitest';
import { examplePipeline } from '../../packages/pipeline-model';
import { changedWorkflow, workflowContext } from '../../apps/web/src/assistant/workflow';
import type { AssistantEvent } from '../../apps/web/src/assistant/types';

test('workflow snapshot freezes local edits with the matching server baseline', () => {
  const document=examplePipeline();
  const record={workspaceId:'local',graphRevision:5,layoutRevision:4,document:structuredClone(document),updatedBy:'test',updatedAt:new Date().toISOString()};
  document.name='Local edits';
  const snapshot=workflowContext(document,record,'training');
  document.name='Later edit';
  expect(snapshot.document.name).toBe('Local edits');
  expect(snapshot.hasLocalChanges).toBe(true);
  expect(snapshot.graphRevision).toBe(5);
  expect(workflowContext(document,{...record,document:{...record.document,id:'other'}},null).graphRevision).toBeUndefined();
});

test('only successful persisted workflow results offer a canvas link', () => {
  const record={workspaceId:'local',graphRevision:5,layoutRevision:4,document:examplePipeline(),updatedBy:'test',updatedAt:new Date().toISOString()};
  const event:AssistantEvent={seq:1,sessionId:'test',turnId:'test',requestId:'test',time:Date.now(),type:'tool',data:{name:'pipelines.patch',status:'completed',detail:{structuredContent:{record}}}};
  expect(changedWorkflow(event)?.document.id).toBe(record.document.id);
  expect(changedWorkflow({...event,data:{...event.data,status:'failed'}})).toBeUndefined();
  expect(changedWorkflow({...event,data:{...event.data,detail:{isError:true,structuredContent:{record}}}})).toBeUndefined();
  expect(changedWorkflow({...event,data:{...event.data,name:'pipelines.preview_layout'}})).toBeUndefined();
});
