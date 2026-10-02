import type { DebateState, EngineEvent, ModelSpec } from "../../src/core/types";
import type { CatalogModel } from "../../src/core/catalog";
import type { ProviderDef } from "../../src/core/providers";

export type { CatalogModel, ProviderDef, ModelSpec };

export interface ModelDefaults {
  participants: ModelSpec[];
  substitute: ModelSpec;
  consolidator: ModelSpec;
  consolidatorAlt: ModelSpec;
}

export interface CliStatus {
  binary: string;
  installed: boolean;
  path?: string;
  version?: string;
  login: "logged-in" | "logged-out" | "unknown" | "not-supported";
  loginDetail?: string;
}

export interface ProviderStatus {
  id: string;
  keyEnv?: string;
  keySet: boolean;
  keyHint?: string;
  keySource?: "secrets" | "env" | "cli";
  cli?: CliStatus;
}

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
  opener: string;
  participants: ModelSpec[];
  fake: boolean;
  fakeCount?: number;
  autoSubstitute: boolean;
  cycleOrder: "global" | "alternate";
  decisions: string[];
}

export interface UiConfig {
  version: string;
  debatesRoot: string;
  configDir: string;
  models: ModelDefaults;
  rounds: number;
  autoSubstitute: boolean;
  fakeModels: ModelDefaults;
  catalog: CatalogModel[];
  providers: ProviderDef[];
  pathAdded: string[];
  platform: string;
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
  settingsStatus(): Promise<ProviderStatus[]>;
  setKey(name: string, value: string): Promise<ProviderStatus[]>;
  testProvider(id: string): Promise<{ ok: boolean; detail: string }>;
  login(id: string): Promise<string>;
  saveSettings(s: { models: ModelDefaults; rounds?: number; autoSubstitute?: boolean; debatesRoot?: string }): Promise<{ ok: boolean }>;
  openPath(target: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  onEvent(cb: (ev: UiEvent) => void): () => void;
}

declare global {
  interface Window {
    api: Api;
  }
}
