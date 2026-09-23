#!/usr/bin/env node
import { promises as fs } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { DebateEngine, EngineError } from "../core/engine.js";
import { createRegistry, DEFAULT_CONFIG, FAKE_MODELS, loadConfig } from "../core/config.js";
import { FakeAdapter } from "../core/adapters/fake.js";
import { renderActa } from "../core/schema.js";
import { STATE_FILE } from "../core/prompts.js";
import type { EngineEvent, TurnRecord } from "../core/types.js";
import { exists } from "../core/fsutil.js";

const program = new Command();
program
  .name("debate")
  .description("Motor del debate de planeación entre IAs (uso desde terminal)")
  .option("--config-dir <dir>", "directorio de configuración", DEFAULT_CONFIG.configDir)
  .option("-q, --quiet", "no mostrar el streaming de los modelos", false);

function attachLogger(engine: DebateEngine, quiet: boolean): void {
  let lineOpen = false;
  const endLine = () => {
    if (lineOpen) {
      process.stdout.write("\n");
      lineOpen = false;
    }
  };
  engine.on((e: EngineEvent) => {
    switch (e.type) {
      case "turn_start":
        endLine();
        console.log(`\n▶ Turno ${e.turn.number} · Participante ${e.turn.participant} · ${e.model} (intento ${e.attempt})`);
        console.log(`  Objetivo: ${e.turn.objective}`);
        break;
      case "adapter": {
        const ev = e.event;
        if (quiet) break;
        if (ev.type === "text" && ev.text) {
          process.stdout.write(ev.text);
          lineOpen = true;
        } else if (ev.type === "tool") {
          endLine();
          console.log(`  ⚙ ${ev.text}`);
        } else if (ev.type === "status") {
          endLine();
          console.log(`  · ${ev.text}`);
        } else if (ev.type === "model") {
          endLine();
          console.log(`  modelo reportado: ${ev.model}`);
        } else if (ev.type === "rate_limit") {
          const d = ev.data as any;
          if (d?.unifiedWindows) {
            endLine();
            const fh = d.unifiedWindows.five_hour?.utilization;
            const sd = d.unifiedWindows.seven_day?.utilization;
            console.log(`  cuota: 5h ${fh !== undefined ? Math.round(fh * 100) + "%" : "?"} · 7d ${sd !== undefined ? Math.round(sd * 100) + "%" : "?"}`);
          }
        } else if (ev.type === "stderr" && ev.text?.trim()) {
          endLine();
          process.stderr.write(`  [stderr] ${ev.text}`);
        }
        break;
      }
      case "turn_end":
        endLine();
        if (e.outcome === "published") {
          console.log(`✔ Turno ${e.turn.number} publicado (${e.turn.commit?.slice(0, 12)})${e.turn.substitute ? ` · sustituto ${e.turn.substitute}` : ""}${e.turn.reviewFlag ? `\n  ⚠ ${e.turn.reviewFlag}` : ""}`);
          if (e.turn.acta) console.log(indent(renderActa(e.turn.acta)));
        } else if (e.outcome === "paused") {
          console.log(`⏸ Turno ${e.turn.number} pausado por pregunta bloqueante.`);
        } else {
          console.log(`✖ Turno ${e.turn.number} falló: ${e.turn.error}`);
        }
        break;
      case "phase":
        endLine();
        console.log(`\n[fase ${e.phase}] ${e.nextAction}`);
        break;
      case "consolidation":
        endLine();
        console.log(`\n◆ Consolidación (${e.by.label}): ${e.status}${e.error ? ` — ${e.error}` : ""}`);
        break;
      case "log":
        endLine();
        console.log(`  ${e.level === "error" ? "✖" : e.level === "warn" ? "⚠" : "·"} ${e.message}`);
        break;
    }
  });
}

function indent(s: string): string {
  return s
    .split("\n")
    .map((l) => (l ? "    " + l : l))
    .join("\n");
}

async function resolveWorkspace(arg: string | undefined): Promise<string> {
  const ws = path.resolve(arg ?? process.cwd());
  if (!(await exists(path.join(ws, STATE_FILE)))) {
    throw new EngineError(`No encuentro ${STATE_FILE} en ${ws}. Indica el workspace del debate.`);
  }
  return ws;
}

async function openEngine(arg: string | undefined): Promise<DebateEngine> {
  const opts = program.opts();
  const cfg = await loadConfig(opts.configDir);
  const ws = await resolveWorkspace(arg);
  const engine = await DebateEngine.open(ws, createRegistry(cfg));
  attachLogger(engine, opts.quiet);
  return engine;
}

program
  .command("new")
  .description("Crea un debate nuevo")
  .argument("<title>", "título del proyecto")
  .option("--brief <text>", "petición del usuario")
  .option("--brief-file <file>", "archivo con la petición")
  .option("--rounds <n>", "intervenciones por participante en la fase inicial", "3")
  .option("--root <dir>", "carpeta donde crear el workspace")
  .option("--context <dir...>", "carpetas de contexto en solo lectura")
  .option("--no-web", "deshabilitar búsqueda web")
  .option("--start <A|B>", "quién abre (por defecto, sorteo)")
  .option("--decision <text...>", "decisiones o restricciones del usuario")
  .option("--fake", "usar participantes simulados (sin cuota)", false)
  .option("--no-substitute", "desactivar la sustitución automática por Kimi K3")
  .option("--cycle-order <global|alternate>", "orden de los ciclos de observación", "global")
  .option("--run", "ejecutar la fase inicial de inmediato", false)
  .action(async (title: string, o) => {
    const opts = program.opts();
    const cfg = await loadConfig(opts.configDir);
    let brief: string | undefined = o.brief;
    if (o.briefFile) brief = await fs.readFile(o.briefFile, "utf8");
    if (!brief?.trim()) throw new EngineError("Falta la petición: usa --brief o --brief-file.");
    const models = o.fake ? FAKE_MODELS : cfg.models;
    const registry = createRegistry(cfg, new FakeAdapter());
    const engine = await DebateEngine.create(
      {
        root: o.root ?? cfg.debatesRoot,
        title,
        brief,
        rounds: Number(o.rounds),
        allowWeb: o.web !== false,
        contextDirs: o.context ?? [],
        opener: o.start === "A" || o.start === "B" ? o.start : "random",
        participants: { A: models.A, B: models.B },
        substitute: models.substitute,
        consolidator: models.consolidator,
        consolidatorAlt: models.consolidatorAlt,
        autoSubstitute: o.substitute !== false && cfg.autoSubstitute,
        turnTimeoutMs: cfg.turnTimeoutMs,
        changeRatioThreshold: cfg.changeRatioThreshold,
        cycleOrder: o.cycleOrder === "alternate" ? "alternate" : "global",
        decisions: o.decision ?? [],
      },
      registry,
    );
    attachLogger(engine, opts.quiet);
    console.log(`Debate creado en ${engine.workspace}`);
    console.log(engine.summary());
    if (o.run) await engine.run();
  });

program
  .command("next")
  .description("Ejecuta el siguiente turno (con reintento y sustitución automática)")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.next();
  });

program
  .command("run")
  .description("Ejecuta turnos hasta que haga falta el usuario")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.run();
    console.log("\n" + engine.summary());
  });

program
  .command("say")
  .description("Observación del usuario (abre un ciclo) o respuesta a una pregunta bloqueante")
  .argument("<text>")
  .option("-w, --workspace <dir>")
  .option("--run", "ejecutar el ciclo de inmediato", false)
  .action(async (text: string, o) => {
    const engine = await openEngine(o.workspace);
    const r = await engine.say(text);
    if (r.kind === "cycle") console.log(`Ciclo abierto: turnos ${r.turns.map((t) => t.number).join(" y ")}. Empieza el Participante ${r.turns[0].participant}.`);
    if (o.run) await engine.run();
  });

program
  .command("decide")
  .description("Registra una decisión o restricción del usuario")
  .argument("<text>")
  .option("-w, --workspace <dir>")
  .action(async (text: string, o) => {
    const engine = await openEngine(o.workspace);
    await engine.decide(text);
    console.log("Decisión registrada.");
  });

program
  .command("status")
  .description("Muestra el estado del debate")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    console.log(engine.summary());
  });

program
  .command("retry")
  .description("Reintenta el turno fallido (modelo propio y luego sustituto)")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.retry();
  });

program
  .command("skip")
  .description("Salta el turno fallido")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.skip();
  });

program
  .command("finalize")
  .description("Congela el plan aprobado")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.finalize();
  });

program
  .command("consolidate")
  .description("Produce un candidato consolidado (plan.candidate.md) sin tocar el plan aprobado")
  .argument("[workspace]")
  .option("--alt", "usar el consolidador alternativo (Kimi K3)", false)
  .action(async (ws, o) => {
    const engine = await openEngine(ws);
    const info = await engine.consolidate(o.alt ? "alt" : "primary");
    if (info.status === "ready") {
      if (info.report) console.log(`\nInforme del consolidador:\n${indent(info.report)}`);
      console.log("\nDiff plan aprobado → candidato:\n");
      console.log(await engine.candidateDiff());
    }
  });

program
  .command("accept")
  .description("Acepta el candidato de consolidación y cierra el debate")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.acceptCandidate();
  });

program
  .command("discard")
  .description("Descarta el candidato de consolidación")
  .argument("[workspace]")
  .action(async (ws) => {
    const engine = await openEngine(ws);
    await engine.discardCandidate();
  });

program
  .command("acta")
  .description("Muestra el acta de un turno")
  .argument("<number>")
  .option("-w, --workspace <dir>")
  .action(async (n: string, o) => {
    const engine = await openEngine(o.workspace);
    const turn: TurnRecord | undefined = engine.state.turns.find((t) => t.number === Number(n));
    if (!turn?.acta) throw new EngineError(`El turno ${n} no tiene acta.`);
    console.log(renderActa(turn.acta));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`\nError: ${err?.message ?? err}`);
  process.exit(1);
});
