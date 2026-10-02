import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelSpec } from "./types.js";
import { exists, safeJsonParse } from "./fsutil.js";
import { ClaudeAdapter } from "./adapters/claude.js";
import { CodexAdapter } from "./adapters/codex.js";
import { GeminiAdapter } from "./adapters/gemini.js";
import { OpenAICompatAdapter } from "./adapters/openai-compat.js";
import { AnthropicAdapter } from "./adapters/anthropic.js";
import { ReplicateAdapter } from "./adapters/replicate.js";
import { FakeAdapter } from "./adapters/fake.js";
import { Registry } from "./adapters/registry.js";
import type { SecretResolver } from "./adapters/types.js";
import { resolveSpecRef } from "./catalog.js";
import { normalizeSpec } from "./engine.js";
import { defaultConfigDir, getSecret, loadSecretsIntoEnv, migrateLegacyConfig } from "./secrets.js";

export interface ModelDefaults {
  /** Participantes por defecto de un debate nuevo, en orden (mínimo dos). */
  participants: ModelSpec[];
  substitute: ModelSpec;
  consolidator: ModelSpec;
  consolidatorAlt: ModelSpec;
}

export interface AppConfig {
  configDir: string;
  debatesRoot: string;
  paths: { claude: string; codex: string; gemini: string };
  models: ModelDefaults;
  rounds: number;
  turnTimeoutMs: number;
  changeRatioThreshold: number;
  autoSubstitute: boolean;
}

export const DEFAULT_MODELS: ModelDefaults = {
  participants: [resolveSpecRef("claude-fable-5.1@claude-code:cli-key"), resolveSpecRef("gpt-6-astra@codex:cli-login")],
  substitute: resolveSpecRef("kimi-k3@digitalocean:api"),
  consolidator: resolveSpecRef("gemini-3.1-pro@gemini-cli:cli-key"),
  consolidatorAlt: resolveSpecRef("kimi-k3@digitalocean:api"),
};

export const DEFAULT_CONFIG: AppConfig = {
  configDir: defaultConfigDir(),
  debatesRoot: path.join(os.homedir(), "debates"),
  paths: { claude: "claude", codex: "codex", gemini: "gemini" },
  models: DEFAULT_MODELS,
  rounds: 3,
  turnTimeoutMs: 20 * 60 * 1000,
  changeRatioThreshold: 0.6,
  autoSubstitute: true,
};

const fake = (model: string, label: string): ModelSpec => ({ adapter: "fake", model, label, provider: "fake", access: "api" });

export const FAKE_MODELS: ModelDefaults & { A: ModelSpec; B: ModelSpec } = {
  participants: [fake("fake-a", "Simulado A"), fake("fake-b", "Simulado B")],
  A: fake("fake-a", "Simulado A"),
  B: fake("fake-b", "Simulado B"),
  substitute: fake("fake-kimi", "Simulado Kimi"),
  consolidator: fake("fake-gemini", "Simulado Gemini"),
  consolidatorAlt: fake("fake-kimi", "Simulado Kimi"),
};

export function fakeParticipants(n: number): ModelSpec[] {
  return Array.from({ length: n }, (_, i) => fake(`fake-${String.fromCharCode(97 + i)}`, `Simulado ${String.fromCharCode(65 + i)}`));
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return base;
  const out: any = { ...(base as any) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

/** Acepta la forma antigua de config.json ({ models: { A, B, … } }) y la nueva. */
function normalizeModels(m: any): ModelDefaults {
  const out: any = { ...DEFAULT_MODELS, ...(m ?? {}) };
  if (!Array.isArray(out.participants)) {
    out.participants = m?.A && m?.B ? [m.A, m.B] : DEFAULT_MODELS.participants;
  }
  delete out.A;
  delete out.B;
  out.participants = out.participants.map(normalizeSpec);
  out.substitute = normalizeSpec(out.substitute);
  out.consolidator = normalizeSpec(out.consolidator);
  out.consolidatorAlt = normalizeSpec(out.consolidatorAlt);
  return out as ModelDefaults;
}

export async function loadConfig(configDir = DEFAULT_CONFIG.configDir): Promise<AppConfig> {
  await migrateLegacyConfig(configDir);
  let cfg: AppConfig = { ...DEFAULT_CONFIG, configDir };
  const file = path.join(configDir, "config.json");
  let parsed: any;
  if (await exists(file)) {
    parsed = safeJsonParse(await fs.readFile(file, "utf8"));
    if (parsed === undefined) throw new Error(`config.json inválido en ${file}`);
    const { models, ...rest } = parsed;
    cfg = deepMerge(cfg, rest);
    cfg.models = normalizeModels(models);
  }
  cfg.configDir = configDir;
  loadSecretsIntoEnv(configDir);
  return cfg;
}

/** Guarda en config.json los campos editables desde la app. */
export async function saveConfig(cfg: AppConfig): Promise<void> {
  await fs.mkdir(cfg.configDir, { recursive: true, mode: 0o700 });
  const { configDir: _dir, ...rest } = cfg;
  const file = path.join(cfg.configDir, "config.json");
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(rest, null, 2) + "\n");
  await fs.rename(tmp, file);
}

export function secretResolver(cfg: AppConfig): SecretResolver {
  return (name) => getSecret(cfg.configDir, name);
}

export function createRegistry(cfg: AppConfig, fakeAdapter?: FakeAdapter): Registry {
  const secrets = secretResolver(cfg);
  return new Registry([
    new ClaudeAdapter({ binary: cfg.paths.claude, secrets }),
    new CodexAdapter({ binary: cfg.paths.codex, secrets }),
    new GeminiAdapter({ binary: cfg.paths.gemini, secrets }),
    new OpenAICompatAdapter({ secrets }),
    new AnthropicAdapter({ secrets }),
    new ReplicateAdapter({ secrets }),
    fakeAdapter ?? new FakeAdapter(),
  ]);
}

/** Compatibilidad con código antiguo. */
export async function loadSecrets(configDir: string): Promise<void> {
  loadSecretsIntoEnv(configDir);
}
