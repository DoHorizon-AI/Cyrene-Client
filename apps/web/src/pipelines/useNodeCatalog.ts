import { useEffect, useState } from "react";
import { packageSchema, compileContribution } from "../../../../packages/node-registry/contracts";
import { installDefinitions } from "../../../../packages/pipeline-model/catalog";

export function useNodeCatalog() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true, pending = false, known = -1;
    const refresh = async () => {
      if (pending) return; pending = true;
      try {
        const response = await fetch("/studio-catalog/v1/packages", { signal: AbortSignal.timeout(10000) });
        if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
        const body = await response.json();
        if (!active || body.revision === known || !Number.isSafeInteger(body.revision)) return;
        const packages = packageSchema.array().parse(body.packages);
        const activeKeys: string[] = Array.isArray(body.active) ? body.active : [];
        const compile = (items: typeof packages) => items.flatMap(pkg => pkg.nodes.map(n => compileContribution(n, pkg)));
        installDefinitions(compile(packages), compile(packages.filter(p => activeKeys.includes(`${p.id}@${p.version}`))));
        known = body.revision; setRevision(body.revision);
      } catch { /* Keep the last validated catalog while offline. */ }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return revision;
}
