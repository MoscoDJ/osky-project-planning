import { useCallback, useEffect, useRef, useState } from "react";
import type { DebateSummary, Snapshot, UiConfig, UiEvent, CreateOptions } from "./api";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { PlanPanel } from "./components/PlanPanel";
import { DebatePanel } from "./components/DebatePanel";
import { NewDebateModal } from "./components/NewDebateModal";
import { SettingsModal } from "./components/SettingsModal";

export interface StreamState {
  turn: number;
  lines: Array<{ kind: "text" | "tool" | "status" | "model"; text: string }>;
}

function cleanError(err: unknown): string {
  const m = String((err as any)?.message ?? err);
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

export function App() {
  const [config, setConfig] = useState<UiConfig | null>(null);
  const [debates, setDebates] = useState<DebateSummary[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stream, setStream] = useState<StreamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [input, setInput] = useState("");
  const streamText = useRef("");

  const refreshList = useCallback(async () => {
    try {
      setDebates(await window.api.listDebates());
    } catch (e) {
      setError(cleanError(e));
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    try {
      const s = await window.api.snapshot();
      if (s) setSnap(s);
    } catch (e) {
      setError(cleanError(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await window.api.config());
        await refreshList();
        await refreshSnapshot();
      } catch (e) {
        setError(cleanError(e));
      }
    })();
  }, [refreshList, refreshSnapshot]);

  useEffect(() => {
    return window.api.onEvent((ev: UiEvent) => {
      switch (ev.type) {
        case "busy":
          setBusy(ev.busy);
          if (!ev.busy) {
            void refreshSnapshot();
            void refreshList();
          }
          break;
        case "file":
          setSnap((s) => {
            if (!s) return s;
            if (ev.file === "plan.md") return { ...s, plan: ev.content ?? s.plan };
            if (ev.file === "plan.candidate.md") return { ...s, candidate: ev.content };
            return s;
          });
          break;
        case "turn_start":
          streamText.current = "";
          setStream({ turn: ev.turn.number, lines: [{ kind: "status", text: `Intento ${ev.attempt} · ${ev.model}` }] });
          void refreshSnapshot();
          break;
        case "adapter": {
          const a = ev.event;
          const turn = ev.turn?.number ?? 0;
          if (a.type === "text" && a.text) {
            streamText.current += a.text;
            const text = streamText.current;
            setStream((st) => {
              const base = st && st.turn === turn ? st : { turn, lines: [] };
              const lines = base.lines.filter((l) => l.kind !== "text");
              return { turn, lines: [...lines, { kind: "text", text }] };
            });
          } else if (a.type === "tool" || a.type === "status" || a.type === "model") {
            const text = a.type === "model" ? `modelo reportado: ${a.model}` : (a.text ?? "");
            setStream((st) => {
              const base = st && st.turn === turn ? st : { turn, lines: [] };
              const textLine = base.lines.find((l) => l.kind === "text");
              const others = base.lines.filter((l) => l.kind !== "text");
              const next = [...others, { kind: a.type as "tool" | "status" | "model", text }];
              return { turn, lines: textLine ? [...next, textLine] : next };
            });
          }
          break;
        }
        case "turn_end":
        case "phase":
        case "consolidation":
          void refreshSnapshot();
          break;
        case "log":
          if (ev.level === "error") setError(ev.message);
          break;
      }
    });
  }, [refreshSnapshot, refreshList]);

  const act = useCallback(
    async (name: string, arg?: string) => {
      setError(null);
      try {
        const s = await window.api.action(name, arg);
        setSnap(s);
      } catch (e) {
        setError(cleanError(e));
        await refreshSnapshot();
      }
    },
    [refreshSnapshot],
  );

  const openDebate = useCallback(async (ws: string) => {
    setError(null);
    try {
      setSnap(await window.api.openDebate(ws));
      setStream(null);
    } catch (e) {
      setError(cleanError(e));
    }
  }, []);

  const createDebate = useCallback(
    async (opts: CreateOptions, run: boolean) => {
      setError(null);
      try {
        const s = await window.api.createDebate(opts);
        setSnap(s);
        setStream(null);
        setShowNew(false);
        await refreshList();
        if (run) await act("run");
      } catch (e) {
        setError(cleanError(e));
      }
    },
    [act, refreshList],
  );

  const state = snap?.state;
  const paused = state?.turns.find((t) => t.status === "paused_blocking");
  const canSay = !!state && !busy && (state.phase === "awaiting_user" || !!paused);
  const sayLabel = paused ? `Responder pregunta bloqueante (turno ${paused.number})` : "Enviar observación y ejecutar ciclo";

  const submit = async (mode: "say" | "sayAndRun" | "decide") => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await act(mode, text);
  };

  return (
    <div className="app">
      <TopBar snap={snap} busy={busy} onAction={act} onSettings={() => setShowSettings(true)} />
      <Sidebar debates={debates} current={snap?.workspace} onOpen={openDebate} onNew={() => setShowNew(true)} onRefresh={refreshList} />
      {snap && state ? (
        <>
          <PlanPanel snap={snap} busy={busy} />
          <DebatePanel snap={snap} stream={stream} busy={busy} />
          <div className="bottom">
            <textarea
              placeholder={
                paused
                  ? "Escribe la respuesta a la pregunta bloqueante…"
                  : state.phase === "awaiting_user"
                    ? "Escribe una observación para abrir un ciclo con una respuesta por participante, o registra una decisión…"
                    : "La caja se habilita cuando el debate espera al usuario."
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!canSay && !(state && !busy)}
            />
            <div className="actions">
              <button className="primary" disabled={!canSay || !input.trim()} onClick={() => submit(paused ? "say" : "sayAndRun")}>
                {sayLabel}
              </button>
              {!paused && state.phase === "awaiting_user" && (
                <button disabled={!canSay || !input.trim()} onClick={() => submit("say")}>
                  Enviar observación sin ejecutar
                </button>
              )}
              <button disabled={!!busy || !input.trim() || !!paused} onClick={() => submit("decide")}>
                Registrar como decisión
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="plan" style={{ gridColumn: "plan / debate" }}>
          <div className="empty">
            <img src="./icon.png" alt="" width={112} height={112} style={{ filter: "drop-shadow(0 6px 24px rgba(91,157,255,0.35))" }} />
            <div style={{ fontSize: 20, fontWeight: 600 }}>Osky Project Planning</div>
            <div className="muted small">Modelos de IA de frontera debaten, refinan y consolidan tu plan de proyecto.</div>
            <div>Abre un debate de la lista o crea uno nuevo.</div>
            <div className="row">
              <button className="primary" onClick={() => setShowNew(true)}>
                Nuevo debate
              </button>
              <button onClick={() => setShowSettings(true)}>Modelos, proveedores y claves</button>
            </div>
            {config && (
              <div className="small muted">
                Versión {config.version} · Debates en {config.debatesRoot}
              </div>
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="toast">
          {error}
          <button onClick={() => setError(null)}>Cerrar</button>
        </div>
      )}
      {showNew && config && (
        <NewDebateModal
          config={config}
          onCancel={() => setShowNew(false)}
          onCreate={createDebate}
          onOpenSettings={() => {
            setShowNew(false);
            setShowSettings(true);
          }}
        />
      )}
      {showSettings && config && (
        <SettingsModal
          config={config}
          onClose={() => setShowSettings(false)}
          onSaved={async () => setConfig(await window.api.config())}
        />
      )}
    </div>
  );
}
