import type { AdapterEvent } from "../types.js";
import { extractJson } from "../fsutil.js";
import { httpHint, inlineSystemPrompt, parseInlineOutput, readSse } from "./inline.js";
import { envSecrets, rawLogger, tail, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface ReplicateAdapterOptions {
  secrets?: SecretResolver;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

/**
 * Replicate: crea una predicción sobre un modelo oficial (`owner/name`) y lee la salida por
 * streaming SSE. La entrada usa los campos habituales de sus modelos de lenguaje
 * (`prompt`, `system_prompt`, `max_tokens`); `spec.params` permite ajustarlos por modelo.
 */
export class ReplicateAdapter implements Adapter {
  readonly id = "replicate" as const;
  readonly editsFiles = false;
  readonly supportsResume = false;
  private secrets: SecretResolver;
  private fetchImpl: typeof fetch;
  private baseUrl: string;

  constructor(opts: ReplicateAdapterOptions = {}) {
    this.secrets = opts.secrets ?? envSecrets;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = (opts.baseUrl ?? "https://api.replicate.com/v1").replace(/\/$/, "");
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const key = this.secrets("REPLICATE_API_TOKEN");
    if (!key) return { ok: false, error: "falta el token de Replicate (REPLICATE_API_TOKEN)", modelsReported: [], text: "" };
    const model = req.spec.model;
    if (!/^[\w.-]+\/[\w.-]+$/.test(model)) return { ok: false, error: `replicate: el modelo debe tener la forma owner/name (${model})`, modelsReported: [], text: "" };

    const input: Record<string, unknown> = {
      prompt: req.prompt,
      system_prompt: inlineSystemPrompt(req),
      max_tokens: 64000,
      ...(req.spec.effort ? { reasoning_effort: req.spec.effort } : {}),
      ...(req.spec.params ?? {}),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    req.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    onEvent({ type: "status", text: `Replicate · ${model}` });
    log(JSON.stringify({ type: "request", model, promptChars: req.prompt.length }));

    let text = "";
    let predictionId: string | undefined;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models/${model}/predictions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ input, stream: true }),
        signal: controller.signal,
      });
      const raw = await res.text();
      log(raw.slice(0, 4000));
      if (!res.ok) return { ok: false, error: `replicate: HTTP ${res.status}${httpHint(res.status)}: ${tail(raw, 300)}`, modelsReported: [], text: "" };
      const pred = extractJson<any>(raw);
      predictionId = pred?.id;
      const streamUrl: string | undefined = pred?.urls?.stream;
      if (streamUrl) {
        const sres = await this.fetchImpl(streamUrl, { headers: { Accept: "text/event-stream", "Cache-Control": "no-store" }, signal: controller.signal });
        if (!sres.ok || !sres.body) return { ok: false, error: `replicate: no se pudo abrir el stream (HTTP ${sres.status})`, modelsReported: [], text: "" };
        let failed: string | undefined;
        await readSse(sres.body, (payload, event) => {
          if (event === "output") {
            text += payload;
            onEvent({ type: "text", text: payload });
          } else if (event === "error") {
            failed = payload;
          }
        });
        if (failed) return { ok: false, error: `replicate: ${tail(failed, 300)}`, modelsReported: [], text };
      } else if (predictionId) {
        // Sin streaming: sondeo hasta que termine.
        for (;;) {
          await new Promise((r) => setTimeout(r, 2000));
          const g = await this.fetchImpl(`${this.baseUrl}/predictions/${predictionId}`, { headers, signal: controller.signal });
          const p = extractJson<any>(await g.text());
          if (p?.status === "succeeded") {
            text = Array.isArray(p.output) ? p.output.join("") : String(p.output ?? "");
            onEvent({ type: "text", text });
            break;
          }
          if (p?.status === "failed" || p?.status === "canceled") return { ok: false, error: `replicate: ${p.status}: ${p.error ?? ""}`, modelsReported: [], text: "" };
        }
      }
    } catch (err: any) {
      if (predictionId) void this.fetchImpl(`${this.baseUrl}/predictions/${predictionId}/cancel`, { method: "POST", headers }).catch(() => undefined);
      const aborted = controller.signal.aborted;
      return { ok: false, error: aborted ? `replicate: timeout o cancelación tras ${req.timeoutMs} ms` : `replicate: ${err?.message ?? err}`, modelsReported: [], text };
    } finally {
      clearTimeout(timer);
    }

    log(JSON.stringify({ type: "final_text", chars: text.length, text }));
    // Replicate ejecuta exactamente el modelo pedido en la ruta: se reporta como tal.
    const modelsReported = [model];
    onEvent({ type: "model", model });
    const parsed = parseInlineOutput(text, req.role);
    if (!parsed.fullDocument) return { ok: false, error: "replicate: la respuesta no contiene el documento entre marcadores", modelsReported, text };
    return { ok: true, modelsReported, text, fullDocument: parsed.fullDocument, acta: parsed.acta };
  }
}
