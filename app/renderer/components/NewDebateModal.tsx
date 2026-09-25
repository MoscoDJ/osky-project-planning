import { useState } from "react";
import type { CreateOptions, UiConfig } from "../api";

export function NewDebateModal({
  config,
  onCancel,
  onCreate,
}: {
  config: UiConfig;
  onCancel: () => void;
  onCreate: (opts: CreateOptions, run: boolean) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [rounds, setRounds] = useState(3);
  const [opener, setOpener] = useState<"random" | "A" | "B">("random");
  const [allowWeb, setAllowWeb] = useState(true);
  const [fake, setFake] = useState(false);
  const [autoSubstitute, setAutoSubstitute] = useState(true);
  const [cycleOrder, setCycleOrder] = useState<"global" | "alternate">("global");
  const [decisions, setDecisions] = useState("");
  const [contextDirs, setContextDirs] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const models = fake ? config.fakeModels : config.models;
  const valid = title.trim().length > 0 && brief.trim().length > 0;

  const submit = async (run: boolean) => {
    setSubmitting(true);
    try {
      await onCreate(
        {
          title: title.trim(),
          brief: brief.trim(),
          rounds: Math.max(1, Math.min(10, rounds)),
          allowWeb,
          contextDirs,
          opener,
          fake,
          autoSubstitute,
          cycleOrder,
          decisions: decisions
            .split("\n")
            .map((d) => d.trim())
            .filter(Boolean),
        },
        run,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo debate</h3>
        <div className="form">
          <label>Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del proyecto" autoFocus />

          <label>Petición</label>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={7}
            placeholder="Describe el proyecto que quieres planear, con todo el contexto que tengas."
          />

          <label>Decisiones y restricciones</label>
          <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={3} placeholder="Una por línea. Los participantes no las cambian por acuerdo entre ellos." />

          <label>Rondas</label>
          <div className="row">
            <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={{ width: 70 }} />
            <span className="muted small">intervenciones por participante en la fase inicial ({rounds * 2} turnos)</span>
          </div>

          <label>Quién abre</label>
          <select value={opener} onChange={(e) => setOpener(e.target.value as "random" | "A" | "B")}>
            <option value="random">Sorteo</option>
            <option value="A">Participante A ({models.A.label})</option>
            <option value="B">Participante B ({models.B.label})</option>
          </select>

          <label>Orden de ciclos</label>
          <select value={cycleOrder} onChange={(e) => setCycleOrder(e.target.value as "global" | "alternate")}>
            <option value="global">Global: empieza quien no habló último</option>
            <option value="alternate">Alternar quién abre cada ciclo</option>
          </select>

          <label>Carpetas de contexto</label>
          <div className="row" style={{ flexWrap: "wrap" }}>
            {contextDirs.map((d) => (
              <span key={d} className="badge">
                {d}{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), setContextDirs(contextDirs.filter((x) => x !== d)))}>
                  ×
                </a>
              </span>
            ))}
            <button
              onClick={async () => {
                const d = await window.api.pickDir();
                if (d && !contextDirs.includes(d)) setContextDirs([...contextDirs, d]);
              }}
            >
              Agregar carpeta (solo lectura)
            </button>
          </div>

          <label>Opciones</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
            <label className="kv">
              <input type="checkbox" checked={allowWeb} onChange={(e) => setAllowWeb(e.target.checked)} /> Búsqueda web
            </label>
            <label className="kv">
              <input type="checkbox" checked={autoSubstitute} onChange={(e) => setAutoSubstitute(e.target.checked)} /> Sustituto automático ({config.models.substitute.label})
            </label>
            <label className="kv">
              <input type="checkbox" checked={fake} onChange={(e) => setFake(e.target.checked)} /> Participantes simulados (sin cuota)
            </label>
          </div>

          <label>Participantes</label>
          <div className="small muted">
            <span className="pA">A</span> {models.A.label} · <span className="pB">B</span> {models.B.label} · <span className="pC">C</span> {models.consolidator.label}{" "}
            (alternativa {models.consolidatorAlt.label})
          </div>
        </div>
        <div className="foot">
          <button onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          <button onClick={() => submit(false)} disabled={!valid || submitting}>
            Crear
          </button>
          <button className="primary" onClick={() => submit(true)} disabled={!valid || submitting}>
            Crear e iniciar
          </button>
        </div>
      </div>
    </div>
  );
}
