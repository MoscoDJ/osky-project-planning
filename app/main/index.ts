import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar, { type FSWatcher } from "chokidar";
import { DebateEngine } from "../../src/core/engine.js";
import { createRegistry, fakeParticipants, FAKE_MODELS, loadConfig, saveConfig, type AppConfig, type ModelDefaults } from "../../src/core/config.js";
import { CATALOG } from "../../src/core/catalog.js";
import { PROVIDERS } from "../../src/core/providers.js";
import { setSecret } from "../../src/core/secrets.js";
import { normalizeSpec } from "../../src/core/engine.js";
import { openLoginTerminal, platformInfo, providerStatuses, testProvider } from "./settings.js";
import { FakeAdapter } from "../../src/core/adapters/fake.js";
import { Git } from "../../src/core/git.js";
import { CANDIDATE_FILE, PLAN_FILE, STATE_FILE } from "../../src/core/prompts.js";
import type { DebateState, EngineEvent, ModelSpec } from "../../src/core/types.js";
import { augmentPath } from "./paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface DebateSummary {
  workspace: string;
  title: string;
  phase: string;
  updatedAt: string;
  createdAt: string;
  turns: number;
}

export interface Snapshot {
  workspace: string;
  state: DebateState;
  plan: string;
  candidate: string | null;
  busy: string | null;
}

export type UiEvent =
  | EngineEvent
  | { type: "busy"; busy: string | null }
  | { type: "file"; file: string; content: string | null };

let win: BrowserWindow | undefined;
let cfg: AppConfig;
let engine: DebateEngine | undefined;
let unsubscribe: (() => void) | undefined;
let watcher: FSWatcher | undefined;
let busy: string | null = null;

function send(ev: UiEvent): void {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("debate:event", JSON.parse(JSON.stringify(ev)));
  } catch {
    /* eventos no serializables se descartan */
  }
}

async function readOrNull(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function snapshot(): Promise<Snapshot | null> {
  if (!engine) return null;
  return {
    workspace: engine.workspace,
    state: JSON.parse(JSON.stringify(engine.state)),
    plan: (await readOrNull(path.join(engine.workspace, PLAN_FILE))) ?? "",
    candidate: await readOrNull(path.join(engine.workspace, CANDIDATE_FILE)),
    busy: busy ?? engine.busy,
  };
}

function attach(e: DebateEngine): void {
  unsubscribe?.();
  watcher?.close();
  engine = e;
  unsubscribe = e.on((ev) => send(ev));
  const files = [path.join(e.workspace, PLAN_FILE), path.join(e.workspace, CANDIDATE_FILE)];
  watcher = chokidar.watch(files, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  const notify = async (file: string) => send({ type: "file", file: path.basename(file), content: await readOrNull(file) });
  watcher.on("add", notify).on("change", notify).on("unlink", (f) => send({ type: "file", file: path.basename(f), content: null }));
}

async function listDebates(): Promise<DebateSummary[]> {
  const root = cfg.debatesRoot;
  let entries: string[] = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: DebateSummary[] = [];
  for (const name of entries) {
    const ws = path.join(root, name);
    const raw = await readOrNull(path.join(ws, STATE_FILE));
    if (!raw) continue;
    try {
      const s = JSON.parse(raw) as DebateState;
      out.push({ workspace: ws, title: s.title, phase: s.phase, updatedAt: s.updatedAt, createdAt: s.createdAt, turns: s.turns.length });
    } catch {
      /* estado corrupto: se omite */
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export interface CreateOptions {
  title: string;
  brief: string;
  rounds: number;
  allowWeb: boolean;
  contextDirs: string[];
  opener: string;
  /** Participantes en orden; con fake se ignora y se usan `fakeCount` simulados. */
  participants: ModelSpec[];
  fake: boolean;
  fakeCount?: number;
  autoSubstitute: boolean;
  cycleOrder: "global" | "alternate";
  decisions: string[];
}

function registry(): ReturnType<typeof createRegistry> {
  return createRegistry(cfg, new FakeAdapter());
}

async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error(`Hay una operación en curso: ${busy}`);
  busy = label;
  send({ type: "busy", busy });
  try {
    return await fn();
  } finally {
    busy = null;
    send({ type: "busy", busy: null });
  }
}

async function doAction(name: string, arg?: string): Promise<Snapshot | null> {
  if (!engine) throw new Error("No hay ningún debate abierto.");
  const e = engine;
  if (name === "pause") {
    e.pause();
    return snapshot();
  }
  if (name === "cancel") {
    e.cancel();
    return snapshot();
  }
  return withBusy(name, async () => {
    switch (name) {
      case "run":
        await e.run();
        break;
      case "next":
        await e.next();
        break;
      case "retry":
        await e.retry();
        break;
      case "skip":
        await e.skip();
        break;
      case "say":
        await e.say(arg ?? "");
        break;
      case "sayAndRun":
        await e.say(arg ?? "");
        if (e.state.phase === "user_cycle") await e.run();
        break;
      case "decide":
        await e.decide(arg ?? "");
        break;
      case "finalize":
        await e.finalize();
        break;
      case "consolidate":
        await e.consolidate(arg === "alt" ? "alt" : "primary");
        break;
      case "accept":
        await e.acceptCandidate();
        break;
      case "discard":
        await e.discardCandidate();
        break;
      default:
        throw new Error(`Acción desconocida: ${name}`);
    }
    return snapshot();
  });
}

function registerIpc(): void {
  ipcMain.handle("config:get", () => ({
    version: app.getVersion(),
    debatesRoot: cfg.debatesRoot,
    configDir: cfg.configDir,
    models: cfg.models,
    rounds: cfg.rounds,
    autoSubstitute: cfg.autoSubstitute,
    fakeModels: FAKE_MODELS,
    catalog: CATALOG,
    providers: PROVIDERS,
    pathAdded: augmentedPaths,
    ...platformInfo(),
  }));

  ipcMain.handle("settings:status", () => providerStatuses(cfg));

  ipcMain.handle("settings:setKey", async (_e, name: string, value: string) => {
    if (!PROVIDERS.some((p) => p.keyEnv === name)) throw new Error(`Clave desconocida: ${name}`);
    await setSecret(cfg.configDir, name, value);
    return providerStatuses(cfg);
  });

  ipcMain.handle("settings:test", (_e, providerId: string) => testProvider(providerId, cfg));

  ipcMain.handle("settings:login", (_e, providerId: string) => openLoginTerminal(providerId, cfg));

  ipcMain.handle(
    "settings:save",
    async (_e, s: { models: ModelDefaults; rounds?: number; autoSubstitute?: boolean; debatesRoot?: string }) => {
      if (!s.models?.participants || s.models.participants.length < 2) throw new Error("Se necesitan al menos dos participantes por defecto.");
      cfg.models = {
        participants: s.models.participants.map(normalizeSpec),
        substitute: normalizeSpec(s.models.substitute),
        consolidator: normalizeSpec(s.models.consolidator),
        consolidatorAlt: normalizeSpec(s.models.consolidatorAlt),
      };
      if (s.rounds) cfg.rounds = Math.max(1, Math.min(10, s.rounds));
      if (typeof s.autoSubstitute === "boolean") cfg.autoSubstitute = s.autoSubstitute;
      if (s.debatesRoot?.trim()) cfg.debatesRoot = s.debatesRoot.trim();
      await saveConfig(cfg);
      return { ok: true };
    },
  );

  ipcMain.handle("debates:list", () => listDebates());

  ipcMain.handle("debate:create", async (_e, o: CreateOptions) =>
    withBusy("Creando debate", async () => {
      const models = o.fake ? FAKE_MODELS : cfg.models;
      const participants = o.fake ? fakeParticipants(Math.max(2, o.fakeCount ?? (o.participants?.length || 2))) : o.participants;
      if (!participants || participants.length < 2) throw new Error("Elige al menos dos participantes.");
      const e = await DebateEngine.create(
        {
          root: cfg.debatesRoot,
          title: o.title,
          brief: o.brief,
          rounds: o.rounds,
          allowWeb: o.allowWeb,
          contextDirs: o.contextDirs,
          opener: o.opener,
          participants,
          substitute: models.substitute,
          consolidator: models.consolidator,
          consolidatorAlt: models.consolidatorAlt,
          autoSubstitute: o.autoSubstitute,
          turnTimeoutMs: cfg.turnTimeoutMs,
          changeRatioThreshold: cfg.changeRatioThreshold,
          cycleOrder: o.cycleOrder,
          decisions: o.decisions,
        },
        registry(),
      );
      attach(e);
      return snapshot();
    }),
  );

  ipcMain.handle("debate:open", async (_e, ws: string) => {
    if (busy) throw new Error(`Hay una operación en curso: ${busy}`);
    const e = await DebateEngine.open(ws, registry());
    attach(e);
    return snapshot();
  });

  ipcMain.handle("debate:snapshot", () => snapshot());

  ipcMain.handle("debate:action", (_e, name: string, arg?: string) => doAction(name, arg));

  ipcMain.handle("debate:turnDiff", async (_e, n: number) => {
    if (!engine) return "";
    const t = engine.state.turns.find((x) => x.number === n);
    if (!t?.baseCommit || !t.commit) return "";
    return Git.diff(engine.workspace, t.baseCommit, t.commit, PLAN_FILE);
  });

  ipcMain.handle("debate:candidateDiff", async () => {
    if (!engine) return "";
    try {
      return await engine.candidateDiff();
    } catch {
      return "";
    }
  });

  ipcMain.handle("dialog:pickDir", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle("shell:open", (_e, target: string) => shell.openPath(target));
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error("Solo se abren enlaces https.");
    return shell.openExternal(url);
  });
}

let augmentedPaths: string[] = [];

const rendererDir = path.join(here, "../renderer");
/** Archivo estático del renderer: en el build está en out/renderer; en desarrollo, en app/renderer/public. */
function rendererAsset(name: string): string {
  const built = path.join(rendererDir, name);
  return existsSync(built) ? built : path.join(here, "../../app/renderer/public", name);
}

let splash: BrowserWindow | undefined;
let splashShownAt = 0;
const SPLASH_MIN_MS = 1600;

function createSplash(): void {
  splash = new BrowserWindow({
    width: 836,
    height: 470,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#0a1030",
    icon: rendererAsset("icon.png"),
    title: "Osky Project Planning",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  splash.setMenuBarVisibility(false);
  splash.once("ready-to-show", () => {
    splash?.show();
    splashShownAt = Date.now();
    const shot = process.env.OSKY_SPLASH_SHOT;
    if (shot) {
      setTimeout(async () => {
        const img = await splash!.webContents.capturePage();
        await fs.writeFile(shot, img.toPNG());
        app.quit();
      }, 1200);
    }
  });
  splash.on("closed", () => {
    splash = undefined;
  });
  if (process.env.ELECTRON_RENDERER_URL) void splash.loadURL(`${process.env.ELECTRON_RENDERER_URL}/splash.html`);
  else void splash.loadFile(path.join(rendererDir, "splash.html"));
}

/** Muestra la ventana principal y cierra el splash, respetando un tiempo mínimo de splash. */
function revealMain(): void {
  const wait = splash ? Math.max(0, SPLASH_MIN_MS - (Date.now() - (splashShownAt || Date.now()))) : 0;
  setTimeout(() => {
    win?.show();
    win?.focus();
    splash?.destroy();
  }, wait);
}

function createWindow(): void {
  const useSplash = !process.env.OSKY_SCREENSHOT && !process.env.OSKY_NO_SPLASH;
  if (useSplash) createSplash();
  win = new BrowserWindow({
    show: !useSplash,
    icon: rendererAsset("icon.png"),
    width: 1560,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    title: "Osky Project Planning",
    backgroundColor: "#14161b",
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  if (useSplash) win.once("ready-to-show", revealMain);
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(here, "../renderer/index.html"));
  }
  win.on("closed", () => {
    win = undefined;
  });

  const auto = process.env.OSKY_AUTO_ACTION;
  if (auto) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        const [name, arg] = auto.split(":");
        doAction(name, arg).catch((err) => console.error("auto action:", err));
      }, 800);
    });
  }
  const shot = process.env.OSKY_SCREENSHOT;
  if (shot) {
    win.webContents.on("did-finish-load", () => {
      setTimeout(async () => {
        try {
          // Depuración: OSKY_SCREENSHOT_JS ejecuta JS en la página antes de capturar (p. ej. abrir un diálogo).
          if (process.env.OSKY_SCREENSHOT_JS) {
            await win!.webContents.executeJavaScript(process.env.OSKY_SCREENSHOT_JS);
            await new Promise((r) => setTimeout(r, Number(process.env.OSKY_SCREENSHOT_JS_WAIT ?? 2500)));
          }
          const img = await win!.webContents.capturePage();
          await fs.writeFile(shot, img.toPNG());
        } finally {
          app.quit();
        }
      }, Number(process.env.OSKY_SCREENSHOT_DELAY ?? 2500));
    });
  }
}

app.whenReady().then(async () => {
  augmentedPaths = augmentPath();
  cfg = await loadConfig();
  registerIpc();
  const openWs = process.env.OSKY_OPEN;
  if (openWs) {
    try {
      attach(await DebateEngine.open(openWs, registry()));
    } catch (err) {
      console.error("No se pudo abrir el debate indicado:", err);
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  watcher?.close();
  app.quit();
});
