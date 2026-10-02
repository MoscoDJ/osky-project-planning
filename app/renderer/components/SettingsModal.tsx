import { useEffect, useState } from "react";
import type { ModelDefaults, ModelSpec, ProviderStatus, UiConfig } from "../api";
import { ACCESS_LABEL, LETTER_CLASS, ModelPicker } from "./ModelPicker";

const LETTERS = "ABCDEFGHIJ".split("");

export function ParticipantsEditor({
  config,
  list,
  onChange,
  statuses,
}: {
  config: UiConfig;
  list: ModelSpec[];
  onChange: (l: ModelSpec[]) => void;
  statuses: ProviderStatus[] | null;
}) {
  const set = (i: number, s: ModelSpec) => onChange(list.map((x, j) => (j === i ? s : x)));
  return (
    <div className="participants">
      {list.map((s, i) => (
        <div className="prow" key={i}>
          <span className={`letter ${LETTER_CLASS(LETTERS[i])}`}>{LETTERS[i]}</span>
          <ModelPicker config={config} value={s} onChange={(v) => set(i, v)} statuses={statuses} />
          <button title="Subir" disabled={i === 0} onClick={() => onChange(list.map((x, j) => (j === i - 1 ? list[i] : j === i ? list[i - 1] : x)))}>
            ↑
          </button>
          <button title="Quitar" className="danger" disabled={list.length <= 2} onClick={() => onChange(list.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button disabled={list.length >= LETTERS.length} onClick={() => onChange([...list, { ...list[list.length - 1] }])}>
        + Agregar participante
      </button>
    </div>
  );
}

function ProviderRow({
  config,
  p,
  st,
  onStatuses,
}: {
  config: UiConfig;
  p: UiConfig["providers"][number];
  st?: ProviderStatus;
  onStatuses: (s: ProviderStatus[]) => void;
}) {
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ ok: boolean; detail: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const models = config.catalog.filter((m) => m.offerings.some((o) => o.provider === p.id)).map((m) => m.label);

  const save = async (value: string) => {
    setBusy(true);
    try {
      onStatuses(await window.api.setKey(p.keyEnv!, value));
      setKey("");
      setTest(null);
      setMsg(value ? "Clave guardada." : "Clave borrada.");
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="prov">
      <div className="prov-head">
        <strong>{p.label}</strong>
        <span className="small muted">{p.access.map((a) => ACCESS_LABEL[a]).join(" · ")}</span>
        {p.web !== "none" && <span className="badge">web</span>}
      </div>
      {p.notes && <div className="small muted">{p.notes}</div>}
      {models.length > 0 && <div className="small muted">Modelos del catálogo: {models.join(", ")}</div>}
      {st?.cli && (
        <div className="row small">
          {st.cli.installed ? (
            <span className="badge ok">{st.cli.version ?? "instalado"}</span>
          ) : (
            <span className="badge err">{p.binary} no instalado</span>
          )}
          {st.cli.installed && st.cli.login !== "not-supported" && (
            <span className={`badge ${st.cli.login === "logged-in" ? "ok" : "warn"}`}>
              {st.cli.login === "logged-in" ? `sesión iniciada${st.cli.loginDetail ? ` · ${st.cli.loginDetail}` : ""}` : "sin sesión"}
            </span>
          )}
          {p.loginCommand && st.cli.installed && (
            <button
              onClick={async () => {
                try {
                  const t = await window.api.login(p.id);
                  setMsg(`Se abrió ${t} con el login. Al terminar, pulsa Actualizar estado.`);
                } catch (e: any) {
                  setMsg(String(e?.message ?? e));
                }
              }}
            >
              Iniciar sesión…
            </button>
          )}
        </div>
      )}
      {p.keyEnv && (
        <div className="row">
          <code className="small">{p.keyEnv}</code>
          {st?.keySet ? (
            <span className="badge ok">
              configurada …{st.keyHint}
              {st.keySource === "env" ? " (variable de entorno)" : st.keySource === "cli" ? " (archivo del CLI)" : ""}
            </span>
          ) : (
            <span className="badge">sin clave</span>
          )}
          <input type="password" placeholder="Pegar clave" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="primary" disabled={!key.trim() || busy} onClick={() => save(key)}>
            Guardar
          </button>
          {st?.keySet && st.keySource === "secrets" && (
            <button className="danger" disabled={busy} onClick={() => save("")}>
              Borrar
            </button>
          )}
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setTest(await window.api.testProvider(p.id));
              setBusy(false);
            }}
          >
            Probar
          </button>
          {p.keyUrl && (
            <a href="#" onClick={(e) => (e.preventDefault(), window.api.openExternal(p.keyUrl!))}>
              Obtener clave
            </a>
          )}
        </div>
      )}
      {!p.keyEnv && p.kind === "cli" && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setTest(await window.api.testProvider(p.id));
            setBusy(false);
          }}
        >
          Probar
        </button>
      )}
      {test && <div className={`small ${test.ok ? "okc" : "errc"}`}>{test.ok ? "✓ " : "✖ "}{test.detail}</div>}
      {msg && <div className="small muted">{msg}</div>}
    </div>
  );
}

export function SettingsModal({
  config,
  onClose,
  onSaved,
}: {
  config: UiConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"providers" | "models">("models");
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null);
  const [models, setModels] = useState<ModelDefaults>(config.models);
  const [rounds, setRounds] = useState(config.rounds);
  const [autoSub, setAutoSub] = useState(config.autoSubstitute);
  const [root, setRoot] = useState(config.debatesRoot);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => setStatuses(await window.api.settingsStatus());
  useEffect(() => {
    void refresh();
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.api.saveSettings({ models, rounds, autoSubstitute: autoSub, debatesRoot: root });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Ajustes</h3>
          <span className="tabs kv">
            <button className={tab === "models" ? "active" : ""} onClick={() => setTab("models")}>
              Modelos por defecto
            </button>
            <button className={tab === "providers" ? "active" : ""} onClick={() => setTab("providers")}>
              Proveedores y claves
            </button>
            <button onClick={refresh}>Actualizar estado</button>
          </span>
        </div>
        <div className="small muted" style={{ margin: "6px 0 12px" }}>
          Las claves se guardan en {config.configDir}/secrets.env con permisos solo para tu usuario. La interfaz nunca las muestra completas.
        </div>

        {tab === "models" && (
          <div className="form">
            <label className="full">
              <strong>Participantes por defecto</strong> <span className="muted small">(en orden; el sorteo puede reordenarlos en cada debate)</span>
            </label>
            <div className="full">
              <ParticipantsEditor config={config} list={models.participants} onChange={(l) => setModels({ ...models, participants: l })} statuses={statuses} />
            </div>
            <label>Consolidador</label>
            <ModelPicker config={config} value={models.consolidator} onChange={(s) => setModels({ ...models, consolidator: s })} statuses={statuses} />
            <label>Consolidador alterno</label>
            <ModelPicker config={config} value={models.consolidatorAlt} onChange={(s) => setModels({ ...models, consolidatorAlt: s })} statuses={statuses} />
            <label>Sustituto temporal</label>
            <ModelPicker config={config} value={models.substitute} onChange={(s) => setModels({ ...models, substitute: s })} statuses={statuses} />
            <label>Rondas por defecto</label>
            <input type="number" min={1} max={10} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} style={{ width: 80 }} />
            <label>Sustitución automática</label>
            <label className="kv">
              <input type="checkbox" checked={autoSub} onChange={(e) => setAutoSub(e.target.checked)} /> Si un modelo falla dos veces, el sustituto cubre ese turno
            </label>
            <label>Carpeta de debates</label>
            <input value={root} onChange={(e) => setRoot(e.target.value)} />
          </div>
        )}

        {tab === "providers" && (
          <div className="provs">
            {config.providers.map((p) => (
              <ProviderRow key={p.id} config={config} p={p} st={statuses?.find((s) => s.id === p.id)} onStatuses={setStatuses} />
            ))}
          </div>
        )}

        {error && <div className="errc small">{error}</div>}
        <div className="foot">
          <button onClick={onClose}>Cerrar</button>
          {tab === "models" && (
            <button className="primary" onClick={save} disabled={saving}>
              Guardar valores por defecto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
