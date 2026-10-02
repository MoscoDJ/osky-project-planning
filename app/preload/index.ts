import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const api = {
  config: () => ipcRenderer.invoke("config:get"),
  listDebates: () => ipcRenderer.invoke("debates:list"),
  createDebate: (opts: unknown) => ipcRenderer.invoke("debate:create", opts),
  openDebate: (workspace: string) => ipcRenderer.invoke("debate:open", workspace),
  snapshot: () => ipcRenderer.invoke("debate:snapshot"),
  action: (name: string, arg?: string) => ipcRenderer.invoke("debate:action", name, arg),
  turnDiff: (n: number) => ipcRenderer.invoke("debate:turnDiff", n),
  candidateDiff: () => ipcRenderer.invoke("debate:candidateDiff"),
  pickDir: () => ipcRenderer.invoke("dialog:pickDir"),
  settingsStatus: () => ipcRenderer.invoke("settings:status"),
  setKey: (name: string, value: string) => ipcRenderer.invoke("settings:setKey", name, value),
  testProvider: (id: string) => ipcRenderer.invoke("settings:test", id),
  login: (id: string) => ipcRenderer.invoke("settings:login", id),
  saveSettings: (s: unknown) => ipcRenderer.invoke("settings:save", s),
  openPath: (target: string) => ipcRenderer.invoke("shell:open", target),
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  onEvent: (cb: (ev: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, ev: unknown) => cb(ev);
    ipcRenderer.on("debate:event", handler);
    return () => ipcRenderer.off("debate:event", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
