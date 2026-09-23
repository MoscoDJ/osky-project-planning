import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Acta,
  AdapterEvent,
  CandidateInfo,
  DebateState,
  EngineEvent,
  Identity,
  ModelSpec,
  NewDebateOptions,
  ParticipantKey,
  TurnAttempt,
  TurnRecord,
} from "./types.js";
import type { Adapter, AdapterRegistry, TurnRequest, TurnResult } from "./adapters/types.js";
import { ACTA_SCHEMA, hasBlockingQuestion, validateActa } from "./schema.js";
import { Git } from "./git.js";
import { appendText, atomicWrite, exists, nowIso, readText, slugify } from "./fsutil.js";
import {
  BRIEF_FILE,
  CANDIDATE_FILE,
  DEBATE_FILE,
  DECISIONS_FILE,
  INTERNAL_DIR,
  PLAN_FILE,
  REQUIRED_HEADINGS,
  STATE_FILE,
  blockingAnswerPrompt,
  buildTurnPackage,
  consolidationPrompt,
  consolidatorRules,
  debateHeader,
  debateTurnEntry,
  other,
  planTemplate,
  protocolText,
  cliAnnex,
  rulesFileContent,
  rulesFileFor,
  turnObjective,
} from "./prompts.js";

export class EngineError extends Error {}
export class ExternalEditError extends EngineError {}

type Outcome = "published" | "paused" | "failed";

export class DebateEngine {
  private listeners = new Set<(e: EngineEvent) => void>();

  private constructor(
    public readonly workspace: string,
    public state: DebateState,
    private registry: AdapterRegistry,
  ) {}

  // ---------- ciclo de vida ----------

  static async create(opts: NewDebateOptions, registry: AdapterRegistry): Promise<DebateEngine> {
    const dirName = opts.dirName ?? `${new Date().toISOString().slice(0, 10)}-${slugify(opts.title)}`;
    const ws = path.join(opts.root, dirName);
    if (await exists(ws)) throw new EngineError(`Ya existe el workspace ${ws}`);
    await fs.mkdir(path.join(ws, INTERNAL_DIR, "turns"), { recursive: true });

    const opener: ParticipantKey =
      opts.opener === "A" || opts.opener === "B" ? opts.opener : Math.random() < 0.5 ? "A" : "B";
    const rounds = Math.max(1, opts.rounds ?? 3);
    const now = nowIso();
    const state: DebateState = {
      version: 1,
      id: randomUUID(),
      title: opts.title,
      createdAt: now,
      updatedAt: now,
      phase: "initial",
      opener,
      participants: {
        A: { key: "A", spec: opts.participants.A },
        B: { key: "B", spec: opts.participants.B },
      },
      config: {
        rounds,
        allowWeb: opts.allowWeb ?? true,
        contextDirs: (opts.contextDirs ?? []).map((d) => path.resolve(d)),
        autoSubstitute: opts.autoSubstitute ?? true,
        substitute: opts.substitute,
        consolidator: opts.consolidator,
        consolidatorAlt: opts.consolidatorAlt,
        turnTimeoutMs: opts.turnTimeoutMs ?? 20 * 60 * 1000,
        changeRatioThreshold: opts.changeRatioThreshold ?? 0.6,
        cycleOrder: opts.cycleOrder ?? "global",
      },
      turns: [],
      cycles: [],
      decisions: [...(opts.decisions ?? [])],
      clarifications: [],
      consolidationHistory: [],
      abbreviated: false,
      nextAction: "next",
    };
    const total = rounds * 2;
    for (let i = 1; i <= total; i++) {
      const participant: ParticipantKey = i % 2 === 1 ? opener : other(opener);
      state.turns.push({
        id: randomUUID(),
        number: i,
        kind: "initial",
        participant,
        position: Math.ceil(i / 2),
        positionTotal: rounds,
        objective: turnObjective("initial", i, total),
        status: "pending",
        attempts: [],
        modelRequested: state.participants[participant].spec.model,
        modelsReported: [],
      });
    }

    await atomicWrite(path.join(ws, PLAN_FILE), planTemplate(opts.title));
    await atomicWrite(path.join(ws, BRIEF_FILE), `# Petición del usuario\n\n${opts.brief.trim()}\n\n## Aclaraciones\n\n`);
    await atomicWrite(
      path.join(ws, DECISIONS_FILE),
      `# Decisiones del usuario\n\n${state.decisions.map((d) => `- ${d}`).join("\n")}${state.decisions.length ? "\n" : ""}`,
    );
    await atomicWrite(path.join(ws, DEBATE_FILE), debateHeader(state, opts.brief));
    await atomicWrite(path.join(ws, ".gitignore"), `${INTERNAL_DIR}/\n${STATE_FILE}\n*.tmp-*\n`);
    await atomicWrite(path.join(ws, INTERNAL_DIR, "schema.json"), JSON.stringify(ACTA_SCHEMA, null, 2));
    for (const p of ["A", "B"] as ParticipantKey[]) {
      const spec = state.participants[p].spec;
      await atomicWrite(path.join(ws, rulesFileFor(spec.adapter, p)), rulesFileContent(spec.adapter, p, rounds));
    }
    await Git.init(ws);
    await Git.commitAll(ws, "Setup del debate");

    const engine = new DebateEngine(ws, state, registry);
    await engine.save();
    return engine;
  }

  static async open(ws: string, registry: AdapterRegistry): Promise<DebateEngine> {
    const file = path.join(ws, STATE_FILE);
    if (!(await exists(file))) throw new EngineError(`No hay ${STATE_FILE} en ${ws}`);
    const state = JSON.parse(await readText(file)) as DebateState;
    const engine = new DebateEngine(path.resolve(ws), state, registry);
    // Un turno que quedó "running" es un proceso interrumpido: se trata como fallido.
    for (const t of state.turns) {
      if (t.status === "running") {
        t.status = "failed";
        t.error = "proceso interrumpido antes de terminar el turno";
        const last = t.attempts[t.attempts.length - 1];
        if (last && !last.finishedAt) {
          last.finishedAt = nowIso();
          last.outcome = "failed";
          last.error = t.error;
        }
      }
    }
    await engine.save();
    return engine;
  }

  on(listener: (e: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: EngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  private async save(): Promise<void> {
    this.state.updatedAt = nowIso();
    await atomicWrite(path.join(this.workspace, STATE_FILE), JSON.stringify(this.state, null, 2) + "\n");
  }

  private setNext(action: string): void {
    this.state.nextAction = action;
    this.emit({ type: "phase", phase: this.state.phase, nextAction: action });
  }

  // ---------- consultas ----------

  currentTurn(): TurnRecord | undefined {
    return this.state.turns.find((t) => t.status === "pending" || t.status === "failed" || t.status === "paused_blocking");
  }

  pausedTurn(): TurnRecord | undefined {
    return this.state.turns.find((t) => t.status === "paused_blocking");
  }

  labelFor(spec: ModelSpec): string {
    return spec.label;
  }

  summary(): string {
    const s = this.state;
    const lines = [
      `Debate: ${s.title}`,
      `Workspace: ${this.workspace}`,
      `Fase: ${s.phase} · Siguiente acción: ${s.nextAction}`,
      `Abre: Participante ${s.opener} · A = ${s.participants.A.spec.label} · B = ${s.participants.B.spec.label}`,
      `Rondas: ${s.config.rounds} · Web: ${s.config.allowWeb ? "sí" : "no"} · Sustituto automático: ${s.config.autoSubstitute ? s.config.substitute.label : "no"} · Orden de ciclos: ${s.config.cycleOrder}`,
      ...(s.abbreviated ? ["DEBATE ABREVIADO: se saltó al menos un turno; no se completaron todas las intervenciones."] : []),
      "",
      "Turnos:",
    ];
    for (const t of s.turns) {
      const sub = t.substitute ? ` [sustituto ${t.substitute}]` : "";
      const flag = t.reviewFlag ? ` ⚠ ${t.reviewFlag}` : "";
      const err = t.status === "failed" && t.error ? ` — ${t.error}` : "";
      lines.push(`  ${String(t.number).padStart(2)}. ${t.participant} ${t.kind === "cycle" ? `c${(t.cycleIndex ?? 0) + 1}` : "  "} ${t.status.padEnd(15)} intentos=${t.attempts.length}${sub}${flag}${err}`);
    }
    if (s.candidate) lines.push("", `Candidato de consolidación: ${s.candidate.status} (${s.candidate.by.label})`);
    return lines.join("\n");
  }

  // ---------- turnos ----------

  /** Ejecuta el siguiente turno pendiente con reintento y sustitución automática. */
  async next(opts: { force?: boolean } = {}): Promise<TurnRecord> {
    const s = this.state;
    if (s.phase !== "initial" && s.phase !== "user_cycle") {
      throw new EngineError(`No hay turnos que ejecutar en la fase "${s.phase}". Siguiente acción: ${s.nextAction}`);
    }
    if (this.pausedTurn()) {
      throw new EngineError("Hay un turno pausado por una pregunta bloqueante. Responde con `say`.");
    }
    const turn = this.currentTurn();
    if (!turn) throw new EngineError("No queda ningún turno pendiente.");

    const own = s.participants[turn.participant].spec;
    const sub = s.config.substitute;
    const ownAttempts = turn.attempts.filter((a) => a.model === own.model && a.adapter === own.adapter).length;
    const subAttempts = turn.attempts.filter((a) => a.model === sub.model && a.adapter === sub.adapter).length;

    const canOwn = opts.force ? true : ownAttempts < 2;
    const canSub = s.config.autoSubstitute && (opts.force ? true : subAttempts < 1);

    if (!canOwn && !canSub) {
      this.setNext("El turno falló tras reintento y sustitución. Usa `retry` (vuelve a intentar) o `skip` (lo salta).");
      await this.save();
      return turn;
    }

    // Intentos con el modelo propio: hasta dos (primer intento + reintento).
    let outcome: Outcome = "failed";
    let tries = opts.force ? 1 : 2 - ownAttempts;
    while (tries > 0 && canOwn) {
      outcome = await this.executeTurn(turn, own);
      if (outcome !== "failed") return turn;
      tries--;
    }
    if (canSub) {
      turn.substituteReason = (turn.error ?? "fallo del modelo original").split("\n")[0].slice(0, 200);
      this.emit({ type: "log", level: "warn", message: `Turno ${turn.number}: ${own.label} falló dos veces; entra ${sub.label} como sustituto temporal.` });
      outcome = await this.executeTurn(turn, sub);
      if (outcome !== "failed") return turn;
    }
    this.setNext("El turno falló tras reintento y sustitución. Usa `retry` o `skip`.");
    await this.save();
    return turn;
  }

  /** Ejecuta turnos hasta que haga falta el usuario o algo falle. */
  async run(): Promise<void> {
    for (;;) {
      const s = this.state;
      if (s.phase !== "initial" && s.phase !== "user_cycle") return;
      if (this.pausedTurn()) return;
      const t = this.currentTurn();
      if (!t) return;
      const before = t.attempts.length;
      const done = await this.next();
      if (done.status !== "published" && done.status !== "skipped") return;
      if (done.attempts.length === before) return;
    }
  }

  async retry(): Promise<TurnRecord> {
    return this.next({ force: true });
  }

  async skip(): Promise<TurnRecord> {
    const turn = this.currentTurn();
    if (!turn || turn.status !== "failed") throw new EngineError("Solo se puede saltar un turno fallido.");
    await Git.restore(this.workspace);
    turn.status = "skipped";
    this.state.abbreviated = true;
    await appendText(
      path.join(this.workspace, DEBATE_FILE),
      `## Turno ${turn.number} · Participante ${turn.participant} — saltado por el usuario\n\nCausa: ${turn.error ?? "n/d"}\n\n`,
    );
    await Git.commitAll(this.workspace, `Turno ${turn.number} · Participante ${turn.participant} (saltado)`);
    this.advanceAfter(turn);
    await this.save();
    this.emit({ type: "turn_end", turn, outcome: "failed" });
    this.emitPhase();
    return turn;
  }

  private specOwn(turn: TurnRecord): ModelSpec {
    return this.state.participants[turn.participant].spec;
  }

  private isOwn(turn: TurnRecord, spec: ModelSpec): boolean {
    const own = this.specOwn(turn);
    return own.model === spec.model && own.adapter === spec.adapter;
  }

  private lockPath(): string {
    return path.join(this.workspace, INTERNAL_DIR, "lock");
  }

  /** Exclusión mutua por debate: dos procesos (o dos ventanas) no ejecutan turnos a la vez. */
  private async acquireLock(): Promise<void> {
    const file = this.lockPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const payload = JSON.stringify({ pid: process.pid, at: nowIso() });
    try {
      await fs.writeFile(file, payload, { flag: "wx" });
      return;
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
    }
    let holder: { pid?: number } = {};
    try {
      holder = JSON.parse(await readText(file));
    } catch {
      /* lock corrupto: se trata como huérfano */
    }
    if (holder.pid && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
      throw new EngineError(`Otro proceso (pid ${holder.pid}) está ejecutando un turno en este debate.`);
    }
    await fs.writeFile(file, payload);
  }

  private async releaseLock(): Promise<void> {
    try {
      await fs.rm(this.lockPath(), { force: true });
    } catch {
      /* nada */
    }
  }

  private async executeTurn(turn: TurnRecord, spec: ModelSpec, resume?: { answer: string }): Promise<Outcome> {
    await this.acquireLock();
    try {
      return await this.executeTurnUnlocked(turn, spec, resume);
    } finally {
      await this.releaseLock();
    }
  }

  private async executeTurnUnlocked(turn: TurnRecord, spec: ModelSpec, resume?: { answer: string }): Promise<Outcome> {
    const ws = this.workspace;
    const s = this.state;
    const adapter = this.registry.get(spec);

    if (!resume) {
      const dirty = await Git.changedFiles(ws);
      if (dirty.length) {
        throw new ExternalEditError(
          `El workspace tiene cambios fuera de turno (${dirty.join(", ")}). Resuélvelos (commit manual o \`git checkout\`) antes de continuar.`,
        );
      }
      turn.baseCommit = await Git.head(ws);
    }
    if (!turn.baseCommit) turn.baseCommit = await Git.head(ws);

    const attempt: TurnAttempt = {
      n: turn.attempts.length + 1,
      model: spec.model,
      adapter: spec.adapter,
      startedAt: nowIso(),
      outcome: "failed",
    };
    attempt.logFile = path.join(INTERNAL_DIR, "turns", `turn-${turn.number}-${attempt.n}.jsonl`);
    turn.attempts.push(attempt);
    turn.status = "running";
    turn.modelRequested = spec.model;
    turn.error = undefined;
    await this.save();
    this.emit({ type: "turn_start", turn, model: spec.model, attempt: attempt.n });

    const own = this.isOwn(turn, spec);
    // La marca de sustituto describe el intento en curso, no la historia del turno.
    turn.substitute = own ? undefined : spec.label;
    if (own) turn.substituteReason = undefined;
    const sessionId = own ? s.participants[turn.participant].sessionId : undefined;
    const planContent = await readText(path.join(ws, PLAN_FILE));
    const prompt = await this.buildPrompt(turn, adapter, spec, planContent, sessionId, resume?.answer);
    await atomicWrite(path.join(ws, INTERNAL_DIR, "turns", `turn-${turn.number}-${attempt.n}.prompt.md`), prompt);
    const req: TurnRequest = {
      workspace: ws,
      prompt,
      systemPrompt: protocolText({ participant: turn.participant, rounds: s.config.rounds }) + cliAnnex(spec.adapter, "participant", PLAN_FILE),
      rulesFile: rulesFileFor(spec.adapter, turn.participant),
      schemaFile: path.join(ws, INTERNAL_DIR, "schema.json"),
      schema: ACTA_SCHEMA,
      spec,
      sessionId: adapter.supportsResume ? sessionId : undefined,
      role: "participant",
      allowWeb: s.config.allowWeb,
      contextDirs: s.config.contextDirs,
      targetFile: PLAN_FILE,
      planContent,
      logFile: path.join(ws, attempt.logFile),
      timeoutMs: s.config.turnTimeoutMs,
      turnNumber: turn.number,
    };

    let result: TurnResult;
    try {
      result = await adapter.runTurn(req, (event: AdapterEvent) => this.emit({ type: "adapter", turn, event }));
    } catch (err: any) {
      result = { ok: false, error: `excepción del adaptador: ${err?.message ?? err}`, modelsReported: [], text: "" };
    }
    attempt.finishedAt = nowIso();

    if (own && result.sessionId && adapter.supportsResume) {
      s.participants[turn.participant].sessionId = result.sessionId;
    }
    turn.modelsReported = result.modelsReported;
    turn.identity = computeIdentity(spec.model, result.modelsReported);
    if (result.usage) turn.usage = result.usage;
    if (result.costEstimateUsd !== undefined) turn.costEstimateUsd = result.costEstimateUsd;

    if (!result.ok) return this.fail(turn, attempt, result.error ?? "error desconocido");
    if (turn.identity === "mismatch") {
      return this.fail(turn, attempt, `identidad no confirmada: se pidió ${spec.model} y respondió ${result.modelsReported.join(", ")}`);
    }
    if (!adapter.editsFiles) {
      if (!result.fullDocument) return this.fail(turn, attempt, "el adaptador no devolvió el documento completo");
      await atomicWrite(path.join(ws, PLAN_FILE), result.fullDocument);
    }
    const v = validateActa(result.acta);
    if (!v.ok) return this.fail(turn, attempt, `acta inválida: ${(v.errors ?? []).join("; ")}`);
    const acta = v.acta!;
    turn.acta = acta;

    if (hasBlockingQuestion(acta) && !resume) {
      turn.status = "paused_blocking";
      attempt.outcome = "paused";
      const q = acta.preguntas_usuario.filter((p) => p.bloqueante).map((p) => p.pregunta).join(" | ");
      this.setNext(`Pregunta bloqueante del Participante ${turn.participant}: ${q}. Responde con \`say\`.`);
      await this.save();
      this.emit({ type: "turn_end", turn, outcome: "paused" });
      return "paused";
    }

    const validation = await this.validatePublish(turn, acta);
    if (validation.error) return this.fail(turn, attempt, validation.error);
    turn.reviewFlag = validation.flag;
    turn.changeRatio = validation.ratio;

    if (turn.blockingAnswer) {
      await appendText(path.join(ws, BRIEF_FILE), `- (turno ${turn.number}) ${turn.blockingAnswer}\n`);
    }
    await appendText(path.join(ws, DEBATE_FILE), debateTurnEntry(turn, spec.label));
    const subNote = turn.substitute ? ` (sustituto ${turn.substitute})` : "";
    turn.commit = await Git.commitAll(ws, `Turno ${turn.number} · Participante ${turn.participant}${subNote}`);
    turn.status = "published";
    attempt.outcome = "published";
    this.advanceAfter(turn);
    await this.save();
    this.emit({ type: "turn_end", turn, outcome: "published" });
    this.emitPhase();
    return "published";
  }

  private async buildPrompt(
    turn: TurnRecord,
    adapter: Adapter,
    spec: ModelSpec,
    planContent: string,
    sessionId: string | undefined,
    answer?: string,
  ): Promise<string> {
    const s = this.state;
    if (answer && adapter.supportsResume && sessionId && this.isOwn(turn, spec)) {
      return blockingAnswerPrompt(answer);
    }
    const brief = await readText(path.join(this.workspace, BRIEF_FILE));
    const lastOther = [...s.turns]
      .filter((t) => t.number < turn.number && t.participant !== turn.participant && t.status === "published" && t.acta)
      .pop();
    let lastOtherDiff: string | undefined;
    if (lastOther?.commit && lastOther.baseCommit) {
      try {
        lastOtherDiff = await Git.diff(this.workspace, lastOther.baseCommit, lastOther.commit, PLAN_FILE);
      } catch {
        lastOtherDiff = undefined;
      }
    }
    const cycle = turn.kind === "cycle" && turn.cycleIndex !== undefined ? s.cycles[turn.cycleIndex] : undefined;
    const inline = !adapter.editsFiles;
    return buildTurnPackage({
      state: s,
      turn,
      planCommit: turn.baseCommit ?? "HEAD",
      brief,
      lastOtherTurn: lastOther,
      lastOtherDiff,
      observation: cycle?.observation,
      blockingAnswer: answer,
      includeProtocol: inline || !adapter.supportsResume || !this.isOwn(turn, spec),
      planContent: inline ? planContent : undefined,
    });
  }

  private async validatePublish(turn: TurnRecord, acta: Acta): Promise<{ error?: string; flag?: string; ratio?: number }> {
    const ws = this.workspace;
    const changed = await Git.changedFiles(ws);
    const outOfScope = changed.filter((f) => f !== PLAN_FILE);
    if (outOfScope.length) return { error: `archivos fuera de alcance modificados: ${outOfScope.join(", ")}` };
    const planChanged = changed.includes(PLAN_FILE);
    if (turn.number === 1 && !planChanged) return { error: "el turno de apertura no escribió el plan" };
    const content = await readText(path.join(ws, PLAN_FILE));
    const md = checkMarkdown(content);
    if (md) return { error: md };
    let flag: string | undefined;
    let ratio: number | undefined;
    if (planChanged) {
      const base = await Git.show(ws, turn.baseCommit ?? "HEAD", PLAN_FILE);
      const baseLines = base.split("\n").length;
      const ns = await Git.numstat(ws, PLAN_FILE);
      ratio = baseLines > 0 ? (ns.added + ns.deleted) / baseLines : 1;
      if (turn.number > 1 && ratio > this.state.config.changeRatioThreshold) {
        flag = `cambió ${(ratio * 100).toFixed(0)}% del plan; revisar si la reestructuración está justificada`;
      }
    } else if (!acta.sin_cambios) {
      flag = "el acta declara cambios pero el plan no cambió";
    }
    return { flag, ratio };
  }

  private async fail(turn: TurnRecord, attempt: TurnAttempt, error: string): Promise<Outcome> {
    attempt.outcome = "failed";
    attempt.error = error;
    turn.error = error;
    turn.status = "failed";
    try {
      await Git.restore(this.workspace);
    } catch (e: any) {
      this.emit({ type: "log", level: "error", message: `No se pudo restaurar el workspace: ${e?.message ?? e}` });
    }
    this.emit({ type: "log", level: "error", message: `Turno ${turn.number} (${attempt.model}) falló: ${error}` });
    await this.save();
    this.emit({ type: "turn_end", turn, outcome: "failed" });
    return "failed";
  }

  private advanceAfter(turn: TurnRecord): void {
    const s = this.state;
    const isLastInitial = turn.kind === "initial" && turn.number === s.config.rounds * 2;
    const isLastOfCycle = turn.kind === "cycle" && turn.position === 2;
    if (isLastInitial || isLastOfCycle) {
      s.phase = "awaiting_user";
      s.nextAction = "Escribe una observación con `say` (abre un ciclo de dos respuestas) o cierra con `finalize`.";
    } else {
      s.phase = turn.kind === "initial" ? "initial" : "user_cycle";
      s.nextAction = "next";
    }
  }

  private emitPhase(): void {
    this.emit({ type: "phase", phase: this.state.phase, nextAction: this.state.nextAction });
  }

  // ---------- usuario ----------

  /** Observación del usuario (abre un ciclo) o respuesta a una pregunta bloqueante. */
  async say(text: string): Promise<{ kind: "answer"; turn: TurnRecord } | { kind: "cycle"; turns: TurnRecord[] }> {
    const s = this.state;
    const clean = text.trim();
    if (!clean) throw new EngineError("El texto está vacío.");
    const paused = this.pausedTurn();
    if (paused) {
      s.clarifications.push(clean);
      paused.blockingAnswer = clean;
      const spec = paused.substitute ? s.config.substitute : this.specOwn(paused);
      await this.executeTurn(paused, spec, { answer: clean });
      return { kind: "answer", turn: paused };
    }
    if (s.phase !== "awaiting_user") {
      throw new EngineError(`No se aceptan observaciones en la fase "${s.phase}". Siguiente acción: ${s.nextAction}`);
    }
    const index = s.cycles.length;
    const lastSpeaker = [...s.turns].filter((t) => t.status === "published" || t.status === "skipped").pop()?.participant ?? s.opener;
    const starts: ParticipantKey =
      s.config.cycleOrder === "alternate" ? (index % 2 === 0 ? other(s.opener) : s.opener) : other(lastSpeaker);
    const nextNumber = Math.max(0, ...s.turns.map((t) => t.number)) + 1;
    const turns: TurnRecord[] = [1, 2].map((pos) => {
      const participant = pos === 1 ? starts : other(starts);
      return {
        id: randomUUID(),
        number: nextNumber + pos - 1,
        kind: "cycle" as const,
        participant,
        position: pos,
        positionTotal: 2,
        cycleIndex: index,
        objective: turnObjective("cycle", pos, 2, pos),
        status: "pending" as const,
        attempts: [],
        modelRequested: s.participants[participant].spec.model,
        modelsReported: [],
      };
    });
    s.cycles.push({ index, observation: clean, starts, turnNumbers: turns.map((t) => t.number), createdAt: nowIso() });
    s.turns.push(...turns);
    await appendText(path.join(this.workspace, DEBATE_FILE), `## Observación del usuario (ciclo ${index + 1})\n\n${clean}\n\n`);
    await Git.commitAll(this.workspace, `Observación del usuario · ciclo ${index + 1}`);
    s.phase = "user_cycle";
    this.setNext("next");
    await this.save();
    return { kind: "cycle", turns };
  }

  async decide(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) throw new EngineError("La decisión está vacía.");
    if (await this.hasDirtyTree()) throw new ExternalEditError("Hay cambios sin publicar en el workspace; no se puede registrar la decisión ahora.");
    this.state.decisions.push(clean);
    await appendText(path.join(this.workspace, DECISIONS_FILE), `- ${clean}\n`);
    await Git.commitAll(this.workspace, "Decisión del usuario");
    await this.save();
  }

  private async hasDirtyTree(): Promise<boolean> {
    return (await Git.changedFiles(this.workspace)).length > 0;
  }

  async finalize(): Promise<void> {
    const s = this.state;
    if (s.phase !== "awaiting_user") {
      throw new EngineError(`Solo se puede finalizar en espera del usuario (fase actual: ${s.phase}).`);
    }
    s.phase = "finalized";
    await Git.tag(this.workspace, "final", "Plan aprobado por el usuario");
    this.setNext("Plan aprobado. Opcional: `consolidate` produce un candidato revisable; `consolidate --alt` usa la alternativa.");
    await this.save();
  }

  // ---------- consolidación ----------

  async consolidate(which: "primary" | "alt" = "primary"): Promise<CandidateInfo> {
    await this.acquireLock();
    try {
      return await this.consolidateUnlocked(which);
    } finally {
      await this.releaseLock();
    }
  }

  private async consolidateUnlocked(which: "primary" | "alt"): Promise<CandidateInfo> {
    const s = this.state;
    const ws = this.workspace;
    if (s.phase !== "finalized" && s.phase !== "candidate_ready") {
      throw new EngineError(`La consolidación requiere un plan finalizado (fase actual: ${s.phase}).`);
    }
    const spec = which === "alt" ? s.config.consolidatorAlt : s.config.consolidator;
    const adapter = this.registry.get(spec);
    const candidatePath = path.join(ws, CANDIDATE_FILE);
    if (s.candidate && s.candidate.status === "ready") {
      s.consolidationHistory.push({ ...s.candidate, status: "discarded" });
      s.candidate = undefined;
    }
    if (await exists(candidatePath)) await fs.rm(candidatePath);
    if (await this.hasDirtyTree()) throw new ExternalEditError("Hay cambios sin publicar en el workspace; resuélvelos antes de consolidar.");

    const info: CandidateInfo = {
      by: spec,
      createdAt: nowIso(),
      status: "failed",
      logFile: path.join(INTERNAL_DIR, "turns", `consolidation-${Date.now()}.jsonl`),
    };
    this.emit({ type: "consolidation", status: "start", by: spec });

    const rulesFile = rulesFileFor(spec.adapter, "consolidator");
    if (adapter.editsFiles) {
      await atomicWrite(path.join(ws, rulesFile), consolidatorRules(spec.adapter));
      await Git.commitAll(ws, `Preparar consolidación · ${spec.label}`);
    }
    const planContent = await readText(path.join(ws, PLAN_FILE));
    await atomicWrite(candidatePath, planContent);
    const brief = await readText(path.join(ws, BRIEF_FILE));
    const debateContent = await readText(path.join(ws, DEBATE_FILE));
    const prompt = consolidationPrompt({
      brief,
      decisions: s.decisions,
      clarifications: s.clarifications,
      planContent,
      debateContent,
      inline: !adapter.editsFiles,
    });
    await atomicWrite(path.join(ws, INTERNAL_DIR, "turns", `consolidation-${Date.now()}.prompt.md`), prompt);
    const req: TurnRequest = {
      workspace: ws,
      prompt,
      systemPrompt: consolidatorRules(spec.adapter),
      rulesFile,
      schemaFile: path.join(ws, INTERNAL_DIR, "schema.json"),
      schema: ACTA_SCHEMA,
      spec,
      role: "consolidator",
      allowWeb: false,
      contextDirs: [],
      targetFile: CANDIDATE_FILE,
      planContent,
      logFile: path.join(ws, info.logFile!),
      timeoutMs: s.config.turnTimeoutMs,
      turnNumber: 0,
    };

    let result: TurnResult;
    try {
      result = await adapter.runTurn(req, (event) => this.emit({ type: "adapter", event }));
    } catch (err: any) {
      result = { ok: false, error: `excepción del adaptador: ${err?.message ?? err}`, modelsReported: [], text: "" };
    }

    const failCandidate = async (error: string): Promise<CandidateInfo> => {
      info.status = "failed";
      info.error = error;
      s.consolidationHistory.push(info);
      s.candidate = undefined;
      await Git.restore(ws);
      if (await exists(candidatePath)) await fs.rm(candidatePath);
      s.phase = "finalized";
      this.setNext(`La consolidación con ${spec.label} falló: ${error}. El plan aprobado sigue intacto. Reintenta con \`consolidate\` o usa \`consolidate --alt\`.`);
      await this.save();
      this.emit({ type: "consolidation", status: "failed", by: spec, error });
      return info;
    };

    if (!result.ok) return failCandidate(result.error ?? "error desconocido");
    const identity = computeIdentity(spec.model, result.modelsReported);
    if (identity === "mismatch") return failCandidate(`identidad no confirmada: respondió ${result.modelsReported.join(", ")}`);
    if (!adapter.editsFiles) {
      if (!result.fullDocument) return failCandidate("el consolidador no devolvió el documento completo");
      await atomicWrite(candidatePath, result.fullDocument);
    }
    const changed = await Git.changedFiles(ws);
    const outOfScope = changed.filter((f) => f !== CANDIDATE_FILE);
    if (outOfScope.length) return failCandidate(`archivos fuera de alcance modificados: ${outOfScope.join(", ")}`);
    const content = await readText(candidatePath);
    const md = checkMarkdown(content);
    if (md) return failCandidate(`candidato inválido: ${md}`);
    if (!/^##\s+Puntos sin consenso/m.test(content)) return failCandidate("el candidato no incluye la sección 'Puntos sin consenso'");
    if (content.trim() === planContent.trim()) return failCandidate("el candidato es idéntico al plan aprobado");

    info.status = "ready";
    info.report = result.text.trim().slice(0, 4000) || undefined;
    s.candidate = info;
    s.phase = "candidate_ready";
    this.setNext("Candidato listo en plan.candidate.md. Revisa el diff y usa `accept` o `discard`.");
    await this.save();
    this.emit({ type: "consolidation", status: "ready", by: spec });
    return info;
  }

  async candidateDiff(): Promise<string> {
    if (this.state.phase !== "candidate_ready") throw new EngineError("No hay candidato de consolidación.");
    const r = await import("./fsutil.js").then((m) =>
      m.execCmd("git", ["diff", "--no-color", "--no-index", "--", PLAN_FILE, CANDIDATE_FILE], { cwd: this.workspace }),
    );
    return r.stdout;
  }

  async acceptCandidate(): Promise<void> {
    const s = this.state;
    if (s.phase !== "candidate_ready" || !s.candidate) throw new EngineError("No hay candidato que aceptar.");
    const ws = this.workspace;
    const content = await readText(path.join(ws, CANDIDATE_FILE));
    await atomicWrite(path.join(ws, PLAN_FILE), content);
    await fs.rm(path.join(ws, CANDIDATE_FILE));
    await appendText(
      path.join(ws, DEBATE_FILE),
      `## Consolidación aceptada por el usuario\n\nConsolidador: ${s.candidate.by.label}. Fecha: ${nowIso()}.\n\n`,
    );
    await Git.commitAll(ws, `Consolidación · ${s.candidate.by.label}`);
    s.candidate.status = "accepted";
    s.consolidationHistory.push(s.candidate);
    const by = s.candidate.by;
    s.candidate = undefined;
    s.phase = "closed";
    this.setNext("Debate cerrado. plan.md contiene la versión consolidada.");
    await this.save();
    this.emit({ type: "consolidation", status: "accepted", by });
  }

  async discardCandidate(): Promise<void> {
    const s = this.state;
    if (s.phase !== "candidate_ready" || !s.candidate) throw new EngineError("No hay candidato que descartar.");
    const candidatePath = path.join(this.workspace, CANDIDATE_FILE);
    if (await exists(candidatePath)) await fs.rm(candidatePath);
    s.candidate.status = "discarded";
    s.consolidationHistory.push(s.candidate);
    const by = s.candidate.by;
    s.candidate = undefined;
    s.phase = "finalized";
    this.setNext("Candidato descartado. El plan aprobado sigue vigente. Puedes volver a `consolidate` o cerrar.");
    await this.save();
    this.emit({ type: "consolidation", status: "discarded", by });
  }
}

// ---------- utilidades ----------

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

export function computeIdentity(expected: string, reported: string[]): Identity {
  const relevant = reported.filter((m) => !/haiku/i.test(m));
  if (relevant.length === 0) return reported.length ? "confirmed" : "unreported";
  return relevant.every((m) => m === expected || m.startsWith(expected)) ? "confirmed" : "mismatch";
}

export function checkMarkdown(content: string): string | undefined {
  if (!content.trim()) return "el plan está vacío";
  if (!/^#\s+\S/m.test(content)) return "el plan no tiene título de nivel 1";
  const headings = content.match(/^##\s+\S/gm) ?? [];
  if (headings.length < 3) return "el plan tiene menos de tres secciones";
  const missing = REQUIRED_HEADINGS.filter((h) => !new RegExp(`^##\\s+.*${h}`, "mi").test(content));
  if (missing.length) return `faltan encabezados de la plantilla: ${missing.join(", ")}`;
  return undefined;
}
