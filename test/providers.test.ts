import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { DebateEngine } from "../src/core/engine.js";
import { FakeAdapter } from "../src/core/adapters/fake.js";
import { Registry } from "../src/core/adapters/registry.js";
import { OpenAICompatAdapter } from "../src/core/adapters/openai-compat.js";
import { AnthropicAdapter } from "../src/core/adapters/anthropic.js";
import { ReplicateAdapter } from "../src/core/adapters/replicate.js";
import type { TurnRequest } from "../src/core/adapters/types.js";
import { FAKE_MODELS, fakeParticipants } from "../src/core/config.js";
import { CATALOG, resolveSpecRef } from "../src/core/catalog.js";
import { PROVIDERS, getProvider } from "../src/core/providers.js";
import { readSecretsSync, secretStatus, setSecret } from "../src/core/secrets.js";
import { ACTA_SCHEMA } from "../src/core/schema.js";
import type { ModelSpec, NewDebateOptions } from "../src/core/types.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "osky-pp-"));
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
    opener: "fixed",
    participants: fakeParticipants(3),
    substitute: FAKE_MODELS.substitute,
    consolidator: FAKE_MODELS.consolidator,
    consolidatorAlt: FAKE_MODELS.consolidatorAlt,
    dirName: "debate",
    ...over,
  };
}

const ACTA = {
  resumen: "ok",
  evaluacion: "bien",
  cambios: [],
  acuerdos: [],
  rechazos: [],
  desacuerdos: [],
  riesgos: [],
  preguntas_usuario: [],
  fuentes: [],
  sin_cambios: false,
};
const PLAN = "# P\n\n## 1. Objetivo\n\nx\n\n## 3. Alcance\n\n## 7. Etapas\n\n## 9. Riesgos\n";
const INLINE_OUT = `===PLAN===\n${PLAN}===ACTA===\n${JSON.stringify(ACTA)}\n===FIN===`;

function req(spec: ModelSpec, over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    workspace: root,
    prompt: "paquete",
    systemPrompt: "reglas",
    schemaFile: path.join(root, "schema.json"),
    schema: ACTA_SCHEMA,
    spec,
    role: "participant",
    allowWeb: false,
    contextDirs: [],
    targetFile: "plan.md",
    planContent: PLAN,
    logFile: path.join(root, "log.jsonl"),
    timeoutMs: 10000,
    turnNumber: 2,
    ...over,
  };
}

function sse(lines: string[], headers: Record<string, string> = {}): Response {
  return new Response(lines.join("\n") + "\n", { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
}

describe("debate con tres participantes", () => {
  it("rota A→B→C, los ciclos dan una respuesta a cada uno y el paquete trae las actas desde el último turno", async () => {
    const fake = new FakeAdapter();
    const engine = await DebateEngine.create(opts(), new Registry([fake]));
    expect(engine.state.order).toEqual(["A", "B", "C"]);
    expect(engine.state.turns.map((t) => t.participant)).toEqual(["A", "B", "C", "A", "B", "C"]);
    expect(engine.state.turns.map((t) => t.position)).toEqual([1, 1, 1, 2, 2, 2]);
    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");

    // El turno 4 (A) recibió las actas de B (2) y C (3).
    const prompt4 = await fs.readFile(path.join(engine.workspace, ".debate", "turns", "turn-4-1.prompt.md"), "utf8");
    expect(prompt4).toContain("### Participante B (turno 2)");
    expect(prompt4).toContain("### Participante C (turno 3)");
    expect(prompt4).toContain("en orden de palabra: A, B, C");

    // Ciclo global: C habló último, abre A y responden los tres.
    await engine.say("Agrega soporte RAW.");
    expect(engine.state.turns.slice(6).map((t) => t.participant)).toEqual(["A", "B", "C"]);
    expect(engine.state.turns.slice(6).map((t) => t.positionTotal)).toEqual([3, 3, 3]);
    await engine.run();
    expect(engine.state.phase).toBe("awaiting_user");
    const debateMd = await fs.readFile(path.join(engine.workspace, "debate.md"), "utf8");
    expect(debateMd).toContain("ciclo 1, respuesta 3/3");
    // La transcripción no revela qué modelo es cada participante.
    expect(debateMd).not.toContain("Simulado");
  });

  it("orden de ciclos alternate con tres participantes", async () => {
    const engine = await DebateEngine.create(opts({ cycleOrder: "alternate", rounds: 1 }), new Registry([new FakeAdapter()]));
    await engine.run();
    await engine.say("Obs 1.");
    expect(engine.state.turns.slice(3).map((t) => t.participant)).toEqual(["B", "C", "A"]);
    await engine.run();
    await engine.say("Obs 2.");
    expect(engine.state.turns.slice(6).map((t) => t.participant)).toEqual(["C", "A", "B"]);
  });

  it("sorteo: el orden es una permutación de los participantes", async () => {
    const engine = await DebateEngine.create(opts({ opener: "random" }), new Registry([new FakeAdapter()]));
    expect([...engine.state.order].sort()).toEqual(["A", "B", "C"]);
    expect(engine.state.opener).toBe(engine.state.order[0]);
  });

  it("una letra fija quién abre y el resto sigue en orden", async () => {
    const engine = await DebateEngine.create(opts({ opener: "B" }), new Registry([new FakeAdapter()]));
    expect(engine.state.order).toEqual(["B", "C", "A"]);
  });

  it("dos participantes en el mismo CLI comparten un archivo de reglas genérico", async () => {
    const claude = (model: string): ModelSpec => ({ adapter: "claude", model, label: model, provider: "claude-code", access: "cli-login" });
    const engine = await DebateEngine.create(
      opts({ participants: [claude("claude-fable-5-1"), claude("claude-opus-5-5"), FAKE_MODELS.A] }),
      new Registry([new FakeAdapter()]),
    );
    const rules = await fs.readFile(path.join(engine.workspace, "CLAUDE.md"), "utf8");
    expect(rules).toContain("entre 3 modelos frontera");
    expect(rules).not.toMatch(/Participas como Participante [A-Z]/);
    await expect(fs.access(path.join(engine.workspace, "AGENTS.md"))).rejects.toThrow();
  });

  it("rechaza un debate de un solo participante", async () => {
    await expect(DebateEngine.create(opts({ participants: fakeParticipants(1) }), new Registry([new FakeAdapter()]))).rejects.toThrow(/al menos dos/);
  });

  it("migra un debate antiguo: sin orden y con el adaptador heredado de Kimi", async () => {
    const engine = await DebateEngine.create(opts({ participants: { A: FAKE_MODELS.A, B: FAKE_MODELS.B }, opener: "B" }), new Registry([new FakeAdapter()]));
    const file = path.join(engine.workspace, "debate.json");
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    delete raw.order;
    raw.config.substitute = { adapter: "kimi", model: "kimi-k3", label: "Kimi K3" };
    await fs.writeFile(file, JSON.stringify(raw));
    const reopened = await DebateEngine.open(engine.workspace, new Registry([new FakeAdapter()]));
    expect(reopened.state.order).toEqual(["B", "A"]);
    expect(reopened.state.config.substitute.adapter).toBe("openai-compat");
    expect(reopened.state.config.substitute.provider).toBe("digitalocean");
  });
});

describe("adaptador compatible con OpenAI", () => {
  it("transmite por SSE, extrae documento y acta, y usa la URL y la clave del proveedor", async () => {
    let called: { url: string; body: any; auth: string } | undefined;
    const fetchImpl = (async (url: string, init: any) => {
      called = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
      const chunks = [INLINE_OUT.slice(0, 40), INLINE_OUT.slice(40)];
      return sse([
        ...chunks.map((c) => `data: ${JSON.stringify({ model: "x-ai/grok-4.7", choices: [{ delta: { content: c } }] })}`),
        `data: ${JSON.stringify({ usage: { prompt_tokens: 10 } })}`,
        "data: [DONE]",
      ]);
    }) as unknown as typeof fetch;
    const a = new OpenAICompatAdapter({ secrets: (n) => (n === "OPENROUTER_API_KEY" ? "sk-or" : undefined), fetchImpl });
    const spec = resolveSpecRef("grok-4.7@openrouter:api");
    const r = await a.runTurn(req(spec, { allowWeb: true }), () => undefined);
    expect(r.ok).toBe(true);
    expect(r.fullDocument).toBe(PLAN);
    expect((r.acta as any).resumen).toBe("ok");
    expect(r.modelsReported).toEqual(["x-ai/grok-4.7"]);
    expect(called!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(called!.auth).toBe("Bearer sk-or");
    expect(called!.body.plugins).toEqual([{ id: "web" }]);
    expect(called!.body.reasoning).toEqual({ effort: "high" });
  });

  it("falla con un mensaje claro si falta la clave o el proveedor responde error", async () => {
    const a = new OpenAICompatAdapter({ secrets: () => undefined });
    const r = await a.runTurn(req(resolveSpecRef("kimi-k3@moonshot:api")), () => undefined);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/MOONSHOT_API_KEY/);
    const b = new OpenAICompatAdapter({
      secrets: () => "k",
      fetchImpl: (async () => new Response('{"error":"no"}', { status: 402 })) as unknown as typeof fetch,
    });
    const r2 = await b.runTurn(req(resolveSpecRef("kimi-k3@digitalocean:api")), () => undefined);
    expect(r2.error).toMatch(/HTTP 402 \(cuenta sin saldo/);
  });
});

describe("adaptador de la API de Anthropic (SDK)", () => {
  it("usa el SDK oficial con streaming, esfuerzo y búsqueda web, y reporta el modelo", async () => {
    let body: any;
    const fetchImpl = (async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      const ev = (type: string, data: object) => [`event: ${type}`, `data: ${JSON.stringify({ type, ...data })}`, ""];
      return sse([
        ...ev("message_start", {
          message: { id: "msg_1", type: "message", role: "assistant", model: "claude-fable-5-1", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } },
        }),
        ...ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
        ...ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: INLINE_OUT } }),
        ...ev("content_block_stop", { index: 0 }),
        ...ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 50 } }),
        ...ev("message_stop", {}),
      ]);
    }) as unknown as typeof fetch;
    const a = new AnthropicAdapter({
      secrets: () => "sk-ant",
      clientFactory: (apiKey) => new Anthropic({ apiKey, fetch: fetchImpl, maxRetries: 0 }),
    });
    const r = await a.runTurn(req(resolveSpecRef("claude-fable-5.1@anthropic:api"), { allowWeb: true }), () => undefined);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.modelsReported).toEqual(["claude-fable-5-1"]);
    expect(r.fullDocument).toBe(PLAN);
    expect(body.model).toBe("claude-fable-5-1");
    expect(body.output_config).toEqual({ effort: "high" });
    expect(body.tools[0].name).toBe("web_search");
    expect(body.stream).toBe(true);
    expect(body.thinking).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
  });
});

describe("adaptador de Replicate", () => {
  it("crea la predicción y lee la salida del stream", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.endsWith("/predictions")) {
        return new Response(JSON.stringify({ id: "p1", urls: { stream: "https://stream.replicate.test/p1" } }), { status: 201 });
      }
      return sse(["event: output", `data: ${INLINE_OUT.split("\n").join("\ndata: ")}`, "", "event: done", "data: {}", ""]);
    }) as unknown as typeof fetch;
    const a = new ReplicateAdapter({ secrets: () => "r8", fetchImpl });
    const r = await a.runTurn(req(resolveSpecRef("gemini-3.1-pro@replicate:api")), () => undefined);
    expect(calls[0]).toBe("https://api.replicate.com/v1/models/google/gemini-3.1-pro/predictions");
    expect(r.ok).toBe(true);
    expect(r.modelsReported).toEqual(["google/gemini-3.1-pro"]);
  });
});

describe("claves y catálogo", () => {
  it("guarda claves con permisos 600 y no las revela en el estado", async () => {
    await setSecret(root, "OPENROUTER_API_KEY", "sk-or-1234567890");
    const st = await fs.stat(path.join(root, "secrets.env"));
    // Windows no tiene permisos POSIX: allí la protección es la carpeta del perfil del usuario.
    if (process.platform !== "win32") expect(st.mode & 0o777).toBe(0o600);
    expect(secretStatus(root, "OPENROUTER_API_KEY")).toEqual({ set: true, hint: "7890", source: "secrets" });
    await setSecret(root, "OPENROUTER_API_KEY", "");
    expect(readSecretsSync(root).OPENROUTER_API_KEY).toBeUndefined();
    await expect(setSecret(root, "mal nombre", "x")).rejects.toThrow();
  });

  it("todas las vías del catálogo apuntan a proveedores existentes con su modo de acceso", () => {
    for (const m of CATALOG) {
      expect(m.offerings.length).toBeGreaterThan(0);
      for (const o of m.offerings) {
        const p = getProvider(o.provider);
        expect(p, `${m.id} → ${o.provider}`).toBeDefined();
        expect(p!.access).toContain(o.access);
      }
    }
    expect(PROVIDERS.find((p) => p.id === "gemini-cli")!.access).toEqual(["cli-key"]);
    expect(() => resolveSpecRef("modelo-mediano")).toThrow(/catálogo/);
    expect(resolveSpecRef("gpt-6-astra@codex:cli-login")).toMatchObject({ adapter: "codex", model: "gpt-6-astra", access: "cli-login" });
  });
});
