import { readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Una app lanzada desde el menú del escritorio (KDE, Dock de macOS, menú Inicio de Windows)
 * no hereda el PATH de la terminal. Se añaden las ubicaciones habituales de los CLIs:
 * ~/.local/bin (Claude Code), la versión más reciente de Node bajo NVM (Codex, Gemini),
 * Homebrew en macOS y la carpeta global de npm en Windows.
 */
export function augmentPath(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    candidates.push(path.join(appData, "npm"), path.join(home, ".local", "bin"), path.join(local, "Programs", "claude"), path.join(local, "Microsoft", "WindowsApps"));
    const nvmHome = process.env.NVM_HOME;
    if (nvmHome && existsSync(nvmHome)) candidates.push(...nodeVersions(nvmHome, (v) => path.join(nvmHome, v)));
  } else {
    candidates.push(path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), path.join(home, ".bun", "bin"), "/usr/local/bin");
    if (process.platform === "darwin") candidates.push("/opt/homebrew/bin", "/opt/homebrew/sbin");
    else candidates.push("/snap/bin");
    const nvmDir = path.join(process.env.NVM_DIR ?? path.join(home, ".nvm"), "versions", "node");
    if (existsSync(nvmDir)) candidates.push(...nodeVersions(nvmDir, (v) => path.join(nvmDir, v, "bin")));
  }
  const current = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const added: string[] = [];
  for (const c of candidates) {
    if (existsSync(c) && !current.includes(c)) {
      current.push(c);
      added.push(c);
    }
  }
  process.env.PATH = current.join(path.delimiter);
  return added;
}

function nodeVersions(dir: string, toBin: (v: string) => string): string[] {
  return readdirSync(dir)
    .filter((v) => /^v?\d+/.test(v))
    .sort((a, b) => compareVersions(b, a))
    .map(toBin);
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Busca un ejecutable en el PATH (con extensiones de Windows). */
export function findExecutable(name: string): string | undefined {
  if (path.isAbsolute(name)) return existsSync(name) ? name : undefined;
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}
