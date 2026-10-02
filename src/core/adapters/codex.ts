import { promises as fs } from "node:fs";
import path from "node:path";
import type { AdapterEvent } from "../types.js";
import { execCmd, extractJson, safeJsonParse } from "../fsutil.js";
import { envSecrets, rawLogger, tail, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface CodexAdapterOptions {
  binary?: string;
  secrets?: SecretResolver;
}

/**
 * Codex CLI en modo no interactivo (`codex exec`).
 * Verificado con Codex 0.156.1: `--json` emite JSONL; el id de hilo llega en
 * `thread.started`; `exec resume` no acepta `-C` ni `-s` (hereda el directorio
 * y el sandbox se fija con `-c sandbox_mode`); el acta se lee del archivo de `-o`.
 * Codex no reporta el modelo efectivo en los eventos: identidad "unreported".
 */
export class CodexAdapter implements Adapter {
  readonly id = "codex" as const;
  readonly editsFiles = true;
  readonly supportsResume = true;
  private binary: string;
  private secrets: SecretResolver;

  constructor(opts: CodexAdapterOptions = {}) {
    this.binary = opts.binary ?? "codex";
    this.secrets = opts.secrets ?? envSecrets;
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const lastFile = path.join(req.workspace, ".debate", `codex-last-${req.turnNumber}-${Date.now()}.json`);
    await fs.mkdir(path.dirname(lastFile), { recursive: true });
    const effort = req.spec.effort ?? "high";

    // `--search` es un flag global: va antes del subcomando (verificado en 0.156.1).
    const globalArgs = req.allowWeb ? ["--search"] : [];
    let args: string[];
    if (req.sessionId) {
      args = [
        ...globalArgs,
        "exec",
        "resume",
        req.sessionId,
        "--json",
        "-m",
        req.spec.model,
        "-c",
        `model_reasoning_effort="${effort}"`,
        "-c",
        'sandbox_mode="workspace-write"',
        "--output-schema",
        req.schemaFile,
        "-o",
        lastFile,
        "-",
      ];
    } else {
      args = [
        ...globalArgs,
        "exec",
        "--json",
        "-m",
        req.spec.model,
        "-c",
        `model_reasoning_effort="${effort}"`,
        "-s",
        "workspace-write",
        "-C",
        req.workspace,
        "--output-schema",
        req.schemaFile,
        "-o",
        lastFile,
      ];
      for (const d of req.contextDirs) args.push("--add-dir", d);
      args.push("-");
    }

    // Modo clave: CODEX_API_KEY vale solo para `codex exec` y no toca el login guardado.
    const env = { ...process.env };
    if (req.spec.access === "cli-key") {
      const key = this.secrets("OPENAI_API_KEY");
      if (!key) return { ok: false, error: "falta la clave de la API de OpenAI (OPENAI_API_KEY) para Codex", modelsReported: [], text: "" };
      env.CODEX_API_KEY = key;
    } else {
      delete env.CODEX_API_KEY;
    }

    let sessionId = req.sessionId;
    let lastMessage = "";
    let usage: unknown;
    let errorMsg: string | undefined;

    onEvent({ type: "status", text: `codex ${req.sessionId ? "resume" : "nueva sesión"}` });
    const r = await execCmd(this.binary, args, {
      cwd: req.workspace,
      env,
      input: req.prompt,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onStderr: (c) => {
        if (!/Reading additional input from stdin/i.test(c)) onEvent({ type: "stderr", text: c });
      },
      onStdoutLine: (line) => {
        log(line);
        const d = safeJsonParse<Record<string, any>>(line);
        if (!d) return;
        const item = d.item ?? {};
        switch (d.type) {
          case "thread.started":
            sessionId = d.thread_id ?? sessionId;
            break;
          case "turn.started":
            onEvent({ type: "status", text: "turno iniciado" });
            break;
          case "item.started":
            if (item.type === "command_execution") onEvent({ type: "tool", text: `shell ${item.command ?? ""}` });
            if (item.type === "file_change") {
              const paths = (item.changes ?? []).map((c: any) => path.basename(c.path ?? "")).join(", ");
              onEvent({ type: "tool", text: `edit ${paths}` });
            }
            break;
          case "item.completed":
            if (item.type === "agent_message" && typeof item.text === "string") {
              lastMessage = item.text;
              onEvent({ type: "text", text: item.text });
            }
            if (item.type === "reasoning" && typeof item.text === "string") {
              onEvent({ type: "status", text: `razonamiento: ${item.text.slice(0, 120)}` });
            }
            break;
          case "turn.completed":
            usage = d.usage;
            if (usage) onEvent({ type: "usage", data: usage });
            break;
          case "turn.failed":
          case "error":
            errorMsg = d.error?.message ?? d.message ?? JSON.stringify(d);
            break;
          default:
            onEvent({ type: "raw", data: d });
        }
      },
    });

    if (r.timedOut) {
      return { ok: false, error: `codex: timeout tras ${req.timeoutMs} ms`, modelsReported: [], text: lastMessage, sessionId };
    }
    if (errorMsg) {
      return { ok: false, error: `codex: ${errorMsg}`, modelsReported: [], text: lastMessage, sessionId };
    }
    if (r.code !== 0) {
      return { ok: false, error: `codex salió con código ${r.code}. stderr: ${tail(r.stderr)}`, modelsReported: [], text: lastMessage, sessionId };
    }

    let acta: unknown;
    try {
      const raw = await fs.readFile(lastFile, "utf8");
      acta = extractJson(raw);
    } catch {
      acta = undefined;
    }
    if (acta === undefined) acta = extractJson(lastMessage);

    return { ok: true, sessionId, modelsReported: [], text: lastMessage, acta, usage };
  }
}
