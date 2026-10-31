export function controlListener(env: NodeJS.ProcessEnv) {
  const mode = env.STUDIO_MODE ?? "local", host = env.STUDIO_CONTROL_HOST ?? "127.0.0.1";
  if (mode !== "local" && mode !== "team") throw new Error("STUDIO_MODE must be local or team");
  if (mode === "local" && !["127.0.0.1", "::1"].includes(host)) throw new Error("Local control must bind a loopback address. Use team mode for network access.");
  return { mode, host } as { mode: "local" | "team"; host: string };
}
