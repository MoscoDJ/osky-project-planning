import { Ajv, type ErrorObject } from "ajv";
import type { Acta } from "./types.js";

/**
 * Schema del acta de turno. Compartido por todos los adaptadores.
 * Todas las propiedades son obligatorias (lo exige el modo estricto de OpenAI),
 * pero las listas pueden ir vacías: no se fabrican rechazos.
 */
export const ACTA_SCHEMA = {
  type: "object",
  properties: {
    resumen: { type: "string", description: "Qué hiciste en este turno, en 3 a 5 líneas." },
    evaluacion: { type: "string", description: "Juicio breve de la versión del plan que recibiste." },
    cambios: {
      type: "array",
      description: "Cambios sustantivos realizados en plan.md.",
      items: {
        type: "object",
        properties: {
          seccion: { type: "string" },
          que: { type: "string" },
          por_que: { type: "string" },
          consecuencias: { type: "string" },
        },
        required: ["seccion", "que", "por_que", "consecuencias"],
        additionalProperties: false,
      },
    },
    acuerdos: {
      type: "array",
      description: "Lo que aceptaste del otro participante, con su motivo. Puede ir vacía.",
      items: { type: "string" },
    },
    rechazos: {
      type: "array",
      description: "Propuestas del otro participante que no aceptaste. Puede ir vacía; no inventes rechazos.",
      items: {
        type: "object",
        properties: { propuesta: { type: "string" }, motivo: { type: "string" } },
        required: ["propuesta", "motivo"],
        additionalProperties: false,
      },
    },
    desacuerdos: {
      type: "array",
      description: "Temas todavía en disputa. Puede ir vacía.",
      items: {
        type: "object",
        properties: {
          tema: { type: "string" },
          postura_propia: { type: "string" },
          postura_ajena: { type: "string" },
        },
        required: ["tema", "postura_propia", "postura_ajena"],
        additionalProperties: false,
      },
    },
    riesgos: { type: "array", items: { type: "string" } },
    preguntas_usuario: {
      type: "array",
      description: "Preguntas para el usuario. bloqueante=true solo si no puedes decidir con responsabilidad sin la respuesta.",
      items: {
        type: "object",
        properties: { pregunta: { type: "string" }, bloqueante: { type: "boolean" } },
        required: ["pregunta", "bloqueante"],
        additionalProperties: false,
      },
    },
    fuentes: {
      type: "array",
      description: "Referencias consultadas (URL o título) y qué afirmación respaldan. Puede ir vacía.",
      items: { type: "string" },
    },
    sin_cambios: { type: "boolean", description: "true si decidiste no modificar el plan en este turno." },
  },
  required: [
    "resumen",
    "evaluacion",
    "cambios",
    "acuerdos",
    "rechazos",
    "desacuerdos",
    "riesgos",
    "preguntas_usuario",
    "fuentes",
    "sin_cambios",
  ],
  additionalProperties: false,
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn = ajv.compile(ACTA_SCHEMA);

export interface ActaValidation {
  ok: boolean;
  acta?: Acta;
  errors?: string[];
}

export function validateActa(input: unknown): ActaValidation {
  if (validateFn(input)) return { ok: true, acta: input as Acta };
  const errors = (validateFn.errors ?? []).map(formatError);
  return { ok: false, errors };
}

function formatError(e: ErrorObject): string {
  return `${e.instancePath || "/"} ${e.message ?? ""}`.trim();
}

export function hasBlockingQuestion(acta: Acta): boolean {
  return acta.preguntas_usuario.some((p) => p.bloqueante);
}

/** Render legible del acta para debate.md y para el paquete del siguiente turno. */
export function renderActa(acta: Acta): string {
  const lines: string[] = [];
  lines.push(`**Resumen.** ${acta.resumen}`);
  lines.push("");
  lines.push(`**Evaluación de la versión recibida.** ${acta.evaluacion}`);
  lines.push("");
  if (acta.sin_cambios) lines.push("_Sin cambios en el plan en este turno._", "");
  if (acta.cambios.length) {
    lines.push("**Cambios**");
    for (const c of acta.cambios) {
      lines.push(`- **${c.seccion}:** ${c.que}`);
      lines.push(`  - Por qué: ${c.por_que}`);
      lines.push(`  - Consecuencias: ${c.consecuencias}`);
    }
    lines.push("");
  }
  if (acta.acuerdos.length) {
    lines.push("**Acuerdos**");
    for (const a of acta.acuerdos) lines.push(`- ${a}`);
    lines.push("");
  }
  if (acta.rechazos.length) {
    lines.push("**Rechazos**");
    for (const r of acta.rechazos) lines.push(`- ${r.propuesta} — ${r.motivo}`);
    lines.push("");
  }
  if (acta.desacuerdos.length) {
    lines.push("**Desacuerdos pendientes**");
    for (const d of acta.desacuerdos) {
      lines.push(`- **${d.tema}.** Postura propia: ${d.postura_propia}. Postura ajena: ${d.postura_ajena}.`);
    }
    lines.push("");
  }
  if (acta.riesgos.length) {
    lines.push("**Riesgos**");
    for (const r of acta.riesgos) lines.push(`- ${r}`);
    lines.push("");
  }
  if (acta.preguntas_usuario.length) {
    lines.push("**Preguntas para el usuario**");
    for (const p of acta.preguntas_usuario) {
      lines.push(`- ${p.bloqueante ? "[BLOQUEANTE] " : ""}${p.pregunta}`);
    }
    lines.push("");
  }
  if (acta.fuentes.length) {
    lines.push("**Fuentes**");
    for (const f of acta.fuentes) lines.push(`- ${f}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
