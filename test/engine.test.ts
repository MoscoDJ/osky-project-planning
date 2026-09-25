import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DebateEngine, computeIdentity, checkMarkdown } from "../src/core/engine.js";
import { FakeAdapter, type FakeBehavior } from "../src/core/adapters/fake.js";
import { Registry } from "../src/core/adapters/registry.js";
import { validateActa } from "../src/core/schema.js";
import { parseKimiOutput } from "../src/core/adapters/kimi.js";
import { Git } from "../src/core/git.js";
import { FAKE_MODELS } from "../src/core/config.js";
import type { NewDebateOptions } from "../src/core/types.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "osky-debate-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function opts(over: Partial<NewDebateOptions> = {}): NewDebateOptions {
  return {
    root,
    title: "Proyecto de prueba",
    brief: "Quiero un script que renombre fotos por fecha EXIF.",
    rounds: 2,
    allowWeb: false,
    opener: "A",
    participants: { A: FAKE_MODELS.A, B: FAKE_MODELS.B },
    substitute: FAKE_MODELS.substitute,
    consolidator: FAKE_MODELS.consolidator,
    consolidatorAlt: FAKE_MODELS.consolidatorAlt,
    dirName: "debate",
    ...over,
  };
}

function make(behaviors: Record<string, FakeBehavior> = {}) {
  const fake = new FakeAdapter(behaviors);
  return { fake, registry: new Registry([fake]) };
}

describe("acta", () => {
  it("acepta listas vacías: no se fabrican rechazos", () => {
    const v = validateActa({
      resumen: "ok",
      evaluacion: "bien",
      cambios: [],
      acuerdos: [],
      rechazos: [],
      desacuerdos: [],
      riesgos: [],
      preguntas_usuario: [],
      fuentes: [],
      sin_cambios: true,
    });
    expect(v.ok).toBe(true);
  });
  it("rechaza actas incompletas", () => {
    const v = validateActa({ resumen: "ok" });
    expect(v.ok).toBe(false);
    expect(v.errors!.length).toBeGreaterThan(0);
  });
});

describe("identidad y markdown", () => {
  it("confirma, marca no reportado y detecta sustituciones", () => {
    expect(computeIdentity("claude-fable-5-1", ["claude-fable-5-1"])).toBe("confirmed");
    expect(computeIdentity("claude-fable-5-1", ["claude-fable-5-1", "claude-haiku-4-5-20251001"])).toBe("confirmed");
    expect(computeIdentity("claude-fable-5-1", ["claude-opus-4-8"])).toBe("mismatch");
    expect(computeIdentity("gpt-6-astra", [])).toBe("unreported");
  });
  it("valida la plantilla del plan", () => {
    expect(checkMarkdown("")).toBeTruthy();
    expect(checkMarkdown("# T\n\n## Objetivo\n\n## Alcance\n\n## Etapas\n\n## Riesgos\n")).toBeUndefined();
    expect(checkMarkdown("# T\n\n## Objetivo\n\n## Alcance\n")).toMatch(/faltan|menos de tres/);
  });
  it("parsea la salida de Kimi entre marcadores", () => {
    const out = "bla\n===PLAN===\n```markdown\n# P\n\n## Objetivo\n```\n===ACTA===\n{\"resumen\":\"x\"}\n===FIN===";
    const p = parseKimiOutput(out, "participant");
    expect(p.fullDocument).toBe("# P\n\n## Objetivo\n");
    expect((p.acta as any).resumen).toBe("x");
  });
});

describe("flujo del debate", () => {
  it("fase inicial completa, ciclo de observación, finalización y consolidación revisable", async () => {
    const { fake, registry } = make();
    const engine = await DebateEngine.create(opts(), registry);
    expect(engine.state.turns).toHaveLength(4);
    expect(engine.state.turns.map((t) => t.participant)).toEqual(["A", "B", "A", "B"]);

    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");
    expect(engine.state.turns.every((t) => t.status === "published")).toBe(true);
    const log = await Git.log(engine.workspace);
    expect(log.map((l) => l.subject)).toEqual([
      "Turno 4 · Participante B",
      "Turno 3 · Participante A",
      "Turno 2 · Participante B",
      "Turno 1 · Participante A",
      "Setup del debate",
    ]);
    // Sesiones persistidas y reanudadas por participante.
    expect(engine.state.participants.A.sessionId).toMatch(/fake-session-fake-a/);
    expect(fake.calls.filter((c) => c.turn === 3)[0].resumed).toBe(true);

    // Ciclo con orden global: empieza quien no habló último (B cerró la fase → abre A).
    const r = await engine.say("Quiero que también soporte RAW.");
    expect(r.kind).toBe("cycle");
    expect(engine.state.phase).toBe("user_cycle");
    expect(engine.state.turns.slice(4).map((t) => t.participant)).toEqual(["A", "B"]);
    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");
    const debateMd = await fs.readFile(path.join(engine.workspace, "debate.md"), "utf8");
    expect(debateMd).toContain("Observación del usuario (ciclo 1)");
    expect(debateMd).toContain("## Turno 6 · Participante B");

    // Segundo ciclo: sigue la alternancia global, nadie habla dos veces seguidas.
    await engine.say("Segunda observación.");
    expect(engine.state.turns.slice(6).map((t) => t.participant)).toEqual(["A", "B"]);
    expect(engine.state.turns.map((t) => t.participant)).toEqual(["A", "B", "A", "B", "A", "B", "A", "B"]);
    await engine.run();

    await engine.finalize();
    expect(engine.state.phase).toBe("finalized");
    const approved = await fs.readFile(path.join(engine.workspace, "plan.md"), "utf8");

    const info = await engine.consolidate();
    expect(info.status).toBe("ready");
    expect(engine.state.phase).toBe("candidate_ready");
    // El plan aprobado no se toca hasta aceptar.
    expect(await fs.readFile(path.join(engine.workspace, "plan.md"), "utf8")).toBe(approved);
    const candidate = await fs.readFile(path.join(engine.workspace, "plan.candidate.md"), "utf8");
    expect(candidate).toContain("## Puntos sin consenso");

    await engine.discardCandidate();
    expect(engine.state.phase).toBe("finalized");
    expect(await fs.readFile(path.join(engine.workspace, "plan.md"), "utf8")).toBe(approved);

    await engine.consolidate("alt");
    await engine.acceptCandidate();
    expect(engine.state.phase).toBe("closed");
    const final = await fs.readFile(path.join(engine.workspace, "plan.md"), "utf8");
    expect(final).toContain("## Puntos sin consenso");
    const log2 = await Git.log(engine.workspace, 1);
    expect(log2[0].subject).toBe("Consolidación · Simulado Kimi");
  });

  it("reintenta una vez y después entra el sustituto temporal", async () => {
    const { fake, registry } = make({ "fake-a": { failTimes: 2 } });
    const engine = await DebateEngine.create(opts(), registry);
    const t = await engine.next();
    expect(t.status).toBe("published");
    expect(t.attempts).toHaveLength(3);
    expect(t.attempts.map((a) => a.model)).toEqual(["fake-a", "fake-a", "fake-kimi"]);
    expect(t.substitute).toBe("Simulado Kimi");
    const log = await Git.log(engine.workspace, 1);
    expect(log[0].subject).toBe("Turno 1 · Participante A (sustituto Simulado Kimi)");
    // El modelo original vuelve en su siguiente turno.
    await engine.next(); // turno 2, B
    const t3 = await engine.next();
    expect(t3.participant).toBe("A");
    expect(t3.substitute).toBeUndefined();
    expect(t3.attempts[0].model).toBe("fake-a");
    expect(fake.calls.length).toBe(5);
  });

  it("si el modelo propio publica en el reintento no queda marca de sustituto", async () => {
    const { registry } = make({ "fake-a": { failTimes: 1 } });
    const engine = await DebateEngine.create(opts(), registry);
    const t = await engine.next();
    expect(t.status).toBe("published");
    expect(t.attempts).toHaveLength(2);
    expect(t.substitute).toBeUndefined();
    const log = await Git.log(engine.workspace, 1);
    expect(log[0].subject).toBe("Turno 1 · Participante A");
  });

  it("tras fallar propio y sustituto, retry con el propio publica sin marca de sustituto", async () => {
    const { registry } = make({ "fake-a": { failTimes: 2 }, "fake-kimi": { failTimes: 1 } });
    const engine = await DebateEngine.create(opts(), registry);
    const t = await engine.next();
    expect(t.status).toBe("failed");
    expect(t.substitute).toBe("Simulado Kimi");
    const t2 = await engine.retry();
    expect(t2.status).toBe("published");
    expect(t2.attempts).toHaveLength(4);
    expect(t2.attempts[3].model).toBe("fake-a");
    expect(t2.substitute).toBeUndefined();
    const log = await Git.log(engine.workspace, 1);
    expect(log[0].subject).toBe("Turno 1 · Participante A");
  });

  it("un fallo con el sustituto deja el turno fallido y el plan intacto", async () => {
    const { registry } = make({ "fake-a": { failTimes: 5 }, "fake-kimi": { failTimes: 5 } });
    const engine = await DebateEngine.create(opts(), registry);
    const t = await engine.next();
    expect(t.status).toBe("failed");
    expect(t.attempts).toHaveLength(3);
    expect(engine.state.nextAction).toMatch(/retry/);
    const plan = await fs.readFile(path.join(engine.workspace, "plan.md"), "utf8");
    expect(plan).toContain("## 1. Objetivo y resultado esperado\n\n## 2.");
    await engine.skip();
    expect(t.status).toBe("skipped");
    expect(engine.state.abbreviated).toBe(true);
    expect(engine.summary()).toMatch(/ABREVIADO/);
    const t2 = engine.currentTurn();
    expect(t2?.number).toBe(2);
  });

  it("orden de ciclos alternate: alterna quién abre cada ciclo", async () => {
    const { registry } = make();
    const engine = await DebateEngine.create(opts({ cycleOrder: "alternate" }), registry);
    await engine.run();
    await engine.say("Obs 1.");
    expect(engine.state.turns.slice(4).map((t) => t.participant)).toEqual(["B", "A"]);
    await engine.run();
    await engine.say("Obs 2.");
    expect(engine.state.turns.slice(6).map((t) => t.participant)).toEqual(["A", "B"]);
  });

  it("cancelar interrumpe el turno sin reintento ni sustituto", async () => {
    const { registry } = make({ "fake-a": { delayMs: 400 } });
    const engine = await DebateEngine.create(opts(), registry);
    const p = engine.next();
    await new Promise((r) => setTimeout(r, 50));
    expect(engine.busy).toMatch(/Turno 1/);
    engine.cancel();
    const t = await p;
    expect(t.status).toBe("failed");
    expect(t.attempts).toHaveLength(1);
    expect(t.error).toMatch(/cancelado/);
    expect(engine.state.nextAction).toMatch(/cancelado/i);
    expect(engine.busy).toBeNull();
    const t2 = await engine.retry();
    expect(t2.status).toBe("published");
  });

  it("pausar detiene run al terminar el turno en curso", async () => {
    const { registry } = make({ "fake-a": { delayMs: 100 }, "fake-b": { delayMs: 100 } });
    const engine = await DebateEngine.create(opts(), registry);
    const p = engine.run();
    await new Promise((r) => setTimeout(r, 30));
    engine.pause();
    await p;
    expect(engine.state.turns.filter((t) => t.status === "published")).toHaveLength(1);
    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");
  });

  it("un lock de otro proceso vivo impide ejecutar turnos", async () => {
    const { registry } = make();
    const engine = await DebateEngine.create(opts(), registry);
    await fs.writeFile(path.join(engine.workspace, ".debate", "lock"), JSON.stringify({ pid: process.ppid }));
    await expect(engine.next()).rejects.toThrow(/Otro proceso/);
    // Un lock huérfano (pid inexistente) se recupera solo.
    await fs.writeFile(path.join(engine.workspace, ".debate", "lock"), JSON.stringify({ pid: 999999 }));
    const t = await engine.next();
    expect(t.status).toBe("published");
    await expect(fs.access(path.join(engine.workspace, ".debate", "lock"))).rejects.toThrow();
    await expect(fs.access(path.join(engine.workspace, ".debate", "turns", "turn-1-1.prompt.md"))).resolves.toBeUndefined();
  });

  it("archivos fuera de alcance invalidan el intento y se restauran", async () => {
    const { registry } = make({ "fake-a": { extraFileOnTurn: 1 } });
    const engine = await DebateEngine.create(opts(), registry);
    const t = await engine.next();
    expect(t.attempts[0].error).toMatch(/fuera de alcance/);
    expect(t.attempts[1].error).toMatch(/fuera de alcance/);
    // El sustituto no escribe archivos extra y publica.
    expect(t.status).toBe("published");
    expect(t.substitute).toBeDefined();
    await expect(fs.access(path.join(engine.workspace, "fuera-de-alcance.md"))).rejects.toThrow();
  });

  it("identidad no confirmada no publica", async () => {
    const { registry } = make({ "fake-a": { wrongModel: true } });
    const engine = await DebateEngine.create(opts({ autoSubstitute: false }), registry);
    const t = await engine.next();
    expect(t.status).toBe("failed");
    expect(t.identity).toBe("mismatch");
    expect(t.error).toMatch(/identidad/);
  });

  it("pregunta bloqueante pausa el turno y la respuesta lo continúa sin consumir intervención", async () => {
    const { fake, registry } = make({ "fake-b": { blockingOnTurn: 2 } });
    const engine = await DebateEngine.create(opts(), registry);
    await engine.run();
    const t2 = engine.state.turns[1];
    expect(t2.status).toBe("paused_blocking");
    expect(engine.state.phase).toBe("initial");
    await expect(engine.next()).rejects.toThrow(/bloqueante/);
    const r = await engine.say("El presupuesto es de 500 USD.");
    expect(r.kind).toBe("answer");
    expect(t2.status).toBe("published");
    expect(t2.blockingAnswer).toBe("El presupuesto es de 500 USD.");
    expect(engine.state.clarifications).toEqual(["El presupuesto es de 500 USD."]);
    expect(engine.state.turns.filter((t) => t.status === "published")).toHaveLength(2);
    // La continuación reutilizó la sesión del participante.
    const calls = fake.calls.filter((c) => c.model === "fake-b");
    expect(calls).toHaveLength(2);
    expect(calls[1].resumed).toBe(true);
    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");
  });

  it("marca reescrituras grandes para revisión sin bloquearlas", async () => {
    const { registry } = make({ "fake-b": { rewriteOnTurn: 2 } });
    const engine = await DebateEngine.create(opts(), registry);
    await engine.next();
    const t2 = await engine.next();
    expect(t2.status).toBe("published");
    expect(t2.reviewFlag).toMatch(/cambió/);
  });

  it("una edición externa bloquea el siguiente turno", async () => {
    const { registry } = make();
    const engine = await DebateEngine.create(opts(), registry);
    await engine.next();
    await fs.appendFile(path.join(engine.workspace, "plan.md"), "\nedición manual\n");
    await expect(engine.next()).rejects.toThrow(/fuera de turno/);
  });

  it("reabrir el workspace conserva el estado y trata un turno interrumpido como fallido", async () => {
    const { registry } = make();
    const engine = await DebateEngine.create(opts(), registry);
    await engine.next();
    engine.state.turns[1].status = "running";
    await fs.writeFile(path.join(engine.workspace, "debate.json"), JSON.stringify(engine.state));
    const reopened = await DebateEngine.open(engine.workspace, registry);
    expect(reopened.state.opener).toBe("A");
    expect(reopened.state.turns[0].status).toBe("published");
    expect(reopened.state.turns[1].status).toBe("failed");
  });
});
