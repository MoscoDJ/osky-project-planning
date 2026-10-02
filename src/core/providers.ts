import type { AccessMode, AdapterId } from "./types.js";

export type CliBinary = "claude" | "codex" | "gemini";

export interface ProviderDef {
  id: string;
  label: string;
  kind: "cli" | "api";
  adapter: AdapterId;
  /** Modos de acceso que ofrece este proveedor. */
  access: AccessMode[];
  /** Variable de la clave en secrets.env (y la que se inyecta al CLI en modo cli-key). */
  keyEnv?: string;
  /** Dónde obtener la clave. */
  keyUrl?: string;
  /** API: URL base. */
  baseUrl?: string;
  /** CLI: ejecutable. */
  binary?: CliBinary;
  /** CLI: comando de login interactivo que se abre en una terminal. */
  loginCommand?: string[];
  /** Qué ofrece de búsqueda web para el modelo. */
  web: "native" | "plugin" | "none";
  notes?: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "claude-code",
    label: "Claude Code (CLI oficial de Anthropic)",
    kind: "cli",
    adapter: "claude",
    access: ["cli-login", "cli-key"],
    keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://platform.claude.com/settings/keys",
    binary: "claude",
    loginCommand: ["claude", "auth", "login"],
    web: "native",
    notes: "Con login usa la suscripción Pro/Max; con clave factura a la API. Edita el plan con sus propias herramientas.",
  },
  {
    id: "codex",
    label: "Codex CLI (CLI oficial de OpenAI)",
    kind: "cli",
    adapter: "codex",
    access: ["cli-login", "cli-key"],
    keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    binary: "codex",
    loginCommand: ["codex", "login"],
    web: "native",
    notes: "Con login usa la suscripción ChatGPT; con clave factura a la API de OpenAI.",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI (CLI oficial de Google)",
    kind: "cli",
    adapter: "gemini",
    access: ["cli-key"],
    keyEnv: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    binary: "gemini",
    web: "native",
    notes: "Solo con clave de Gemini API: Google dejó de servir cuentas personales (gratis, AI Pro, Ultra) en Gemini CLI el 18-jun-2026; su sucesor con login es Antigravity CLI.",
  },
  {
    id: "anthropic",
    label: "Anthropic API (oficial)",
    kind: "api",
    adapter: "anthropic",
    access: ["api"],
    keyEnv: "ANTHROPIC_API_KEY",
    keyUrl: "https://platform.claude.com/settings/keys",
    web: "native",
  },
  {
    id: "openai",
    label: "OpenAI API (oficial)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    keyUrl: "https://platform.openai.com/api-keys",
    web: "none",
  },
  {
    id: "google",
    label: "Google Gemini API (oficial, endpoint compatible con OpenAI)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
    keyUrl: "https://aistudio.google.com/apikey",
    web: "none",
  },
  {
    id: "xai",
    label: "xAI API (oficial)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://api.x.ai/v1",
    keyEnv: "XAI_API_KEY",
    keyUrl: "https://console.x.ai",
    web: "none",
  },
  {
    id: "moonshot",
    label: "Moonshot AI API (oficial, Kimi)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://api.moonshot.ai/v1",
    keyEnv: "MOONSHOT_API_KEY",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    web: "none",
  },
  {
    id: "deepseek",
    label: "DeepSeek API (oficial)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",
    keyUrl: "https://platform.deepseek.com/api_keys",
    web: "none",
  },
  {
    id: "alibaba",
    label: "Alibaba Model Studio (oficial, Qwen)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    keyEnv: "DASHSCOPE_API_KEY",
    keyUrl: "https://modelstudio.console.alibabacloud.com",
    web: "none",
  },
  {
    id: "zai",
    label: "Z.ai API (oficial, GLM)",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://api.z.ai/api/paas/v4",
    keyEnv: "ZAI_API_KEY",
    keyUrl: "https://z.ai/manage-apikey/apikey-list",
    web: "none",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    keyUrl: "https://openrouter.ai/settings/keys",
    web: "plugin",
    notes: "Un solo saldo para casi todos los modelos. Búsqueda web con el plugin web de OpenRouter.",
  },
  {
    id: "digitalocean",
    label: "DigitalOcean Serverless Inference",
    kind: "api",
    adapter: "openai-compat",
    access: ["api"],
    baseUrl: "https://inference.do-ai.run/v1",
    keyEnv: "DO_INFERENCE_API_KEY",
    keyUrl: "https://cloud.digitalocean.com/gen-ai/model-access-keys",
    web: "none",
  },
  {
    id: "replicate",
    label: "Replicate",
    kind: "api",
    adapter: "replicate",
    access: ["api"],
    baseUrl: "https://api.replicate.com/v1",
    keyEnv: "REPLICATE_API_TOKEN",
    keyUrl: "https://replicate.com/account/api-tokens",
    web: "none",
  },
];

export function getProvider(id: string | undefined): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** Proveedor por defecto para specs antiguos que no lo declaraban. */
export function providerForLegacy(adapter: AdapterId): string | undefined {
  switch (adapter) {
    case "claude":
      return "claude-code";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini-cli";
    case "kimi":
      return "digitalocean";
    case "anthropic":
      return "anthropic";
    default:
      return undefined;
  }
}

export const ACCESS_LABEL: Record<AccessMode, string> = {
  "cli-login": "CLI con login",
  "cli-key": "CLI con clave de API",
  api: "API",
};
