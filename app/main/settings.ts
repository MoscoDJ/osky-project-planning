import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { execCmd } from "../../src/core/fsutil.js";
import { PROVIDERS, getProvider, type CliBinary } from "../../src/core/providers.js";
import { getSecret, secretStatus } from "../../src/core/secrets.js";
import type { AppConfig } from "../../src/core/config.js";
import { findExecutable } from "./paths.js";

export interface CliStatus {
  binary: CliBinary;
  installed: boolean;
  path?: string;
  version?: string;
  login: "logged-in" | "logged-out" | "unknown" | "not-supported";
  loginDetail?: string;
}

export interface ProviderStatus {
  id: string;
  keyEnv?: string;
  keySet: boolean;
  keyHint?: string;
  keySource?: "secrets" | "env" | "cli";
  cli?: CliStatus;
}

async function run(cmd: string, args: string[], timeoutMs = 8000): Promise<{ code: number | null; out: string }> {
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.ELECTRON_RUN_AS_NODE;
    const r = await execCmd(cmd, args, { timeoutMs, env });
    return { code: r.code, out: (r.stdout + "\n" + r.stderr).trim() };
  } catch (err: any) {
    return { code: -1, out: String(err?.message ?? err) };
  }
}

export async function cliStatus(binary: CliBinary, configured: string): Promise<CliStatus> {
  const exe = findExecutable(configured) ?? (configured !== binary ? undefined : findExecutable(binary));
  if (!exe) return { binary, installed: false, login: "unknown" };
  const v = await run(exe, ["--version"]);
  const st: CliStatus = { binary, installed: v.code === 0, path: exe, version: v.out.split("\n")[0]?.slice(0, 80), login: "unknown" };
  if (binary === "claude") {
    const a = await run(exe, ["auth", "status"]);
    try {
      const j = JSON.parse(a.out.slice(a.out.indexOf("{")));
      st.login = j.loggedIn ? "logged-in" : "logged-out";
      st.loginDetail = j.loggedIn ? `${j.authMethod ?? ""}${j.subscriptionType ? ` · ${j.subscriptionType}` : ""}` : undefined;
    } catch {
      st.login = /logged in/i.test(a.out) ? "logged-in" : "unknown";
    }
  } else if (binary === "codex") {
    const a = await run(exe, ["login", "status"]);
    if (/logged in/i.test(a.out)) {
      st.login = "logged-in";
      st.loginDetail = a.out.split("\n").find((l) => /logged in/i.test(l))?.trim();
    } else if (/not logged in/i.test(a.out) || a.code !== 0) st.login = "logged-out";
  } else {
    st.login = "not-supported";
    st.loginDetail = "Gemini CLI ya no acepta login de cuentas personales; usa GEMINI_API_KEY.";
  }
  return st;
}

export async function providerStatuses(cfg: AppConfig): Promise<ProviderStatus[]> {
  const out: ProviderStatus[] = [];
  const cliCache = new Map<CliBinary, Promise<CliStatus>>();
  for (const p of PROVIDERS) {
    const ks = p.keyEnv ? secretStatus(cfg.configDir, p.keyEnv) : { set: false };
    let cli: CliStatus | undefined;
    if (p.binary) {
      if (!cliCache.has(p.binary)) cliCache.set(p.binary, cliStatus(p.binary, cfg.paths[p.binary]));
      cli = await cliCache.get(p.binary);
    }
    out.push({ id: p.id, keyEnv: p.keyEnv, keySet: ks.set, keyHint: ks.hint, keySource: (ks as any).source, cli });
  }
  return out;
}

/** Abre una terminal del sistema con el comando de login del CLI. */
export async function openLoginTerminal(providerId: string, cfg: AppConfig): Promise<string> {
  const p = getProvider(providerId);
  if (!p?.loginCommand || !p.binary) throw new Error("Este proveedor no tiene login interactivo.");
  const exe = findExecutable(cfg.paths[p.binary]) ?? p.binary;
  const cmd = [exe, ...p.loginCommand.slice(1)];
  const quoted = cmd.map((c) => (/[\s"']/.test(c) ? `"${c.replace(/"/g, '\\"')}"` : c)).join(" ");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  const detach = (bin: string, args: string[]) => {
    const child = spawn(bin, args, { detached: true, stdio: "ignore", env });
    child.unref();
  };
  if (process.platform === "darwin") {
    detach("osascript", ["-e", `tell application "Terminal" to do script "${quoted.replace(/"/g, '\\"')}"`, "-e", 'tell application "Terminal" to activate']);
    return "Terminal";
  }
  if (process.platform === "win32") {
    detach("cmd.exe", ["/c", "start", "cmd.exe", "/k", quoted]);
    return "cmd";
  }
  const hold = `${quoted}; echo; echo "Puedes cerrar esta ventana."; read -r _`;
  const terminals: Array<[string, string[]]> = [
    ["konsole", ["--noclose", "-e", "bash", "-lc", hold]],
    ["gnome-terminal", ["--", "bash", "-lc", hold]],
    ["xfce4-terminal", ["-x", "bash", "-lc", hold]],
    ["x-terminal-emulator", ["-e", "bash", "-lc", hold]],
    ["xterm", ["-e", "bash", "-lc", hold]],
  ];
  for (const [bin, args] of terminals) {
    if (findExecutable(bin)) {
      detach(bin, args);
      return bin;
    }
  }
  throw new Error(`No encontré una terminal. Ejecuta a mano: ${quoted}`);
}

/** Comprueba que la clave de un proveedor de API funciona, sin consumir inferencia. */
export async function testProvider(providerId: string, cfg: AppConfig): Promise<{ ok: boolean; detail: string }> {
  const p = getProvider(providerId);
  if (!p) return { ok: false, detail: "proveedor desconocido" };
  if (p.kind === "cli") {
    const st = await cliStatus(p.binary!, cfg.paths[p.binary!]);
    if (!st.installed) return { ok: false, detail: `${p.binary} no está instalado o no está en el PATH` };
    const key = p.keyEnv ? getSecret(cfg.configDir, p.keyEnv) : undefined;
    return { ok: true, detail: `${st.version ?? p.binary} · login: ${st.login}${st.loginDetail ? ` (${st.loginDetail})` : ""} · clave: ${key ? "configurada" : "no"}` };
  }
  const key = p.keyEnv ? getSecret(cfg.configDir, p.keyEnv) : undefined;
  if (!key) return { ok: false, detail: `falta ${p.keyEnv}` };
  try {
    if (p.adapter === "anthropic") {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 15000 });
      const page = await client.models.list({ limit: 20 });
      const ids = page.data.map((m) => m.id);
      return { ok: true, detail: `clave válida · ${ids.filter((i) => /fable|opus/.test(i)).slice(0, 4).join(", ") || ids.slice(0, 3).join(", ")}` };
    }
    if (p.adapter === "replicate") {
      const r = await fetch(`${p.baseUrl}/account`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      const j: any = await r.json().catch(() => ({}));
      return r.ok ? { ok: true, detail: `cuenta ${j.username ?? "válida"}` } : { ok: false, detail: `HTTP ${r.status}` };
    }
    const r = await fetch(`${p.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}: ${(await r.text()).slice(0, 160)}` };
    const j: any = await r.json().catch(() => ({}));
    const n = Array.isArray(j.data) ? j.data.length : Array.isArray(j.models) ? j.models.length : undefined;
    return { ok: true, detail: `clave válida${n !== undefined ? ` · ${n} modelos disponibles` : ""}` };
  } catch (err: any) {
    return { ok: false, detail: String(err?.message ?? err).slice(0, 200) };
  }
}

export function platformInfo(): { platform: NodeJS.Platform; home: string; sep: string } {
  return { platform: process.platform, home: os.homedir(), sep: path.sep };
}

export { existsSync };
