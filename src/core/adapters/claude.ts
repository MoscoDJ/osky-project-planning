import { randomUUID } from "node:crypto";
import type { AdapterEvent } from "../types.js";
import { execCmd, extractJson, safeJsonParse } from "../fsutil.js";
import { envSecrets, rawLogger, tail, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface ClaudeAdapterOptions {
  binary?: string;
  secrets?: SecretResolver;
}

interface ClaudeResult {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: unknown;
  modelUsage?: Record<string, unknown>;
}

/**
 * Claude Code en modo headless (`claude -p`).
 * Verificado con Claude Code 2.1.280: el prompt va por stdin porque los flags
 * variádicos se tragan el argumento posicional; se limpian las variables de
 * entorno de sesión anidada; las reglas se leen de CLAUDE.md en el workspace.
 */
export class ClaudeAdapter implements Adapter {
  readonly id = "claude" as const;
  readonly editsFiles = true;
  readonly supportsResume = true;
  private binary: string;
  private secrets: SecretResolver;

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.binary = opts.binary ?? "claude";
    this.secrets = opts.secrets ?? envSecrets;
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const sessionId = req.sessionId ?? randomUUID();
    const tools = ["Read", "Glob", "Grep", "Edit", "Write"];
    if (req.allowWeb) tools.push("WebSearch", "WebFetch");

    const args = [
      "-p",
      "--model",
      req.spec.model,
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
    ];
    if (req.spec.effort) args.push("--effort", req.spec.effort);
    args.push(req.sessionId ? "--resume" : "--session-id", sessionId);
    for (const d of req.contextDirs) args.push("--add-dir", d);
    args.push("--json-schema", JSON.stringify(req.schema));
    args.push("--allowedTools", tools.join(","));
    args.push("--disallowedTools", "Bash,NotebookEdit,Agent,Task");

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    if (req.spec.access === "cli-key") {
      // Modo clave: --bare usa solo ANTHROPIC_API_KEY (nunca el login) y no lee CLAUDE.md,
      // así que las reglas del debate van en el system prompt.
      const key = this.secrets("ANTHROPIC_API_KEY");
      if (!key) return { ok: false, error: "falta la clave de la API de Anthropic (ANTHROPIC_API_KEY) para Claude Code", modelsReported: [], text: "" };
      env.ANTHROPIC_API_KEY = key;
      delete env.ANTHROPIC_AUTH_TOKEN;
      args.unshift("--bare");
      args.push("--append-system-prompt", req.systemPrompt);
    } else {
      // Modo login: se quitan las claves del entorno para que use la suscripción.
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }

    const models = new Set<string>();
    let result: ClaudeResult | undefined;
    let partialText = "";

    onEvent({ type: "status", text: `claude ${req.sessionId ? "resume" : "nueva sesión"} ${sessionId}` });
    const r = await execCmd(this.binary, args, {
      cwd: req.workspace,
      env,
      input: req.prompt,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onStderr: (c) => onEvent({ type: "stderr", text: c }),
      onStdoutLine: (line) => {
        log(line);
        const d = safeJsonParse<Record<string, any>>(line);
        if (!d) return;
        switch (d.type) {
          case "system":
            onEvent({ type: "status", text: `init (${d.subtype ?? ""})` });
            break;
          case "assistant": {
            const m = d.message ?? {};
            if (typeof m.model === "string") models.add(m.model);
            for (const block of m.content ?? []) {
              if (block.type === "tool_use") {
                const input = block.input ?? {};
                const target = input.file_path ?? input.pattern ?? input.query ?? input.url ?? "";
                onEvent({ type: "tool", text: `${block.name} ${target}`.trim(), data: { name: block.name, input } });
              }
            }
            break;
          }
          case "stream_event": {
            const ev = d.event ?? {};
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && typeof ev.delta.text === "string") {
              partialText += ev.delta.text;
              onEvent({ type: "text", text: ev.delta.text });
            }
            break;
          }
          case "rate_limit_event":
            onEvent({ type: "rate_limit", data: d.rate_limit_info });
            break;
          case "result":
            result = d as ClaudeResult;
            break;
          default:
            onEvent({ type: "raw", data: d });
        }
      },
    });

    const modelsReported = [...models];
    for (const m of modelsReported) onEvent({ type: "model", model: m });

    if (r.timedOut) {
      return { ok: false, error: `claude: timeout tras ${req.timeoutMs} ms`, modelsReported, text: partialText, sessionId };
    }
    if (!result) {
      return {
        ok: false,
        error: `claude: sin evento result (código ${r.code}). stderr: ${tail(r.stderr)}`,
        modelsReported,
        text: partialText,
        sessionId,
      };
    }
    if (result.is_error || (result.subtype && result.subtype !== "success")) {
      return {
        ok: false,
        error: `claude: ${result.subtype ?? "error"}: ${tail(String(result.result ?? r.stderr))}`,
        modelsReported,
        text: partialText,
        sessionId: result.session_id ?? sessionId,
      };
    }
    const text = typeof result.result === "string" ? result.result : partialText;
    const acta = result.structured_output ?? extractJson(text);
    if (result.usage) onEvent({ type: "usage", data: result.usage });
    return {
      ok: true,
      sessionId: result.session_id ?? sessionId,
      modelsReported,
      text,
      acta,
      usage: { usage: result.usage, modelUsage: result.modelUsage },
      costEstimateUsd: result.total_cost_usd,
    };
  }
}
