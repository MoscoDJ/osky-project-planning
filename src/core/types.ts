// Tipos centrales del motor de Osky Project Planning.

/** Letra del participante: "A", "B", "C"… Se asigna por posición al crear el debate. */
export type ParticipantKey = string;
export type Role = ParticipantKey | "consolidator";

/**
 * Adaptador que ejecuta el turno.
 * - claude / codex / gemini: CLIs oficiales (por login o por clave de API).
 * - anthropic: API oficial de Anthropic (SDK).
 * - openai-compat: cualquier API compatible con OpenAI Chat Completions
 *   (OpenAI, OpenRouter, DigitalOcean, xAI, Moonshot, DeepSeek, Google, Alibaba, Z.ai…).
 * - replicate: API de predicciones de Replicate.
 * - kimi: alias heredado de openai-compat sobre DigitalOcean (debates antiguos).
 */
export type AdapterId = "claude" | "codex" | "gemini" | "anthropic" | "openai-compat" | "replicate" | "kimi" | "fake";

/** Cómo se accede al modelo. */
export type AccessMode = "cli-login" | "cli-key" | "api";

export interface ModelSpec {
  adapter: AdapterId;
  /** Id del modelo en el proveedor elegido. */
  model: string;
  effort?: string;
  /** Nombre legible para el usuario (nunca se envía a los modelos). */
  label: string;
  /** Proveedor (ver providers.ts). Opcional por compatibilidad con debates antiguos. */
  provider?: string;
  access?: AccessMode;
  /** Id de la entrada del catálogo de la que salió, si aplica. */
  catalogId?: string;
  /** Parámetros extra para la petición HTTP (p. ej. max_tokens), según el proveedor. */
  params?: Record<string, unknown>;
}

export interface ParticipantConfig {
  key: ParticipantKey;
  spec: ModelSpec;
  /** Id de sesión del CLI (session_id de Claude, thread_id de Codex, sesión de Gemini). */
  sessionId?: string;
}

export type Phase =
  | "initial"
  | "awaiting_user"
  | "user_cycle"
  | "finalized"
  | "candidate_ready"
  | "closed";

export type TurnKind = "initial" | "cycle";

export type TurnStatus =
  | "pending"
  | "running"
  | "paused_blocking"
  | "published"
  | "failed"
  | "skipped";

export type Identity = "confirmed" | "unreported" | "mismatch";

export interface ActaCambio {
  seccion: string;
  que: string;
  por_que: string;
  consecuencias: string;
}
export interface ActaRechazo {
  propuesta: string;
  motivo: string;
}
export interface ActaDesacuerdo {
  tema: string;
  postura_propia: string;
  postura_ajena: string;
}
export interface ActaPregunta {
  pregunta: string;
  bloqueante: boolean;
}

/** Acta del turno. Todas las listas son obligatorias pero pueden ir vacías. */
export interface Acta {
  resumen: string;
  evaluacion: string;
  cambios: ActaCambio[];
  acuerdos: string[];
  rechazos: ActaRechazo[];
  desacuerdos: ActaDesacuerdo[];
  riesgos: string[];
  preguntas_usuario: ActaPregunta[];
  /** Referencias consultadas (URLs o títulos). Puede ir vacía. */
  fuentes: string[];
  sin_cambios: boolean;
}

export interface TurnAttempt {
  n: number;
  model: string;
  adapter: AdapterId;
  provider?: string;
  startedAt: string;
  finishedAt?: string;
  outcome: "published" | "paused" | "failed";
  error?: string;
  logFile?: string;
}

export interface TurnRecord {
  id: string;
  /** Número global del turno, continuo entre fase inicial y ciclos. */
  number: number;
  kind: TurnKind;
  participant: ParticipantKey;
  /** Intervención i de N dentro de la fase inicial, o posición dentro de un ciclo. */
  position: number;
  positionTotal: number;
  cycleIndex?: number;
  objective: string;
  status: TurnStatus;
  attempts: TurnAttempt[];
  /** Modelo que cubrió el turno si hubo sustitución. */
  substitute?: string;
  substituteReason?: string;
  modelRequested: string;
  modelsReported: string[];
  identity?: Identity;
  baseCommit?: string;
  commit?: string;
  acta?: Acta;
  changeRatio?: number;
  reviewFlag?: string;
  error?: string;
  usage?: unknown;
  costEstimateUsd?: number;
  /** Respuesta del usuario a una pregunta bloqueante, si la hubo. */
  blockingAnswer?: string;
}

export interface UserCycle {
  index: number;
  observation: string;
  starts: ParticipantKey;
  turnNumbers: number[];
  createdAt: string;
}

export interface CandidateInfo {
  by: ModelSpec;
  createdAt: string;
  status: "ready" | "accepted" | "discarded" | "failed";
  error?: string;
  logFile?: string;
  /** Informe breve de cambios que entregó el consolidador. */
  report?: string;
}

/**
 * Orden de los ciclos de observación.
 * - global: empieza quien sigue al último que habló; conserva la rotación en todo el debate.
 * - alternate: rota quién abre cada ciclo, independientemente de quién cerró el anterior.
 */
export type CycleOrder = "global" | "alternate";

export interface DebateConfig {
  rounds: number;
  allowWeb: boolean;
  contextDirs: string[];
  autoSubstitute: boolean;
  substitute: ModelSpec;
  consolidator: ModelSpec;
  consolidatorAlt: ModelSpec;
  turnTimeoutMs: number;
  /** Fracción de líneas cambiadas a partir de la cual se marca el turno para revisión. */
  changeRatioThreshold: number;
  cycleOrder: CycleOrder;
}

export interface DebateState {
  version: 1 | 2;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  /** Primer participante del orden de palabra. */
  opener: ParticipantKey;
  /** Orden de palabra sorteado al crear el debate (fijo durante todo el debate). */
  order: ParticipantKey[];
  participants: Record<ParticipantKey, ParticipantConfig>;
  config: DebateConfig;
  turns: TurnRecord[];
  cycles: UserCycle[];
  /** Decisiones y restricciones explícitas del usuario. */
  decisions: string[];
  /** Aclaraciones dadas en respuesta a preguntas bloqueantes. */
  clarifications: string[];
  candidate?: CandidateInfo;
  consolidationHistory: CandidateInfo[];
  /** true si algún turno se saltó: nunca se afirma que se completaron todas las intervenciones. */
  abbreviated: boolean;
  nextAction: string;
}

export interface NewDebateOptions {
  root: string;
  title: string;
  brief: string;
  rounds?: number;
  allowWeb?: boolean;
  contextDirs?: string[];
  /**
   * Orden de palabra: "random" sortea; "fixed" respeta el orden de `participants`;
   * una letra hace que ese participante abra y el resto siga en orden.
   */
  opener?: ParticipantKey | "random" | "fixed";
  /** Modelos participantes, en orden. Reciben las letras A, B, C… Mínimo dos. */
  participants: ModelSpec[] | { A: ModelSpec; B: ModelSpec };
  substitute: ModelSpec;
  consolidator: ModelSpec;
  consolidatorAlt: ModelSpec;
  autoSubstitute?: boolean;
  turnTimeoutMs?: number;
  changeRatioThreshold?: number;
  cycleOrder?: CycleOrder;
  decisions?: string[];
  /** Se usa en pruebas para fijar el nombre del directorio. */
  dirName?: string;
}

export type EngineEvent =
  | { type: "phase"; phase: Phase; nextAction: string }
  | { type: "turn_start"; turn: TurnRecord; model: string; attempt: number }
  | { type: "adapter"; turn?: TurnRecord; event: AdapterEvent }
  | { type: "turn_end"; turn: TurnRecord; outcome: "published" | "paused" | "failed" }
  | { type: "consolidation"; status: "start" | "ready" | "failed" | "accepted" | "discarded"; by: ModelSpec; error?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };

export interface AdapterEvent {
  type: "status" | "text" | "tool" | "model" | "usage" | "rate_limit" | "raw" | "stderr";
  text?: string;
  model?: string;
  data?: unknown;
}

export const LETTERS = "ABCDEFGHIJ".split("");

export function specKey(s: ModelSpec): string {
  return `${s.adapter === "kimi" ? "openai-compat" : s.adapter}|${s.provider ?? ""}|${s.access ?? ""}|${s.model}`;
}
