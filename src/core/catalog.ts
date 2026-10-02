import type { AccessMode, ModelSpec } from "./types.js";
import { getProvider } from "./providers.js";

/**
 * Catálogo de modelos frontera (solo topes de gama) y las vías para usarlos.
 * Verificado el 2-oct-2026 contra las páginas oficiales de cada proveedor, el catálogo
 * público de OpenRouter y el listado de modelos de DigitalOcean con la clave del usuario.
 * Los precios son de la API oficial, en USD por millón de tokens de entrada / salida.
 */

export interface Offering {
  provider: string;
  access: AccessMode;
  /** Id del modelo en ese proveedor. */
  model: string;
  effort?: string;
  params?: Record<string, unknown>;
  /** Nota visible: cuotas, versión distinta, etc. */
  note?: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  vendor: string;
  priceIn: number;
  priceOut: number;
  contextK: number;
  notes?: string;
  offerings: Offering[];
}

export const CATALOG: CatalogModel[] = [
  {
    id: "claude-fable-5.1",
    label: "Claude Fable 5.1",
    vendor: "Anthropic",
    priceIn: 10,
    priceOut: 50,
    contextK: 1000,
    notes: "El modelo más capaz de Anthropic de disponibilidad general.",
    offerings: [
      { provider: "claude-code", access: "cli-key", model: "claude-fable-5-1", effort: "high", note: "Claude Code con clave de API: conserva herramientas, búsqueda web y lectura de carpetas de contexto." },
      { provider: "anthropic", access: "api", model: "claude-fable-5-1", effort: "high" },
      { provider: "claude-code", access: "cli-login", model: "claude-fable-5-1", effort: "high", note: "Pro: solo con créditos de uso. Max/Team premium: incluido hasta el 50% del límite semanal, después créditos." },
      { provider: "openrouter", access: "api", model: "anthropic/claude-fable-5.1", effort: "high" },
      { provider: "digitalocean", access: "api", model: "anthropic-claude-fable-5.1" },
    ],
  },
  {
    id: "claude-opus-5.5",
    label: "Claude Opus 5.5",
    vendor: "Anthropic",
    priceIn: 4,
    priceOut: 20,
    contextK: 1000,
    notes: "Opus actual; incluido en los límites normales de Pro y Max en Claude Code.",
    offerings: [
      { provider: "claude-code", access: "cli-login", model: "claude-opus-5-5", effort: "high", note: "Incluido en la suscripción Pro/Max." },
      { provider: "claude-code", access: "cli-key", model: "claude-opus-5-5", effort: "high" },
      { provider: "anthropic", access: "api", model: "claude-opus-5-5", effort: "high" },
      { provider: "openrouter", access: "api", model: "anthropic/claude-opus-5.5", effort: "high" },
      { provider: "digitalocean", access: "api", model: "anthropic-claude-opus-5.5" },
    ],
  },
  {
    id: "gpt-6-astra",
    label: "GPT-6 Astra",
    vendor: "OpenAI",
    priceIn: 10,
    priceOut: 50,
    contextK: 1050,
    notes: "Tope de gama de OpenAI.",
    offerings: [
      { provider: "codex", access: "cli-login", model: "gpt-6-astra", effort: "high", note: "Incluido en ChatGPT Plus (cupo reducido) y Pro." },
      { provider: "codex", access: "cli-key", model: "gpt-6-astra", effort: "high" },
      { provider: "openai", access: "api", model: "gpt-6-astra", effort: "high" },
      { provider: "openrouter", access: "api", model: "openai/gpt-6-astra", effort: "high" },
      { provider: "digitalocean", access: "api", model: "openai-gpt-6-astra" },
    ],
  },
  {
    id: "gemini-3.1-pro",
    label: "Gemini 3.1 Pro",
    vendor: "Google",
    priceIn: 2,
    priceOut: 12,
    contextK: 1048,
    notes: "Tope de gama de Google (preview). Gemini 3.5 Pro aún no está publicado.",
    offerings: [
      { provider: "gemini-cli", access: "cli-key", model: "gemini-3.1-pro-preview", note: "Gemini CLI ya no acepta login con cuenta de Google desde el 18-jun-2026; solo clave." },
      { provider: "google", access: "api", model: "gemini-3.1-pro-preview", effort: "high" },
      { provider: "openrouter", access: "api", model: "google/gemini-3.1-pro-preview", effort: "high" },
      { provider: "replicate", access: "api", model: "google/gemini-3.1-pro" },
    ],
  },
  {
    id: "grok-4.7",
    label: "Grok 4.7",
    vendor: "xAI",
    priceIn: 2,
    priceOut: 6,
    contextK: 500,
    offerings: [
      { provider: "xai", access: "api", model: "grok-4.7" },
      { provider: "openrouter", access: "api", model: "x-ai/grok-4.7", effort: "high" },
    ],
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    vendor: "Moonshot AI",
    priceIn: 3,
    priceOut: 15,
    contextK: 1000,
    offerings: [
      { provider: "digitalocean", access: "api", model: "kimi-k3" },
      { provider: "moonshot", access: "api", model: "kimi-k3" },
      { provider: "openrouter", access: "api", model: "moonshotai/kimi-k3" },
    ],
  },
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    vendor: "DeepSeek",
    priceIn: 0.66,
    priceOut: 1.98,
    contextK: 1000,
    offerings: [
      { provider: "deepseek", access: "api", model: "deepseek-v4-pro" },
      { provider: "openrouter", access: "api", model: "deepseek/deepseek-v4-pro-0813" },
      { provider: "digitalocean", access: "api", model: "deepseek-v4-pro-0813" },
    ],
  },
  {
    id: "qwen3.8-max",
    label: "Qwen3.8 Max",
    vendor: "Alibaba",
    priceIn: 2,
    priceOut: 6,
    contextK: 1000,
    offerings: [
      { provider: "alibaba", access: "api", model: "qwen3.8-max" },
      { provider: "openrouter", access: "api", model: "qwen/qwen3.8-max-0902" },
      { provider: "digitalocean", access: "api", model: "qwen3.8-max" },
    ],
  },
  {
    id: "glm-5.3",
    label: "GLM-5.3",
    vendor: "Z.ai",
    priceIn: 1.4,
    priceOut: 4.4,
    contextK: 1000,
    offerings: [
      { provider: "zai", access: "api", model: "glm-5.3" },
      { provider: "openrouter", access: "api", model: "z-ai/glm-5.3" },
      { provider: "digitalocean", access: "api", model: "glm-5.3" },
    ],
  },
];

export function getCatalogModel(id: string): CatalogModel | undefined {
  return CATALOG.find((m) => m.id === id);
}

export function offeringKey(o: Pick<Offering, "provider" | "access">): string {
  return `${o.provider}:${o.access}`;
}

/** Referencia compacta "catalogId@provider:access", usada en config.json y en la CLI. */
export function specRef(catalogId: string, o: Pick<Offering, "provider" | "access">): string {
  return `${catalogId}@${offeringKey(o)}`;
}

/** Construye el ModelSpec de una vía del catálogo. */
export function specFromOffering(m: CatalogModel, o: Offering): ModelSpec {
  const p = getProvider(o.provider);
  if (!p) throw new Error(`Proveedor desconocido en el catálogo: ${o.provider}`);
  return {
    adapter: p.adapter,
    provider: o.provider,
    access: o.access,
    model: o.model,
    effort: o.effort,
    params: o.params,
    label: m.label,
    catalogId: m.id,
  };
}

/** Resuelve "catalogId@provider:access" (o solo "catalogId", que toma la primera vía). */
export function resolveSpecRef(ref: string): ModelSpec {
  const [id, via] = ref.split("@");
  const m = getCatalogModel(id);
  if (!m) throw new Error(`Modelo no está en el catálogo: ${id}. Modelos: ${CATALOG.map((c) => c.id).join(", ")}`);
  const o = via ? m.offerings.find((x) => offeringKey(x) === via) : m.offerings[0];
  if (!o) throw new Error(`${m.label} no se ofrece por ${via}. Vías: ${m.offerings.map(offeringKey).join(", ")}`);
  return specFromOffering(m, o);
}

/** Estimación grosera del costo de un turno con API, para mostrar en la interfaz. */
export function estimateTurnCostUsd(m: CatalogModel, inputTokens = 60000, outputTokens = 12000): number {
  return (inputTokens * m.priceIn + outputTokens * m.priceOut) / 1e6;
}
