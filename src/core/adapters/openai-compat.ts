import type { AdapterEvent } from "../types.js";
import { extractJson } from "../fsutil.js";
import { getProvider } from "../providers.js";
import { httpHint, inlineSystemPrompt, parseInlineOutput, readSse } from "./inline.js";
import { envSecrets, rawLogger, tail, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface OpenAICompatOptions {
  secrets?: SecretResolver;
  fetchImpl?: typeof fetch;
  /** Sobrescribe la URL base de un proveedor (pruebas o proveedores personalizados). */
  baseUrls?: Record<string, string>;
}

/**
 * Cualquier API compatible con OpenAI Chat Completions: OpenAI, OpenRouter, DigitalOcean,
 * Google (endpoint compatible), xAI, Moonshot, DeepSeek, Alibaba, Z.ai…
 * Sin herramientas ni sesión: recibe el plan completo en el prompt y devuelve el documento
 * completo más el acta entre marcadores. Sirve para participantes, sustituto y consolidador.
 */
export class OpenAICompatAdapter implements Adapter {
  readonly id = "openai-compat" as const;
  readonly editsFiles = false;
  readonly supportsResume = false;
  private secrets: SecretResolver;
  private fetchImpl: typeof fetch;
  private baseUrls: Record<string, string>;

  constructor(opts: OpenAICompatOptions = {}) {
    this.secrets = opts.secrets ?? envSecrets;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrls = opts.baseUrls ?? {};
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const providerId = req.spec.provider ?? "digitalocean";
    const provider = getProvider(providerId);
    const baseUrl = (this.baseUrls[providerId] ?? provider?.baseUrl ?? "").replace(/\/$/, "");
    if (!baseUrl) return { ok: false, error: `proveedor desconocido o sin URL: ${providerId}`, modelsReported: [], text: "" };
    const keyEnv = provider?.keyEnv ?? "OPENAI_API_KEY";
    const key = this.secrets(keyEnv);
    if (!key) return { ok: false, error: `falta la clave de ${provider?.label ?? providerId} (${keyEnv})`, modelsReported: [], text: "" };

    const body: Record<string, unknown> = {
      model: req.spec.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: inlineSystemPrompt(req) },
        { role: "user", content: req.prompt },
      ],
    };
    if (req.spec.effort) {
      if (providerId === "openrouter") body.reasoning = { effort: req.spec.effort };
      else if (providerId === "openai" || providerId === "google" || providerId === "xai") body.reasoning_effort = req.spec.effort;
    }
    if (req.allowWeb && req.role === "participant" && providerId === "openrouter") {
      body.plugins = [{ id: "web" }];
    }
    Object.assign(body, req.spec.params ?? {});

    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    if (providerId === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/MoscoDJ/osky-project-planning";
      headers["X-Title"] = "Osky Project Planning";
    }

    log(JSON.stringify({ type: "request", provider: providerId, model: req.spec.model, promptChars: req.prompt.length }));
    onEvent({ type: "status", text: `${provider?.label ?? providerId} · ${req.spec.model}` });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    req.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let text = "";
    let modelReported: string | undefined;
    let usage: unknown;
    let streamError: string | undefined;
    try {
      const res = await this.fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text();
        log(JSON.stringify({ type: "http_error", status: res.status, body: errBody.slice(0, 2000) }));
        return { ok: false, error: `${providerId}: HTTP ${res.status}${httpHint(res.status)}: ${tail(errBody, 300)}`, modelsReported: [], text: "" };
      }
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("text/event-stream") && res.body) {
        await readSse(res.body, (payload) => {
          if (payload === "[DONE]") return;
          const chunk = extractJson<any>(payload);
          if (!chunk) return;
          // Se registran solo los eventos sin contenido (metadatos, uso, errores); el texto va al final.
          if (!chunk.choices?.[0]?.delta?.content) log(payload);
          if (chunk.error) streamError = chunk.error.message ?? JSON.stringify(chunk.error);
          if (chunk.model) modelReported = chunk.model;
          if (chunk.usage) usage = chunk.usage;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            text += delta;
            onEvent({ type: "text", text: delta });
          }
        });
      } else {
        const raw = await res.text();
        log(raw.slice(0, 20000));
        const d = extractJson<any>(raw);
        if (!d) return { ok: false, error: `${providerId}: respuesta no JSON: ${tail(raw, 300)}`, modelsReported: [], text: "" };
        modelReported = d.model;
        usage = d.usage;
        text = d.choices?.[0]?.message?.content ?? "";
        onEvent({ type: "text", text });
      }
    } catch (err: any) {
      const aborted = controller.signal.aborted;
      return { ok: false, error: aborted ? `${providerId}: timeout o cancelación tras ${req.timeoutMs} ms` : `${providerId}: ${err?.message ?? err}`, modelsReported: [], text };
    } finally {
      clearTimeout(timer);
    }
    log(JSON.stringify({ type: "final_text", chars: text.length, text }));
    if (streamError) return { ok: false, error: `${providerId}: ${streamError}`, modelsReported: [], text };

    const modelsReported = modelReported ? [normalizeReportedModel(providerId, modelReported)] : [];
    if (modelReported) onEvent({ type: "model", model: modelReported });
    if (usage) onEvent({ type: "usage", data: usage });

    const parsed = parseInlineOutput(text, req.role);
    if (!parsed.fullDocument) {
      return { ok: false, error: `${providerId}: la respuesta no contiene el documento entre marcadores`, modelsReported, text };
    }
    return { ok: true, modelsReported, text, fullDocument: parsed.fullDocument, acta: parsed.acta, usage };
  }
}

/**
 * Algunos proveedores reportan el modelo con prefijos o fechas. Se conserva tal cual,
 * salvo prefijos conocidos, para que la verificación de identidad compare lo comparable.
 */
function normalizeReportedModel(provider: string, m: string): string {
  if (provider === "google") return m.replace(/^models\//, "");
  return m;
}

/** Alias heredado: el adaptador de Kimi era un OpenAI-compatible sobre DigitalOcean. */
export { OpenAICompatAdapter as KimiAdapter };
export { parseInlineOutput as parseKimiOutput } from "./inline.js";
