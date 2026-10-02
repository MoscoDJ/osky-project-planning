import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AdapterEvent, AdapterId, ModelSpec } from "../types.js";

export interface TurnRequest {
  workspace: string;
  /** Paquete del turno. Se envía por stdin o como mensaje de usuario. */
  prompt: string;
  /** Protocolo completo, para adaptadores que no leen un archivo de reglas. */
  systemPrompt: string;
  rulesFile?: string;
  schemaFile: string;
  schema: object;
  spec: ModelSpec;
  sessionId?: string;
  role: "participant" | "consolidator";
  allowWeb: boolean;
  contextDirs: string[];
  /** Archivo que el turno puede modificar: plan.md o plan.candidate.md. */
  targetFile: string;
  /** Contenido actual del archivo objetivo, para adaptadores sin herramientas. */
  planContent: string;
  logFile: string;
  timeoutMs: number;
  turnNumber: number;
  signal?: AbortSignal;
}

export interface TurnResult {
  ok: boolean;
  error?: string;
  sessionId?: string;
  /** Modelos observados en las respuestas. Vacío si el CLI no lo reporta. */
  modelsReported: string[];
  /** Texto final del asistente (sin el acta si venía aparte). */
  text: string;
  /** Acta cruda (sin validar), si el adaptador la obtuvo. */
  acta?: unknown;
  /** Documento completo, para adaptadores que no editan archivos. */
  fullDocument?: string;
  usage?: unknown;
  costEstimateUsd?: number;
}

export interface Adapter {
  readonly id: AdapterId;
  /** true si el modelo edita el archivo objetivo con sus propias herramientas. */
  readonly editsFiles: boolean;
  readonly supportsResume: boolean;
  runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult>;
}

export interface AdapterRegistry {
  get(spec: ModelSpec): Adapter;
}

/** Resuelve claves de API por nombre de variable (secrets.env y entorno). */
export type SecretResolver = (name: string) => string | undefined;

export const envSecrets: SecretResolver = (name) => process.env[name] || undefined;

/** Escribe líneas crudas del CLI en el archivo de log del turno, en orden. */
export function rawLogger(logFile: string): (line: string) => void {
  mkdirSync(path.dirname(logFile), { recursive: true });
  return (line: string) => {
    try {
      appendFileSync(logFile, line.endsWith("\n") ? line : line + "\n");
    } catch {
      /* el log nunca debe tumbar el turno */
    }
  };
}

export function tail(s: string, n = 800): string {
  return s.length > n ? s.slice(-n) : s;
}
