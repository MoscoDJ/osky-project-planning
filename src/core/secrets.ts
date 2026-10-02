import { promises as fs, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_DIR_NAME = "osky-project-planning";
const LEGACY_DIR_NAME = "osky-debate";

/** Carpeta de configuración según el sistema operativo. */
export function defaultConfigDir(): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_DIR_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP_DIR_NAME);
}

function legacyConfigDir(): string {
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), LEGACY_DIR_NAME);
}

/** Copia secrets.env y config.json de la carpeta anterior (osky-debate) si la nueva aún no existe. */
export async function migrateLegacyConfig(configDir: string): Promise<string[]> {
  const legacy = legacyConfigDir();
  if (legacy === configDir || !existsSync(legacy)) return [];
  const copied: string[] = [];
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  for (const f of ["secrets.env", "config.json"]) {
    const src = path.join(legacy, f);
    const dst = path.join(configDir, f);
    if (existsSync(src) && !existsSync(dst)) {
      await fs.copyFile(src, dst);
      if (f === "secrets.env") await fs.chmod(dst, 0o600).catch(() => undefined);
      copied.push(f);
    }
  }
  return copied;
}

export function secretsFile(configDir: string): string {
  return path.join(configDir, "secrets.env");
}

export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function readSecretsSync(configDir: string): Record<string, string> {
  try {
    return parseEnv(readFileSync(secretsFile(configDir), "utf8"));
  } catch {
    return {};
  }
}

/** Guarda o borra (value vacío) una clave en secrets.env con permisos 600. */
export async function setSecret(configDir: string, name: string, value: string): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Nombre de clave inválido: ${name}`);
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  const current = readSecretsSync(configDir);
  const clean = value.trim();
  if (clean) current[name] = clean;
  else delete current[name];
  const body =
    "# Claves de Osky Project Planning. No compartir ni subir a git.\n" +
    Object.entries(current)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") +
    "\n";
  const file = secretsFile(configDir);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(tmp, body, { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600).catch(() => undefined);
  if (clean) process.env[name] = clean;
  else delete process.env[name];
}

/** Archivos de clave propios de cada CLI, que la app reconoce como fuente adicional. */
function cliKeyFile(name: string): string | undefined {
  if (name === "GEMINI_API_KEY") return path.join(os.homedir(), ".gemini", ".env");
  return undefined;
}

function fromCliFile(name: string): string | undefined {
  const f = cliKeyFile(name);
  if (!f) return undefined;
  try {
    return parseEnv(readFileSync(f, "utf8"))[name] || undefined;
  } catch {
    return undefined;
  }
}

export type SecretSource = "secrets" | "env" | "cli";

/** Estado de una clave sin revelarla: si existe, sus últimos 4 caracteres y de dónde viene. */
export function secretStatus(configDir: string, name: string): { set: boolean; hint?: string; source?: SecretSource } {
  const s = readSecretsSync(configDir);
  if (s[name]) return { set: true, hint: s[name].slice(-4), source: "secrets" };
  const env = process.env[name];
  if (env) return { set: true, hint: env.slice(-4), source: "env" };
  const cli = fromCliFile(name);
  if (cli) return { set: true, hint: cli.slice(-4), source: "cli" };
  return { set: false };
}

/** Carga secrets.env en process.env sin pisar variables ya definidas. */
export function loadSecretsIntoEnv(configDir: string): void {
  for (const [k, v] of Object.entries(readSecretsSync(configDir))) {
    if (!process.env[k]) process.env[k] = v;
  }
}

/** Valor de una clave: secrets.env, después el entorno y por último el archivo propio del CLI. */
export function getSecret(configDir: string, name: string): string | undefined {
  return readSecretsSync(configDir)[name] || process.env[name] || fromCliFile(name) || undefined;
}
