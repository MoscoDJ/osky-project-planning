import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelSpec } from "./types.js";
import { exists, safeJsonParse } from "./fsutil.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { KimiAdapter } from "./adapters/kimi.js";
import { FakeAdapter } from "./adapters/fake.js";
import { Registry } from "./adapters/registry.js";

export interface AppConfig {
  configDir: string;
  debatesRoot: string;
  paths: { claude: string; codex: string; gemini: string };
  models: {
    A: ModelSpec;
    B: ModelSpec;
    substitute: ModelSpec;
    consolidator: ModelSpec;
    consolidatorAlt: ModelSpec;
  };
  kimi: { baseUrl: string; apiKeyEnv: string };
  turnTimeoutMs: number;
  changeRatioThreshold: number;
  autoSubstitute: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  configDir: path.join(os.homedir(), ".config", "osky-debate"),
  debatesRoot: path.join(os.homedir(), "debates"),
  paths: { claude: "claude", codex: "codex", gemini: "gemini" },
  models: {
    A: { adapter: "claude", model: "claude-fable-5-1", effort: "high", label: "Claude Fable 5.1" },
    B: { adapter: "codex", model: "gpt-6-astra", effort: "high", label: "GPT-6 Astra" },
    substitute: { adapter: "kimi", model: "kimi-k3", label: "Kimi K3" },
    consolidator: { adapter: "gemini", model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    consolidatorAlt: { adapter: "kimi", model: "kimi-k3", label: "Kimi K3" },
  },
  kimi: { baseUrl: "https://inference.do-ai.run/v1", apiKeyEnv: "DO_INFERENCE_API_KEY" },
  turnTimeoutMs: 20 * 60 * 1000,
  changeRatioThreshold: 0.6,
  autoSubstitute: true,
};

export const FAKE_MODELS = {
  A: { adapter: "fake", model: "fake-a", label: "Simulado A" } as ModelSpec,
  B: { adapter: "fake", model: "fake-b", label: "Simulado B" } as ModelSpec,
  substitute: { adapter: "fake", model: "fake-kimi", label: "Simulado Kimi" } as ModelSpec,
  consolidator: { adapter: "fake", model: "fake-gemini", label: "Simulado Gemini" } as ModelSpec,
  consolidatorAlt: { adapter: "fake", model: "fake-kimi", label: "Simulado Kimi" } as ModelSpec,
};

function deepMerge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

/** Carga secrets.env (KEY=VALUE) en process.env sin pisar variables ya definidas. */
export async function loadSecrets(configDir: string): Promise<void> {
  const file = path.join(configDir, "secrets.env");
  if (!(await exists(file))) return;
  const content = await fs.readFile(file, "utf8");
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!process.env[key]) process.env[key] = val;
  }
}

export async function loadConfig(configDir = DEFAULT_CONFIG.configDir): Promise<AppConfig> {
  let cfg: AppConfig = { ...DEFAULT_CONFIG, configDir };
  const file = path.join(configDir, "config.json");
  if (await exists(file)) {
    const parsed = safeJsonParse(await fs.readFile(file, "utf8"));
    if (parsed === undefined) throw new Error(`config.json inválido en ${file}`);
    cfg = deepMerge(cfg, parsed);
  }
  await loadSecrets(configDir);
  return cfg;
}

export function createRegistry(cfg: AppConfig, fake?: FakeAdapter): Registry {
  return new Registry([
    new ClaudeAdapter({ binary: cfg.paths.claude }),
    new CodexAdapter({ binary: cfg.paths.codex }),
    new GeminiAdapter({ binary: cfg.paths.gemini }),
    new KimiAdapter({ baseUrl: cfg.kimi.baseUrl, apiKeyEnv: cfg.kimi.apiKeyEnv }),
    fake ?? new FakeAdapter(),
  ]);
}
