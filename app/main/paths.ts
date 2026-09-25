import { readdirSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * La app lanzada desde el menú de KDE no hereda el PATH de la terminal.
 * Se añaden las ubicaciones habituales de los CLIs: ~/.local/bin (Claude Code),
 * la versión más reciente de Node bajo NVM (Codex, Gemini) y otros directorios comunes.
 */
export function augmentPath(): string[] {
  const home = os.homedir();
  const candidates: string[] = [path.join(home, ".local", "bin"), path.join(home, ".npm-global", "bin"), "/usr/local/bin", "/snap/bin"];
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  if (existsSync(nvmDir)) {
    const versions = readdirSync(nvmDir)
      .filter((v) => /^v\d+/.test(v))
      .sort((a, b) => compareVersions(b, a));
    for (const v of versions) candidates.push(path.join(nvmDir, v, "bin"));
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

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
