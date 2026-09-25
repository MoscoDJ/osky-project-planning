import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Snapshot } from "../api";

type Tab = "plan" | "diff" | "candidate" | "candidateDiff";

export function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <div className="muted">Sin diferencias.</div>;
  return (
    <div className="diff">
      {text.split("\n").map((line, i) => {
        let cls = "";
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) cls = "meta";
        else if (line.startsWith("@@")) cls = "hunk";
        else if (line.startsWith("+")) cls = "add";
        else if (line.startsWith("-")) cls = "del";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}

export function PlanPanel({ snap, busy }: { snap: Snapshot; busy: string | null }) {
  const s = snap.state;
  const published = useMemo(() => s.turns.filter((t) => t.status === "published"), [s.turns]);
  const [tab, setTab] = useState<Tab>("plan");
  const [diffTurn, setDiffTurn] = useState<number>(published[published.length - 1]?.number ?? 0);
  const [diff, setDiff] = useState("");
  const [candDiff, setCandDiff] = useState("");

  useEffect(() => {
    if (snap.candidate && tab === "plan") setTab("candidateDiff");
    if (!snap.candidate && (tab === "candidate" || tab === "candidateDiff")) setTab("plan");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.candidate]);

  useEffect(() => {
    if (published.length && !published.some((t) => t.number === diffTurn)) setDiffTurn(published[published.length - 1].number);
  }, [published, diffTurn]);

  useEffect(() => {
    if (tab === "diff" && diffTurn) void window.api.turnDiff(diffTurn).then(setDiff);
    if (tab === "candidateDiff") void window.api.candidateDiff().then(setCandDiff);
  }, [tab, diffTurn, snap.plan, snap.candidate]);

  const draft = busy?.startsWith("Turno") || s.turns.some((t) => t.status === "running");

  return (
    <div className="plan">
      <div className="panel-head">
        <h2>Plan</h2>
        <span className="tabs kv">
          <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
            plan.md
          </button>
          <button className={tab === "diff" ? "active" : ""} onClick={() => setTab("diff")} disabled={!published.length}>
            Diff por turno
          </button>
          {snap.candidate && (
            <>
              <button className={tab === "candidateDiff" ? "active" : ""} onClick={() => setTab("candidateDiff")}>
                Diff candidato
              </button>
              <button className={tab === "candidate" ? "active" : ""} onClick={() => setTab("candidate")}>
                Candidato
              </button>
            </>
          )}
        </span>
        {tab === "diff" && (
          <select value={diffTurn} onChange={(e) => setDiffTurn(Number(e.target.value))}>
            {published.map((t) => (
              <option key={t.number} value={t.number}>
                Turno {t.number} · {t.participant}
                {t.substitute ? ` (sustituto ${t.substitute})` : ""}
              </option>
            ))}
          </select>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {tab === "plan" && <span className={`badge ${draft ? "warn" : "ok"}`}>{draft ? "borrador en curso" : "versión publicada"}</span>}
        {snap.candidate && <span className="badge warn">candidato pendiente de tu revisión</span>}
      </div>
      <div className="panel-body">
        {tab === "plan" && (
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{snap.plan || "_El plan está vacío._"}</ReactMarkdown>
          </div>
        )}
        {tab === "diff" && <DiffView text={diff} />}
        {tab === "candidate" && (
          <div className="md">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{snap.candidate ?? ""}</ReactMarkdown>
          </div>
        )}
        {tab === "candidateDiff" && (
          <>
            {s.candidate?.report && (
              <div className="next-action">
                <strong>Informe del consolidador ({s.candidate.by.label}).</strong>
                <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{s.candidate.report}</div>
              </div>
            )}
            <DiffView text={candDiff} />
          </>
        )}
      </div>
    </div>
  );
}
