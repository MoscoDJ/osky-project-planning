import { extractJson } from "../fsutil.js";
import { INLINE_ACTA_MARKER, INLINE_END_MARKER, INLINE_PLAN_MARKER } from "../prompts.js";
import type { TurnRequest } from "./types.js";

/**
 * Utilidades comunes de los adaptadores HTTP sin herramientas: el modelo recibe el plan
 * completo en el mensaje y devuelve el documento completo más el acta entre marcadores.
 */

export function inlineSystemPrompt(req: TurnRequest): string {
  if (req.role !== "participant") return req.systemPrompt;
  return `${req.systemPrompt}\n\n## Schema JSON del acta (obligatorio, sin propiedades adicionales)\n\n\`\`\`json\n${JSON.stringify(req.schema)}\n\`\`\`\n`;
}

export function parseInlineOutput(text: string, role: "participant" | "consolidator"): { fullDocument?: string; acta?: unknown } {
  const planStart = text.indexOf(INLINE_PLAN_MARKER);
  if (planStart < 0) return {};
  const afterPlan = planStart + INLINE_PLAN_MARKER.length;
  const actaIdx = text.indexOf(INLINE_ACTA_MARKER, afterPlan);
  const endIdx = text.indexOf(INLINE_END_MARKER, afterPlan);
  const planEnd = actaIdx >= 0 ? actaIdx : endIdx >= 0 ? endIdx : text.length;
  let fullDocument = text.slice(afterPlan, planEnd).trim();
  fullDocument = fullDocument.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim() + "\n";
  if (role === "consolidator") return { fullDocument };
  let acta: unknown;
  if (actaIdx >= 0) {
    const actaEnd = endIdx > actaIdx ? endIdx : text.length;
    acta = extractJson(text.slice(actaIdx + INLINE_ACTA_MARKER.length, actaEnd));
  }
  return { fullDocument, acta };
}

/** Texto de un error HTTP con una pista legible según el código. */
export function httpHint(status: number): string {
  if (status === 401 || status === 403) return " (clave inválida o sin permiso para este modelo)";
  if (status === 402) return " (cuenta sin saldo o créditos)";
  if (status === 404) return " (modelo no encontrado en este proveedor)";
  if (status === 429) return " (límite de uso alcanzado; reintenta más tarde)";
  if (status >= 500) return " (error del proveedor)";
  return "";
}

/** Lee un cuerpo SSE línea a línea y entrega cada payload de `data:`. */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (payload: string, event?: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event: string | undefined;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.trim()) {
        event = undefined;
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      onData(line.slice(5).replace(/^ /, ""), event);
    }
  }
}
