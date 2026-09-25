import type { Snapshot } from "../api";

const PHASE_LABEL: Record<string, string> = {
  initial: "Fase inicial",
  awaiting_user: "Esperando al usuario",
  user_cycle: "Ciclo de observación",
  finalized: "Plan aprobado",
  candidate_ready: "Candidato listo",
  closed: "Cerrado",
};

export function TopBar({ snap, busy, onAction }: { snap: Snapshot | null; busy: string | null; onAction: (name: string, arg?: string) => void }) {
  const s = snap?.state;
  if (!s) {
    return (
      <div className="top">
        <span className="title">Osky Debate</span>
        <span className="muted">Sistema de debate de planeación entre IAs</span>
      </div>
    );
  }
  const published = s.turns.filter((t) => t.status === "published").length;
  const total = s.turns.length;
  const current = s.turns.find((t) => t.status === "pending" || t.status === "failed" || t.status === "paused_blocking" || t.status === "running");
  const failed = current?.status === "failed";
  const paused = current?.status === "paused_blocking";
  const inTurns = s.phase === "initial" || s.phase === "user_cycle";
  const idle = !busy;

  return (
    <div className="top">
      <span className="title">{s.title}</span>
      <span className="badge">{PHASE_LABEL[s.phase] ?? s.phase}</span>
      <span className="kv small">
        <span className="pA">A</span> {s.participants.A.spec.label}
        <span className="muted">·</span>
        <span className="pB">B</span> {s.participants.B.spec.label}
        <span className="muted">·</span>
        <span className="pC">C</span> {s.config.consolidator.label}
      </span>
      <span className="badge">
        Turnos {published}/{total}
      </span>
      {s.abbreviated && <span className="badge warn">Abreviado</span>}
      {busy && (
        <span className="badge busy">
          <span className="spin" /> {busy}
        </span>
      )}
      <span className="spacer" />
      {inTurns && !paused && (
        <>
          <button className="primary" disabled={!idle || failed} onClick={() => onAction("run")}>
            {published === 0 ? "Iniciar" : "Continuar"}
          </button>
          <button disabled={!idle || failed} onClick={() => onAction("next")}>
            Un turno
          </button>
          <button disabled={idle} onClick={() => onAction("pause")}>
            Pausar
          </button>
          <button className="danger" disabled={idle} onClick={() => onAction("cancel")}>
            Cancelar turno
          </button>
          {failed && (
            <>
              <button className="primary" disabled={!idle} onClick={() => onAction("retry")}>
                Reintentar
              </button>
              <button disabled={!idle} onClick={() => onAction("skip")}>
                Saltar
              </button>
            </>
          )}
        </>
      )}
      {s.phase === "awaiting_user" && (
        <button className="primary" disabled={!idle} onClick={() => onAction("finalize")}>
          Finalizar plan
        </button>
      )}
      {(s.phase === "finalized" || s.phase === "candidate_ready") && (
        <>
          <button className="primary" disabled={!idle} onClick={() => onAction("consolidate", "primary")}>
            Consolidar con {s.config.consolidator.label}
          </button>
          <button disabled={!idle} onClick={() => onAction("consolidate", "alt")}>
            Consolidar con {s.config.consolidatorAlt.label}
          </button>
          {busy && (
            <button className="danger" onClick={() => onAction("cancel")}>
              Cancelar
            </button>
          )}
        </>
      )}
      {s.phase === "candidate_ready" && (
        <>
          <button className="primary" disabled={!idle} onClick={() => onAction("accept")}>
            Aceptar candidato
          </button>
          <button className="danger" disabled={!idle} onClick={() => onAction("discard")}>
            Descartar
          </button>
        </>
      )}
    </div>
  );
}
