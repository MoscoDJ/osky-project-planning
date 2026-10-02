import type { AdapterEvent } from "../types.js";
import { execCmd, extractJson, safeJsonParse } from "../fsutil.js";
import { envSecrets, rawLogger, tail, type Adapter, type SecretResolver, type TurnRequest, type TurnResult } from "./types.js";

export interface GeminiAdapterOptions {
  binary?: string;
  secrets?: SecretResolver;
}

/**
 * Gemini CLI en modo headless (`gemini -p`).
 * Verificado con Gemini CLI 0.60.0: `-o stream-json` emite init/message/result;
 * `--skip-trust` es obligatorio para que cargue ~/.gemini/.env en carpetas no
 * confiables; `--approval-mode auto_edit` permite editar archivos sin shell.
 * El modelo efectivo se lee de `result.stats.models`.
 */
export class GeminiAdapter implements Adapter {
  readonly id = "gemini" as const;
  readonly editsFiles = true;
  readonly supportsResume = true;
  private binary: string;
  private secrets: SecretResolver;

  constructor(opts: GeminiAdapterOptions = {}) {
    this.binary = opts.binary ?? "gemini";
    this.secrets = opts.secrets ?? envSecrets;
  }

  async runTurn(req: TurnRequest, onEvent: (e: AdapterEvent) => void): Promise<TurnResult> {
    const log = rawLogger(req.logFile);
    const args = [
      "-m",
      req.spec.model,
      "-p",
      "Sigue las instrucciones del encargo que recibes por la entrada estándar.",
      "--approval-mode",
      "auto_edit",
      "--skip-trust",
      "-o",
      "stream-json",
    ];
    if (req.sessionId) args.push("-r", req.sessionId);
    for (const d of req.contextDirs) args.push("--include-directories", d);

    // Gemini CLI dejó de aceptar login con cuenta de Google para cuentas individuales
    // (18-jun-2026): se usa con GEMINI_API_KEY. Si la app tiene la clave, se inyecta;
    // si no, el CLI usa la de ~/.gemini/.env.
    const env = { ...process.env };
    const key = this.secrets("GEMINI_API_KEY");
    if (key) env.GEMINI_API_KEY = key;

    let sessionId = req.sessionId;
    let text = "";
    let status: string | undefined;
    let stats: any;
    let errorMsg: string | undefined;

    onEvent({ type: "status", text: `gemini ${req.sessionId ? "resume" : "nueva sesión"}` });
    const r = await execCmd(this.binary, args, {
      cwd: req.workspace,
      env,
      input: req.prompt,
      timeoutMs: req.timeoutMs,
      signal: req.signal,
      onStderr: (c) => {
        if (!/\[STARTUP\]|deprecat/i.test(c)) onEvent({ type: "stderr", text: c });
      },
      onStdoutLine: (line) => {
        log(line);
        const d = safeJsonParse<Record<string, any>>(line);
        if (!d) return;
        switch (d.type) {
          case "init":
            sessionId = d.session_id ?? sessionId;
            break;
          case "message":
            if (d.role === "assistant" && typeof d.content === "string") {
              text += d.content;
              onEvent({ type: "text", text: d.content });
            }
            break;
          case "tool_use":
          case "tool_call":
            onEvent({ type: "tool", text: `${d.name ?? d.tool_name ?? "tool"} ${JSON.stringify(d.args ?? d.parameters ?? {}).slice(0, 120)}` });
            break;
          case "result":
            status = d.status;
            stats = d.stats;
            if (d.error) errorMsg = d.error.message ?? JSON.stringify(d.error);
            break;
          case "error":
            errorMsg = d.message ?? d.error?.message ?? JSON.stringify(d);
            break;
          default:
            onEvent({ type: "raw", data: d });
        }
      },
    });

    const modelsReported = Object.keys(stats?.models ?? {}).map((m) => m.replace(/-customtools$/, ""));
    for (const m of modelsReported) onEvent({ type: "model", model: m });
    if (stats) onEvent({ type: "usage", data: stats });

    if (r.timedOut) {
      return { ok: false, error: `gemini: timeout tras ${req.timeoutMs} ms`, modelsReported, text, sessionId };
    }
    if (errorMsg || (status && status !== "success") || r.code !== 0) {
      return {
        ok: false,
        error: `gemini: ${errorMsg ?? status ?? `código ${r.code}`}. stderr: ${tail(r.stderr)}`,
        modelsReported,
        text,
        sessionId,
      };
    }
    const acta = req.role === "participant" ? extractJson(text) : undefined;
    return { ok: true, sessionId, modelsReported, text, acta, usage: stats };
  }
}
