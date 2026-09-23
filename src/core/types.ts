// Tipos centrales del motor de debate.

export type ParticipantKey = "A" | "B";
export type Role = ParticipantKey | "consolidator";

export type AdapterId = "claude" | "codex" | "gemini" | "kimi" | "fake";

export interface ModelSpec {
  adapter: AdapterId;
  model: string;
  effort?: string;
  /** Nombre legible para el usuario (nunca se envía a los modelos). */
  label: string;
}

export interface ParticipantConfig {
  key: ParticipantKey;
  spec: ModelSpec;
  /** Id de sesión del CLI (session_id de Claude, thread_id de Codex). */
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
  /** Intervención i de N dentro de la fase inicial, o posición 1/2 dentro de un ciclo. */
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
 * - global: empieza quien no habló último; conserva la alternancia A/B en todo el debate.
 * - alternate: alterna quién abre cada ciclo; reparte el cierre pero un participante
 *   puede hablar a ambos lados de la intervención del usuario.
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
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  phase: Phase;
  opener: ParticipantKey;
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
  opener?: ParticipantKey | "random";
  participants: { A: ModelSpec; B: ModelSpec };
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
