import { useEffect, useState } from "react";
import type { CreateOptions, ModelSpec, ProviderStatus, UiConfig } from "../api";
import { ModelPicker, readiness } from "./ModelPicker";
import { ParticipantsEditor } from "./SettingsModal";

const LETTERS = "ABCDEFGHIJ".split("");

export function NewDebateModal({
  config,
  onCancel,
  onCreate,
  onOpenSettings,
}: {
  config: UiConfig;
  onCancel: () => void;
  onCreate: (opts: CreateOptions, run: boolean) => Promise<void>;
  onOpenSettings: () => void;
}) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [rounds, setRounds] = useState(config.rounds);
  const [opener, setOpener] = useState<string>("random");
  const [allowWeb, setAllowWeb] = useState(true);
  const [fake, setFake] = useState(false);
  const [fakeCount, setFakeCount] = useState(2);
  const [autoSubstitute, setAutoSubstitute] = useState(config.autoSubstitute);
  const [cycleOrder, setCycleOrder] = useState<"global" | "alternate">("global");
  const [decisions, setDecisions] = useState("");
  const [contextDirs, setContextDirs] = useState<string[]>([]);
  const [participants, setParticipants] = useState<ModelSpec[]>(config.models.participants);
  const [consolidator] = useState<ModelSpec>(config.models.consolidator);
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void window.api.settingsStatus().then(setStatuses);
  }, []);

  const count = fake ? fakeCount : participants.length;
  const notReady = fake ? [] : participants.map((p, i) => ({ i, r: readiness(p, config.providers, statuses) })).filter((x) => !x.r.ok);
  const missingModel = !fake && participants.some((p) => !p.model);
  const valid = title.trim().length > 0 && brief.trim().length > 0 && !missingModel;

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
          participants,
          fake,
          fakeCount,
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
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo debate</h3>
        <div className="form">
          <label>Título</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del proyecto" autoFocus />

          <label>Petición</label>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={6} placeholder="Describe el proyecto que quieres planear, con todo el contexto que tengas." />

          <label>Decisiones y restricciones</label>
          <textarea value={decisions} onChange={(e) => setDecisions(e.target.value)} rows={3} placeholder="Una por línea. Los participantes no las cambian por acuerdo entre ellos." />

          <label>Participantes</label>
          <div>
            <label className="kv small" style={{ marginBottom: 6 }}>
              <input type="checkbox" checked={fake} onChange={(e) => setFake(e.target.checked)} /> Simulados (sin cuota ni claves)
              {fake && (
                <>
                  {" "}
                  · cuántos{" "}
                  <input type="number" min={2} max={10} value={fakeCount} onChange={(e) => setFakeCount(Number(e.target.value))} style={{ width: 60 }} />
                </>
              )}
            </label>
            {!fake && <ParticipantsEditor config={config} list={participants} onChange={setParticipants} statuses={statuses} />}
            {notReady.length > 0 && (
              <div className="small errc" style={{ marginTop: 6 }}>
                {notReady.map((x) => `${LETTERS[x.i]}: ${x.r.text}`).join(" · ")}.{" "}
                <a href="#" onClick={(e) => (e.preventDefault(), onOpenSettings())}>
                  Abrir proveedores y claves
                </a>
              </div>
            )}
          </div>

          <label>Rondas</label>
          <div className="row">
            <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={{ width: 70 }} />
            <span className="muted small">
              intervenciones por participante en la fase inicial ({rounds * count} turnos)
            </span>
          </div>

          <label>Quién abre</label>
          <select value={opener} onChange={(e) => setOpener(e.target.value)}>
            <option value="random">Sorteo del orden completo</option>
            <option value="fixed">En el orden de la lista</option>
            {LETTERS.slice(0, count).map((k, i) => (
              <option key={k} value={k}>
                Abre {k}
                {!fake && participants[i] ? ` (${participants[i].label})` : ""} y siguen en orden
              </option>
            ))}
          </select>

          <label>Orden de ciclos</label>
          <select value={cycleOrder} onChange={(e) => setCycleOrder(e.target.value as "global" | "alternate")}>
            <option value="global">Global: empieza quien sigue al último que habló</option>
            <option value="alternate">Rotar quién abre cada ciclo</option>
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
            <span className="small muted">Solo la leen los participantes por CLI; los de API reciben el plan y el material del turno.</span>
          </div>

          <label>Opciones</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
            <label className="kv">
              <input type="checkbox" checked={allowWeb} onChange={(e) => setAllowWeb(e.target.checked)} /> Búsqueda web
            </label>
            <label className="kv">
              <input type="checkbox" checked={autoSubstitute} onChange={(e) => setAutoSubstitute(e.target.checked)} /> Sustituto automático ({config.models.substitute.label})
            </label>
          </div>

          <label>Consolidador</label>
          <div className="small muted">
            {consolidator.label} (alterno {config.models.consolidatorAlt.label}).{" "}
            <a href="#" onClick={(e) => (e.preventDefault(), onOpenSettings())}>
              Cambiar en Ajustes
            </a>
          </div>
        </div>
        <div className="foot">
          <button onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          <button onClick={() => submit(false)} disabled={!valid || submitting}>
            Crear
          </button>
          <button className="primary" onClick={() => submit(true)} disabled={!valid || submitting || notReady.length > 0}>
            Crear e iniciar
          </button>
        </div>
      </div>
    </div>
  );
}

export { ModelPicker };
