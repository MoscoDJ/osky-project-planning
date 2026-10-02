import Anthropic from "@anthropic-ai/sdk";
import type { AdapterEvent } from "../types.js";
import { inlineSystemPrompt, parseInlineOutput } from "./inline.js";
import { envSecrets, rawLogger, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface AnthropicAdapterOptions {
  secrets?: SecretResolver;
  /** Para pruebas: fábrica del cliente. */
  clientFactory?: (apiKey: string, timeoutMs: number) => Anthropic;
}

/**
 * API oficial de Anthropic con el SDK de TypeScript. Sin herramientas de archivo: el plan va
 * en el mensaje y vuelve completo entre marcadores. Usa streaming (salidas largas), el esfuerzo
 * del spec en `output_config.effort` y, si el debate lo permite, la búsqueda web del servidor.
 *
 * No activa los `fallbacks` del servidor a propósito: el sistema verifica la identidad del modelo
 * en cada turno y la sustitución la decide el motor (reintento y luego el sustituto configurado).
 */
export class AnthropicAdapter implements Adapter {
  readonly id = "anthropic" as const;
  readonly editsFiles = false;
  readonly supportsResume = false;
  private secrets: SecretResolver;
  private clientFactory: (apiKey: string, timeoutMs: number) => Anthropic;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.secrets = opts.secrets ?? envSecrets;
    this.clientFactory = opts.clientFactory ?? ((apiKey, timeoutMs) => new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 2 }));
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const key = this.secrets("ANTHROPIC_API_KEY");
    if (!key) return { ok: false, error: "falta la clave de la API de Anthropic (ANTHROPIC_API_KEY)", modelsReported: [], text: "" };
    const client = this.clientFactory(key, req.timeoutMs);
    const model = req.spec.model;

    const tools: any[] = [];
    if (req.allowWeb && req.role === "participant") {
      // La variante con filtrado dinámico requiere Opus 4.6+/Sonnet 4.6+; para el resto, la básica.
      const dynamic = /^claude-(opus|sonnet)-(4-[6-9]|5)/.test(model);
      tools.push({ type: dynamic ? "web_search_20260209" : "web_search_20250305", name: "web_search", max_uses: 8 });
    }

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: req.prompt }];
    let text = "";
    const models = new Set<string>();
    let usage: unknown;
    onEvent({ type: "status", text: `Anthropic API · ${model}` });
    log(JSON.stringify({ type: "request", model, promptChars: req.prompt.length, web: tools.length > 0 }));

    try {
      // Las búsquedas del servidor pueden pausar el turno (pause_turn); se reanuda con el mismo historial.
      for (let i = 0; i < 6; i++) {
        const params: any = {
          model,
          max_tokens: 64000,
          system: inlineSystemPrompt(req),
          messages,
          ...(tools.length ? { tools } : {}),
          ...(req.spec.effort ? { output_config: { effort: req.spec.effort } } : {}),
          ...(req.spec.params ?? {}),
        };
        const stream = client.messages.stream(params, { signal: req.signal });
        stream.on("text", (t) => {
          text += t;
          onEvent({ type: "text", text: t });
        });
        stream.on("streamEvent", (ev: any) => {
          if (ev.type === "content_block_start" && ev.content_block?.type === "server_tool_use") {
            onEvent({ type: "tool", text: `${ev.content_block.name ?? "server_tool"}` });
          }
        });
        const msg = await stream.finalMessage();
        log(JSON.stringify({ type: "message", id: msg.id, model: msg.model, stop_reason: msg.stop_reason, usage: msg.usage }));
        models.add(msg.model);
        usage = msg.usage;
        if (msg.stop_reason === "refusal") {
          const det: any = (msg as any).stop_details;
          return {
            ok: false,
            error: `anthropic: el modelo declinó la solicitud (refusal${det?.category ? `, categoría ${det.category}` : ""})`,
            modelsReported: [...models],
            text,
          };
        }
        if (msg.stop_reason === "max_tokens") {
          return { ok: false, error: "anthropic: la respuesta se cortó por max_tokens", modelsReported: [...models], text };
        }
        if (msg.stop_reason === "pause_turn") {
          messages.push({ role: "assistant", content: msg.content });
          continue;
        }
        break;
      }
    } catch (err: any) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: "anthropic: clave inválida", modelsReported: [...models], text };
      if (err instanceof Anthropic.NotFoundError) return { ok: false, error: `anthropic: modelo no encontrado (${model})`, modelsReported: [...models], text };
      if (err instanceof Anthropic.RateLimitError) return { ok: false, error: "anthropic: límite de uso alcanzado", modelsReported: [...models], text };
      if (err instanceof Anthropic.APIUserAbortError) return { ok: false, error: "anthropic: cancelado", modelsReported: [...models], text };
      if (err instanceof Anthropic.APIError) return { ok: false, error: `anthropic: ${err.status ?? ""} ${err.message}`, modelsReported: [...models], text };
      return { ok: false, error: `anthropic: ${err?.message ?? err}`, modelsReported: [...models], text };
    }

    const modelsReported = [...models];
    for (const m of modelsReported) onEvent({ type: "model", model: m });
    if (usage) onEvent({ type: "usage", data: usage });
    const parsed = parseInlineOutput(text, req.role);
    if (!parsed.fullDocument) return { ok: false, error: "anthropic: la respuesta no contiene el documento entre marcadores", modelsReported, text };
    return { ok: true, modelsReported, text, fullDocument: parsed.fullDocument, acta: parsed.acta, usage };
  }
}
