import { promises as fs } from "node:fs";
import path from "node:path";
import type { AdapterEvent } from "../types.js";
import type { Adapter, TurnRequest, TurnResult } from "./types.js";

export interface FakeBehavior {
  /** Número de intentos que fallan antes de responder bien. */
  failTimes?: number;
  /** Reporta un modelo distinto al solicitado (prueba de identidad). */
  wrongModel?: boolean;
  /** Turno en el que hace una pregunta bloqueante (una sola vez). */
  blockingOnTurn?: number;
  /** Turno en el que escribe un archivo fuera de alcance. */
  extraFileOnTurn?: number;
  /** Turno en el que reescribe el plan completo (prueba de porcentaje de cambio). */
  rewriteOnTurn?: number;
  /** Retardo simulado por turno, en ms. */
  delayMs?: number;
}

/**
 * Adaptador simulado para desarrollar y probar el motor sin gastar cuota.
 * Edita el archivo objetivo y devuelve un acta plausible. Sus comportamientos
 * se configuran por nombre de modelo para poder simular fallos y sustituciones.
 */
export class FakeAdapter implements Adapter {
  readonly id = "fake" as const;
  readonly editsFiles = true;
  readonly supportsResume = true;
  private failCounters = new Map<string, number>();
  private blockedOnce = new Set<string>();
  public calls: Array<{ model: string; turn: number; role: string; resumed: boolean }> = [];

  constructor(private behaviors: Record<string, FakeBehavior> = {}) {}

  private behavior(model: string): FakeBehavior {
    return this.behaviors[model] ?? {};
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const b = this.behavior(req.spec.model);
    this.calls.push({ model: req.spec.model, turn: req.turnNumber, role: req.role, resumed: !!req.sessionId });
    onEvent({ type: "status", text: `fake(${req.spec.model}) turno ${req.turnNumber}` });
    if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));

    const failed = this.failCounters.get(req.spec.model) ?? 0;
    if ((b.failTimes ?? 0) > failed) {
      this.failCounters.set(req.spec.model, failed + 1);
      return { ok: false, error: `fallo simulado ${failed + 1}`, modelsReported: [], text: "" };
    }

    const target = path.join(req.workspace, req.targetFile);
    const current = await fs.readFile(target, "utf8");
    const sessionId = req.sessionId ?? `fake-session-${req.spec.model}-${Math.random().toString(36).slice(2, 8)}`;
    const modelReported = b.wrongModel ? "modelo-inesperado" : req.spec.model;

    if (req.role === "consolidator") {
      const consolidated =
        current.trimEnd() +
        `\n\n## Puntos sin consenso\n\n- (simulado) Sin disputas registradas por el consolidador ${req.spec.model}.\n`;
      await fs.writeFile(target, consolidated, "utf8");
      onEvent({ type: "text", text: "Consolidación simulada aplicada." });
      return { ok: true, sessionId, modelsReported: [modelReported], text: "Consolidación simulada.", usage: { tokens: 1 } };
    }

    const blockingKey = `${req.spec.model}:${req.turnNumber}`;
    const askBlocking = b.blockingOnTurn === req.turnNumber && !this.blockedOnce.has(blockingKey) && !req.prompt.includes("pregunta bloqueante");
    if (askBlocking) {
      this.blockedOnce.add(blockingKey);
      return {
        ok: true,
        sessionId,
        modelsReported: [modelReported],
        text: "Necesito un dato.",
        acta: {
          resumen: "Necesito una aclaración antes de continuar.",
          evaluacion: "Pendiente.",
          cambios: [],
          acuerdos: [],
          rechazos: [],
          desacuerdos: [],
          riesgos: [],
          preguntas_usuario: [{ pregunta: "¿Cuál es el presupuesto máximo?", bloqueante: true }],
          fuentes: [],
          sin_cambios: true,
        },
      };
    }

    let next: string;
    if (b.rewriteOnTurn === req.turnNumber) {
      next = `# Plan reescrito\n\n## Objetivo\nTodo nuevo.\n\n## Alcance\n\n## Etapas\n\n## Riesgos\n`;
    } else if (req.turnNumber === 1) {
      next = current.replace(
        "## 1. Objetivo y resultado esperado\n",
        `## 1. Objetivo y resultado esperado\n\nPlan inicial simulado por ${req.spec.model}.\n`,
      );
      next += `\n## Registro simulado\n\n- Turno 1 (${req.spec.model}): plan inicial.\n`;
    } else {
      next = current.trimEnd() + `\n- Turno ${req.turnNumber} (${req.spec.model}): cambio simulado.\n`;
    }
    await fs.writeFile(target, next, "utf8");
    if (b.extraFileOnTurn === req.turnNumber) {
      await fs.writeFile(path.join(req.workspace, "fuera-de-alcance.md"), "no debería existir\n", "utf8");
    }
    onEvent({ type: "tool", text: `Edit ${req.targetFile}` });
    onEvent({ type: "text", text: `Turno ${req.turnNumber} listo.` });
    return {
      ok: true,
      sessionId,
      modelsReported: [modelReported],
      text: `Turno ${req.turnNumber} simulado.`,
      acta: {
        resumen: `Intervención simulada de ${req.spec.model} en el turno ${req.turnNumber}.`,
        evaluacion: "Versión recibida aceptable.",
        cambios: [{ seccion: "Registro", que: "Línea añadida", por_que: "Prueba", consecuencias: "Ninguna" }],
        acuerdos: req.turnNumber > 1 ? ["Se conserva la estructura."] : [],
        rechazos: [],
        desacuerdos: req.turnNumber === 2 ? [{ tema: "Alcance", postura_propia: "Reducir", postura_ajena: "Mantener" }] : [],
        riesgos: [],
        preguntas_usuario: req.turnNumber === 2 ? [{ pregunta: "¿Fecha límite?", bloqueante: false }] : [],
        fuentes: [],
        sin_cambios: false,
      },
      usage: { tokens: 1 },
    };
  }
}
