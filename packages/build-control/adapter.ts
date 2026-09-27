import type { Build, BuildProfile, BuildResult } from "./contracts";

export interface BuildObservation {
  runId: string; url: string;
  state: "running" | "succeeded" | "failed" | "cancelled";
  message: string;
  result?: BuildResult;
}
export interface BuildAdapter {
  resolve(profile: BuildProfile, ref: string): Promise<string>;
  dispatch(build: Build): Promise<{ runId: string; url: string }>;
  /** null is not proof that a timed-out dispatch was rejected. */
  observe(build: Build): Promise<BuildObservation | null>;
  cancel(build: Build, runId: string): Promise<void>;
}
