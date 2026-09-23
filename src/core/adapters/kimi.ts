import type { AdapterEvent } from "../types.js";
import { extractJson } from "../fsutil.js";
import { KIMI_ACTA_MARKER, KIMI_END_MARKER, KIMI_PLAN_MARKER } from "../prompts.js";
import { rawLogger, tail, type Adapter, type TurnRequest, type TurnResult } from "./types.js";

export interface KimiAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Kimi K3 en DigitalOcean por API OpenAI-compatible. Sin herramientas ni sesión:
 * recibe el plan completo en el prompt y devuelve el documento completo más el
 * acta entre marcadores. Es el sustituto temporal y la alternativa de consolidación.
 */
export class KimiAdapter implements Adapter {
  readonly id = "kimi" as const;
  readonly editsFiles = false;
  readonly supportsResume = false;
  private baseUrl: string;
  private apiKey?: string;
  private apiKeyEnv: string;
  private fetchImpl: typeof fetch;

  constructor(opts: KimiAdapterOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://inference.do-ai.run/v1").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.apiKeyEnv = opts.apiKeyEnv ?? "DO_INFERENCE_API_KEY";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private key(): string | undefined {
    return this.apiKey ?? process.env[this.apiKeyEnv];
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const key = this.key();
    if (!key) {
      return { ok: false, error: `kimi: falta la clave (${this.apiKeyEnv})`, modelsReported: [], text: "" };
    }
    const body = {
      model: req.spec.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        {
          role: "system",
          content:
            req.role === "participant"
              ? `${req.systemPrompt}\n\n## Schema JSON del acta (obligatorio, sin propiedades adicionales)\n\n\`\`\`json\n${JSON.stringify(req.schema)}\n\`\`\`\n`
              : req.systemPrompt,
        },
        { role: "user", content: req.prompt },
      ],
    };
    log(JSON.stringify({ type: "request", model: req.spec.model, promptChars: req.prompt.length }));
    onEvent({ type: "status", text: `kimi ${req.spec.model} (HTTP)` });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    req.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let text = "";
    let modelReported: string | undefined;
    let usage: unknown;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errBody = await res.text();
        log(JSON.stringify({ type: "http_error", status: res.status, body: errBody.slice(0, 2000) }));
        const hint = res.status === 402 ? " (cuenta sin créditos: consolidador no disponible)" : "";
        return { ok: false, error: `kimi: HTTP ${res.status}${hint}: ${tail(errBody, 300)}`, modelsReported: [], text: "" };
      }
      const ctype = res.headers.get("content-type") ?? "";
      if (ctype.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            log(payload);
            const chunk = extractJson<any>(payload);
            if (!chunk) continue;
            if (chunk.model) modelReported = chunk.model;
            if (chunk.usage) usage = chunk.usage;
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              text += delta;
              onEvent({ type: "text", text: delta });
            }
          }
        }
      } else {
        const raw = await res.text();
        log(raw.slice(0, 20000));
        const d = extractJson<any>(raw);
        if (!d) return { ok: false, error: `kimi: respuesta no JSON: ${tail(raw, 300)}`, modelsReported: [], text: "" };
        modelReported = d.model;
        usage = d.usage;
        text = d.choices?.[0]?.message?.content ?? "";
        onEvent({ type: "text", text });
      }
    } catch (err: any) {
      const aborted = controller.signal.aborted;
      return { ok: false, error: aborted ? `kimi: timeout tras ${req.timeoutMs} ms` : `kimi: ${err?.message ?? err}`, modelsReported: [], text };
    } finally {
      clearTimeout(timer);
    }

    const modelsReported = modelReported ? [modelReported] : [];
    if (modelReported) onEvent({ type: "model", model: modelReported });
    if (usage) onEvent({ type: "usage", data: usage });

    const parsed = parseKimiOutput(text, req.role);
    if (!parsed.fullDocument) {
      return { ok: false, error: "kimi: la respuesta no contiene el documento entre marcadores", modelsReported, text };
    }
    return { ok: true, modelsReported, text, fullDocument: parsed.fullDocument, acta: parsed.acta, usage };
  }
}

export function parseKimiOutput(text: string, role: "participant" | "consolidator"): { fullDocument?: string; acta?: unknown } {
  const planStart = text.indexOf(KIMI_PLAN_MARKER);
  if (planStart < 0) return {};
  const afterPlan = planStart + KIMI_PLAN_MARKER.length;
  const actaIdx = text.indexOf(KIMI_ACTA_MARKER, afterPlan);
  const endIdx = text.indexOf(KIMI_END_MARKER, afterPlan);
  const planEnd = actaIdx >= 0 ? actaIdx : endIdx >= 0 ? endIdx : text.length;
  let fullDocument = text.slice(afterPlan, planEnd).trim();
  fullDocument = fullDocument.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim() + "\n";
  if (role === "consolidator") return { fullDocument };
  let acta: unknown;
  if (actaIdx >= 0) {
    const actaEnd = endIdx > actaIdx ? endIdx : text.length;
    acta = extractJson(text.slice(actaIdx + KIMI_ACTA_MARKER.length, actaEnd));
  }
  return { fullDocument, acta };
}
