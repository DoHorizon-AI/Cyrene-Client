import { parsePipeline, type Pipeline } from "../pipeline-model";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const graph = ({ presentation: _, ...p }: Pipeline) => p;
// A user can continue editing while a save is in flight. Preserve domains they
// changed, while incorporating untouched domains from the server's merged ack.
// 保存进行期间，用户仍可继续编辑。保留用户已更改的部分，并从服务器的合并确认中纳入未改动部分。
export function mergeSaveAcknowledgement(sent: Pipeline, current: Pipeline, acknowledged: Pipeline): Pipeline {
  if (current.id !== sent.id) return current;
  return parsePipeline({
    ...(same(graph(current), graph(sent)) ? graph(acknowledged) : graph(current)),
    presentation: same(current.presentation, sent.presentation) ? acknowledged.presentation : current.presentation,
  });
}
