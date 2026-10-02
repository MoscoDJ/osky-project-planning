import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../api";
import type { Acta, TurnRecord } from "../../../src/core/types";
import type { StreamState } from "../App";

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "pendiente", cls: "" },
  running: { label: "en curso", cls: "busy" },
  paused_blocking: { label: "pregunta bloqueante", cls: "warn" },
  published: { label: "publicado", cls: "ok" },
  failed: { label: "fallido", cls: "err" },
  skipped: { label: "saltado", cls: "warn" },
};

function ActaView({ acta }: { acta: Acta }) {
  return (
    <div className="acta">
      <p>
        <strong>Resumen.</strong> {acta.resumen}
      </p>
      <p>
        <strong>Evaluación.</strong> {acta.evaluacion}
      </p>
      {acta.sin_cambios && <p className="muted">Sin cambios en el plan en este turno.</p>}
      {acta.cambios.length > 0 && (
        <>
          <h4>Cambios</h4>
          <ul>
            {acta.cambios.map((c, i) => (
              <li key={i}>
                <strong>{c.seccion}:</strong> {c.que}
                <div className="sub">Por qué: {c.por_que}</div>
                <div className="sub">Consecuencias: {c.consecuencias}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {acta.acuerdos.length > 0 && (
        <>
          <h4>Acuerdos</h4>
          <ul>
            {acta.acuerdos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}
      {acta.rechazos.length > 0 && (
        <>
          <h4>Rechazos</h4>
          <ul>
            {acta.rechazos.map((r, i) => (
              <li key={i}>
                {r.propuesta} <span className="sub">— {r.motivo}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {acta.desacuerdos.length > 0 && (
        <>
          <h4>Desacuerdos pendientes</h4>
          <ul>
            {acta.desacuerdos.map((d, i) => (
              <li key={i}>
                <strong>{d.tema}.</strong> <span className="sub">Propia: {d.postura_propia}. Ajena: {d.postura_ajena}.</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {acta.riesgos.length > 0 && (
        <>
          <h4>Riesgos</h4>
          <ul>
            {acta.riesgos.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {acta.preguntas_usuario.length > 0 && (
        <>
          <h4>Preguntas para el usuario</h4>
          <ul>
            {acta.preguntas_usuario.map((p, i) => (
              <li key={i}>
                {p.bloqueante && <span className="badge warn">bloqueante</span>} {p.pregunta}
              </li>
            ))}
          </ul>
        </>
      )}
      {acta.fuentes?.length > 0 && (
        <>
          <h4>Fuentes</h4>
          <ul>
            {acta.fuentes.map((f, i) => (
              <li key={i} className="sub">
                {f}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TurnCard({ turn, label, stream, active }: { turn: TurnRecord; label: string; stream: StreamState | null; active: boolean }) {
  const [open, setOpen] = useState(active || turn.status === "failed" || turn.status === "paused_blocking");
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  const st = STATUS[turn.status] ?? { label: turn.status, cls: "" };
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [stream]);
  const showStream = stream && stream.turn === turn.number && (active || turn.status !== "published");
  return (
    <div className={`turn ${active ? "active" : ""}`}>
      <div className="head" onClick={() => setOpen((o) => !o)}>
        <span className="num">#{turn.number}</span>
        <span className={`p${turn.participant}`}>Participante {turn.participant}</span>
        <span className="muted">{label}</span>
        {turn.substitute && <span className="badge warn">sustituto {turn.substitute}</span>}
        <span className={`badge ${st.cls}`}>{st.label}</span>
        {turn.kind === "cycle" && <span className="badge">ciclo {(turn.cycleIndex ?? 0) + 1}</span>}
        {turn.identity && turn.identity !== "confirmed" && <span className="badge warn">identidad {turn.identity}</span>}
        {turn.reviewFlag && <span className="badge warn">revisar</span>}
        {turn.attempts.length > 1 && <span className="badge">{turn.attempts.length} intentos</span>}
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted small">{open ? "▾" : "▸"}</span>
      </div>
      {open && (
        <div className="body">
          <div className="obj">{turn.objective}</div>
          {turn.reviewFlag && <div className="badge warn">{turn.reviewFlag}</div>}
          {turn.error && turn.status === "failed" && <div className="badge err" style={{ whiteSpace: "normal" }}>{turn.error}</div>}
          {turn.blockingAnswer && (
            <div className="obs">
              <strong>Respuesta del usuario:</strong> {turn.blockingAnswer}
            </div>
          )}
          {showStream && (
            <div className="stream" ref={streamRef}>
              {stream!.lines.map((l, i) => (
                <div key={i} className={l.kind === "tool" ? "tool" : l.kind === "text" ? "" : "muted"}>
                  {l.kind === "tool" ? `⚙ ${l.text}` : l.kind === "status" ? `· ${l.text}` : l.text}
                </div>
              ))}
            </div>
          )}
          {turn.acta && <ActaView acta={turn.acta} />}
          {turn.costEstimateUsd !== undefined && (
            <div className="small muted">Costo estimado por el CLI (informativo): {turn.costEstimateUsd.toFixed(2)} USD</div>
          )}
        </div>
      )}
    </div>
  );
}

export function DebatePanel({ snap, stream, busy }: { snap: Snapshot; stream: StreamState | null; busy: string | null }) {
  const s = snap.state;
  const label = (t: TurnRecord) => (t.substitute ? s.config.substitute.label : s.participants[t.participant].spec.label);
  const activeNumber = s.turns.find((t) => t.status === "running")?.number ?? (busy?.startsWith("Turno") ? stream?.turn : undefined);
  const items: Array<{ kind: "turn"; turn: TurnRecord } | { kind: "obs"; index: number; text: string }> = [];
  for (const t of s.turns) {
    if (t.kind === "cycle" && t.position === 1 && t.cycleIndex !== undefined) {
      items.push({ kind: "obs", index: t.cycleIndex, text: s.cycles[t.cycleIndex]?.observation ?? "" });
    }
    items.push({ kind: "turn", turn: t });
  }
  return (
    <div className="debate">
      <div className="panel-head">
        <h2>Debate</h2>
        <span className="small muted">
          Orden {(s.order ?? [s.opener]).join(" → ")} · {s.config.rounds} rondas · web {s.config.allowWeb ? "sí" : "no"} · ciclos{" "}
          {s.config.cycleOrder ?? "global"}
        </span>
      </div>
      <div className="panel-body">
        <div className="next-action">
          <strong>Siguiente acción.</strong> {s.nextAction === "next" ? "Ejecutar el siguiente turno." : s.nextAction}
        </div>
        {s.decisions.length > 0 && (
          <div className="brief">
            <strong>Decisiones del usuario</strong>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {s.decisions.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
        )}
        {items.map((it) =>
          it.kind === "obs" ? (
            <div className="obs" key={`obs-${it.index}`}>
              <strong>Observación del usuario (ciclo {it.index + 1}).</strong> {it.text}
            </div>
          ) : (
            <TurnCard key={it.turn.id} turn={it.turn} label={label(it.turn)} stream={stream} active={activeNumber === it.turn.number} />
          ),
        )}
        {s.consolidationHistory.length > 0 && (
          <div className="brief">
            <strong>Consolidaciones</strong>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {s.consolidationHistory.map((c, i) => (
                <li key={i}>
                  {c.by.label}: {c.status}
                  {c.error ? ` — ${c.error}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
