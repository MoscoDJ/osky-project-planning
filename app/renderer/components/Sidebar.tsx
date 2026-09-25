import type { DebateSummary } from "../api";

const PHASE_SHORT: Record<string, string> = {
  initial: "fase inicial",
  awaiting_user: "espera usuario",
  user_cycle: "ciclo",
  finalized: "aprobado",
  candidate_ready: "candidato",
  closed: "cerrado",
};

export function Sidebar({
  debates,
  current,
  onOpen,
  onNew,
  onRefresh,
}: {
  debates: DebateSummary[];
  current?: string;
  onOpen: (ws: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="side">
      <div className="head">
        <strong>Debates</strong>
        <span className="kv">
          <button onClick={onRefresh} title="Actualizar lista">
            ↻
          </button>
          <button className="primary" onClick={onNew}>
            Nuevo
          </button>
        </span>
      </div>
      <div className="list">
        {debates.length === 0 && <div className="item muted">Todavía no hay debates.</div>}
        {debates.map((d) => (
          <div key={d.workspace} className={`item ${d.workspace === current ? "active" : ""}`} onClick={() => onOpen(d.workspace)}>
            <div className="t">{d.title}</div>
            <div className="small muted">
              {PHASE_SHORT[d.phase] ?? d.phase} · {d.turns} turnos · {new Date(d.updatedAt).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
