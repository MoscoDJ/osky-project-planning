import type { DebateState, EngineEvent, ModelSpec } from "../../src/core/types";

export interface DebateSummary {
  workspace: string;
  title: string;
  phase: string;
  updatedAt: string;
  createdAt: string;
  turns: number;
}

export interface Snapshot {
  workspace: string;
  state: DebateState;
  plan: string;
  candidate: string | null;
  busy: string | null;
}

export type UiEvent =
  | EngineEvent
  | { type: "busy"; busy: string | null }
  | { type: "file"; file: string; content: string | null };

export interface CreateOptions {
  title: string;
  brief: string;
  rounds: number;
  allowWeb: boolean;
  contextDirs: string[];
  opener: "A" | "B" | "random";
  fake: boolean;
  autoSubstitute: boolean;
  cycleOrder: "global" | "alternate";
  decisions: string[];
}

export interface UiConfig {
  debatesRoot: string;
  models: { A: ModelSpec; B: ModelSpec; substitute: ModelSpec; consolidator: ModelSpec; consolidatorAlt: ModelSpec };
  fakeModels: { A: ModelSpec; B: ModelSpec; substitute: ModelSpec; consolidator: ModelSpec; consolidatorAlt: ModelSpec };
  pathAdded: string[];
}

export interface Api {
  config(): Promise<UiConfig>;
  listDebates(): Promise<DebateSummary[]>;
  createDebate(opts: CreateOptions): Promise<Snapshot>;
  openDebate(workspace: string): Promise<Snapshot>;
  snapshot(): Promise<Snapshot | null>;
  action(name: string, arg?: string): Promise<Snapshot>;
  turnDiff(n: number): Promise<string>;
  candidateDiff(): Promise<string>;
  pickDir(): Promise<string | null>;
  openPath(target: string): Promise<string>;
  onEvent(cb: (ev: UiEvent) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
