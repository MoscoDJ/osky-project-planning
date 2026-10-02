import { promises as fs } from "node:fs";
import path from "node:path";
import crossSpawn from "cross-spawn";
import { randomUUID } from "node:crypto";

export async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, file);
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string> {
  return fs.readFile(p, "utf8");
}

export async function appendText(p: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.appendFile(p, content, "utf8");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "debate";
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Texto a enviar por stdin. Si es undefined, stdin se cierra de inmediato. */
  input?: string;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Ejecuta un comando, entrega stdout línea a línea y devuelve el resultado completo. */
export function execCmd(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let buf = "";
    let timedOut = false;
    // cross-spawn: en Windows ejecuta los shims .cmd de npm con el entrecomillado correcto;
    // en Linux y macOS equivale a child_process.spawn.
    const child = crossSpawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }) as import("node:child_process").ChildProcessWithoutNullStreams;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (opts.onStdoutLine) {
        buf += chunk;
        let idx: number;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.trim()) opts.onStdoutLine(line);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      opts.onStderr?.(chunk);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      if (buf.trim() && opts.onStdoutLine) opts.onStdoutLine(buf);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

export function safeJsonParse<T = unknown>(s: string): T | undefined {
  try {
    return JSON.parse(s) as T;
  } catch {
    return undefined;
  }
}

/** Extrae el primer objeto JSON de un texto que puede traer ruido alrededor. */
export function extractJson<T = unknown>(text: string): T | undefined {
  const direct = safeJsonParse<T>(text.trim());
  if (direct !== undefined) return direct;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    const parsed = safeJsonParse<T>(fence[1].trim());
    if (parsed !== undefined) return parsed;
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return safeJsonParse<T>(text.slice(start, end + 1));
  }
  return undefined;
}
