import type { AdapterId, DebateState, ParticipantKey, TurnKind, TurnRecord } from "./types.js";
import { renderActa } from "./schema.js";

export const PLAN_FILE = "plan.md";
export const CANDIDATE_FILE = "plan.candidate.md";
export const BRIEF_FILE = "brief.md";
export const DECISIONS_FILE = "decisions.md";
export const DEBATE_FILE = "debate.md";
export const STATE_FILE = "debate.json";
export const INTERNAL_DIR = ".debate";

/** Marcadores del formato de entrega para adaptadores sin herramientas (APIs HTTP). */
export const INLINE_PLAN_MARKER = "===PLAN===";
export const INLINE_ACTA_MARKER = "===ACTA===";
export const INLINE_END_MARKER = "===FIN===";
/** Alias heredados. */
export const KIMI_PLAN_MARKER = INLINE_PLAN_MARKER;
export const KIMI_ACTA_MARKER = INLINE_ACTA_MARKER;
export const KIMI_END_MARKER = INLINE_END_MARKER;

/** Archivo de reglas que cada CLI lee automáticamente desde el directorio de trabajo. */
export const RULES_FILE: Record<AdapterId, string | null> = {
  claude: "CLAUDE.md",
  codex: "AGENTS.md",
  gemini: "GEMINI.md",
  anthropic: null,
  "openai-compat": null,
  replicate: null,
  kimi: null,
  fake: null,
};

/** Archivo de reglas del CLI, o null si el adaptador recibe las reglas en el prompt. */
export function rulesFileFor(adapter: AdapterId, _participant?: ParticipantKey | "consolidator"): string | null {
  return RULES_FILE[adapter] ?? null;
}

/** true si el adaptador no tiene herramientas y trabaja con el documento en línea. */
export function isInlineAdapter(adapter: AdapterId): boolean {
  return adapter === "anthropic" || adapter === "openai-compat" || adapter === "replicate" || adapter === "kimi";
}

/** Siguiente participante en el orden de palabra. */
export function nextInOrder(order: ParticipantKey[], p: ParticipantKey): ParticipantKey {
  const i = order.indexOf(p);
  return order[(i + 1) % order.length];
}

/** Compatibilidad: con dos participantes, el otro. */
export function other(p: ParticipantKey, order: ParticipantKey[] = ["A", "B"]): ParticipantKey {
  return nextInOrder(order, p);
}

function listLetters(keys: ParticipantKey[]): string {
  if (keys.length <= 1) return keys.join("");
  return `${keys.slice(0, -1).join(", ")} y ${keys[keys.length - 1]}`;
}

export function planTemplate(title: string): string {
  return `# ${title}

## 1. Objetivo y resultado esperado

## 2. Necesidades del usuario y criterios de éxito

## 3. Alcance incluido y excluido

## 4. Requisitos y restricciones

## 5. Alternativas evaluadas y decisiones justificadas

## 6. Arquitectura o estrategia de ejecución

## 7. Etapas, entregables y dependencias

## 8. Validación y criterios de aceptación

## 9. Riesgos, supuestos y medidas de respuesta

## 10. Preguntas y desacuerdos pendientes
`;
}

export const REQUIRED_HEADINGS = ["Objetivo", "Alcance", "Etapas", "Riesgos"];

/** Protocolo compartido: la parte fija de las reglas del debate. */
export function protocolText(p: {
  /** Participantes del debate, en orden de palabra. */
  participants: ParticipantKey[];
  rounds: number;
  /** Si se indica, el texto se dirige a ese participante; si no, es genérico (archivo de reglas compartido). */
  participant?: ParticipantKey;
  targetFile?: string;
}): string {
  const n = p.participants.length;
  const total = p.rounds * n;
  const target = p.targetFile ?? PLAN_FILE;
  const who = p.participant
    ? `Participas como Participante ${p.participant} en un proceso de planeación de proyectos junto con ${n === 2 ? `el Participante ${p.participants.find((x) => x !== p.participant)}` : `los participantes ${listLetters(p.participants.filter((x) => x !== p.participant))}`}, ${n === 2 ? "otro modelo frontera" : "otros modelos frontera"}.`
    : `Participas en un proceso de planeación de proyectos entre ${n} modelos frontera (participantes ${listLetters(p.participants)}). Tu letra se indica en el paquete de cada turno.`;
  const others = n === 2 ? "el otro participante" : "los demás participantes";
  return `# Reglas del debate de planeación

${who} El usuario es el moderador y espera un plan útil, viable y suficientemente concreto para ejecutarlo después. Tu responsabilidad es aportar criterio, detectar problemas y mejorar el documento compartido. No se trata de ganar el debate sino de que el plan salga lo mejor posible; el plan lo ejecutará una persona real y la calidad de tus decisiones determina si el proyecto sale bien.

Trabaja con rigor. Evalúa alternativas relevantes, explica sus costes y beneficios y conserva lo que ya funciona. Puedes coincidir con ${others}, complementar sus propuestas o refutarlas. Cada cambio sustantivo debe tener una razón vinculada a los objetivos y restricciones del usuario. No inventes objeciones ni cambios cosméticos para justificar tu turno; tampoco aceptes por cortesía: si alguien tiene razón, acéptalo sin defender tu propuesta por autoría, y si no la tiene, dilo con motivos. Un turno que acepta todo con argumentos, o que declara "sin cambios" con motivos, es un turno válido.

La fase inicial tiene ${total} intervenciones en rotación: ${p.rounds} de cada uno de los ${n} participantes. El orden se decidió al azar. Después, cada observación del usuario concede una respuesta a cada participante. Al cerrar, un modelo distinto consolidará el documento sin cambiar decisiones. La aplicación controla los turnos; al terminar tu intervención debes detenerte.

En cada turno recibirás un paquete con tu letra, tu objetivo específico, la versión vigente del plan, la petición original del usuario, sus decisiones y aclaraciones, y las intervenciones de ${others} desde tu último turno. Trabaja únicamente sobre esa versión.

Si abres el debate, construye el primer plan sobre la plantilla ya presente en \`${target}\` e identifica los supuestos. En los turnos siguientes evalúa las propuestas anteriores y modifica preferentemente las secciones necesarias; no reconstruyas todo sin justificarlo. El plan es un borrador que la aplicación validará y publicará. Conserva los encabezados de la plantilla.

Para cada cambio sustantivo indica el problema que resuelve, la modificación, su justificación y sus consecuencias. Distingue hechos comprobados, inferencias y preferencias. Si haces una afirmación técnica cambiante, verifica una fuente con las herramientas de consulta y búsqueda web habilitadas; si no puedes, márcala como pendiente. No inventes fuentes ni pruebas.

Mantén las decisiones del usuario. Si discrepas de una decisión previa, explica qué evidencia nueva o contradicción justifica reabrirla. No declares consenso sobre algo que ${others} aún no revisaron. Si falta un dato indispensable para decidir con responsabilidad, decláralo como pregunta bloqueante en el acta y detente; el usuario responderá y continuarás este mismo turno. Todo lo demás son supuestos razonables o preguntas no bloqueantes.

Limítate a planificar: no implementes el proyecto, no instales dependencias, no ejecutes cambios en el sistema ni crees otros archivos.

Al terminar entrega el acta en el formato JSON solicitado. Todas sus listas pueden ir vacías; la calidad de tu revisión se juzga por los argumentos, no por la cantidad de rechazos. En el acta, "postura_ajena" se refiere a la de quien discrepa contigo; nómbralo por su letra. Busca un plan proporcionado al problema: viabilidad, experiencia de uso, alcance, recursos, mantenimiento y criterios de aceptación, sin complejidad innecesaria. Todo en español.
`;
}

/** Anexo específico del CLI: qué herramientas puede usar para leer y editar. */
export function cliAnnex(adapter: AdapterId, role: "participant" | "consolidator", targetFile: string): string {
  switch (adapter) {
    case "claude":
      return `\n## Herramientas\n\nUsa Read, Glob y Grep para consultar el workspace y las carpetas de contexto, y WebSearch/WebFetch si están habilitadas. Usa Edit o Write únicamente sobre \`${targetFile}\`. No tienes shell.\n`;
    case "codex":
      return `\n## Herramientas\n\nUsa la shell únicamente para leer archivos del workspace y de las carpetas de contexto (\`cat\`, \`sed -n\`, \`ls\`) y para editar \`${targetFile}\` con \`apply_patch\`. No ejecutes nada más: ni instalaciones, ni compilaciones, ni scripts del proyecto.\n`;
    case "gemini":
      return `\n## Herramientas\n\nUsa las herramientas de lectura para consultar el workspace y las de edición únicamente sobre \`${targetFile}\`. No ejecutes comandos de shell.\n`;
    case "kimi":
    case "anthropic":
    case "openai-compat":
    case "replicate":
      return `\n## Formato de entrega\n\nNo editas archivos. Recibirás el plan completo en el mensaje y devolverás el documento completo modificado en el formato indicado.\n`;
    case "fake":
      return role === "consolidator" ? "\n## Simulado (consolidador)\n" : "\n## Simulado\n";
  }
}

export function consolidatorRules(adapter: AdapterId): string {
  return `# Reglas de consolidación

Eres el consolidador de un debate de planeación entre varios modelos de IA (participantes identificados por letra: A, B, C…). No participaste en el debate y no debates ahora.

Recibes la petición original y las aclaraciones del usuario, sus decisiones confirmadas, el plan aprobado y la transcripción completa del debate. No cambies ninguna decisión técnica ni del usuario. Reordena, elimina redundancias, unifica terminología, corrige inconsistencias evidentes entre secciones y conserva todos los encabezados de la plantilla. No reescribas frases por estilo: una frase que ya es clara se deja tal cual, para que el diff que revisará el usuario muestre solo cambios con motivo. Escribe al final una sección \`## Puntos sin consenso\` a partir de la transcripción, con la postura de cada participante involucrado en cada punto que quedó en disputa y los motivos de cada uno; no elijas un ganador ni conviertas en consenso lo que los demás participantes no revisaron. Si no hubo disputas, dilo en una línea.

Si al consolidar detectas una contradicción, un riesgo o una omisión nuevos, no los resuelvas en silencio dentro del plan: agrégalos en una sección final \`## Observaciones del consolidador pendientes de revisión\`, con la evidencia o el razonamiento breve. No inventes acuerdos, no elijas una tecnología disputada, no elimines restricciones ni añadas alcance como si estuviera aprobado.

Al terminar, responde con un informe breve de cambios: qué reorganizaste, qué unificaste y qué dejaste como observación pendiente. Tu resultado es un candidato que el usuario revisará contra el plan aprobado. Trabaja únicamente sobre \`${CANDIDATE_FILE}\`; no toques \`${PLAN_FILE}\` ni ningún otro archivo. Todo en español.
${cliAnnex(adapter, "consolidator", CANDIDATE_FILE)}`;
}

/** Archivo de reglas genérico (sin letra) para un CLI: lo comparten todos los participantes que usan ese CLI. */
export function rulesFileContent(adapter: AdapterId, participants: ParticipantKey[], rounds: number): string {
  return protocolText({ participants, rounds }) + cliAnnex(adapter, "participant", PLAN_FILE);
}

export function turnObjective(kind: TurnKind, position: number, total: number, cyclePosition?: number): string {
  if (kind === "cycle") {
    if (cyclePosition === 1) return "Responder a la observación del usuario: evaluarla, incorporar al plan lo que corresponda y explicar lo que no corresponda.";
    if (cyclePosition === total) return "Responder a la observación del usuario considerando las respuestas y cambios previos de este ciclo; cerrar el ciclo dejando el plan coherente.";
    return "Responder a la observación del usuario considerando las respuestas y cambios previos de este ciclo.";
  }
  if (position === 1) {
    return "Elaborar el primer plan sobre la plantilla. Explicitar supuestos y preguntas.";
  }
  if (position === total) {
    return "Cierre de fase: revisar la última intervención, pulir el documento, listar los desacuerdos pendientes y agrupar las preguntas para el usuario.";
  }
  if (position === 2) {
    return "Revisar el plan completo, justificar mejoras e incorporarlas. Declarar qué mantienes, qué cambias y qué rechazas.";
  }
  if (position === total - 1) {
    return "Revisar coherencia global, prioridades, riesgos y criterios de aceptación.";
  }
  return position % 2 === 1
    ? "Evaluar la revisión del otro participante: aceptar o refutar con motivos, ajustar y consolidar lo acordado."
    : "Resolver las objeciones abiertas y reforzar viabilidad, alcance y dependencias.";
}

export interface TurnPackageInput {
  state: DebateState;
  turn: TurnRecord;
  planCommit: string;
  brief: string;
  /** Intervenciones de los demás desde el último turno de este participante (con su diff). */
  othersSince: Array<{ turn: TurnRecord; diff?: string }>;
  observation?: string;
  blockingAnswer?: string;
  /** Para adaptadores sin archivo de reglas ni sesión: incluir el protocolo completo. */
  includeProtocol: boolean;
  /** Para adaptadores sin herramientas: incluir el plan completo. */
  planContent?: string;
}

/** Paquete del turno: la parte variable que recibe el participante en cada intervención. */
export function buildTurnPackage(i: TurnPackageInput): string {
  const { state, turn } = i;
  const lines: string[] = [];
  const order = state.order;
  if (i.includeProtocol) {
    lines.push(protocolText({ participants: order, participant: turn.participant, rounds: state.config.rounds }));
    lines.push("---\n");
  }
  const total = state.config.rounds * order.length;
  lines.push(`# Paquete del turno ${turn.number}`);
  lines.push("");
  lines.push(`- Eres el **Participante ${turn.participant}**. Participantes del debate, en orden de palabra: ${order.join(", ")}.`);
  if (turn.kind === "initial") {
    lines.push(`- Fase inicial: turno ${turn.number} de ${total}. Esta es tu intervención ${turn.position} de ${turn.positionTotal}.`);
    lines.push(`- Te quedan ${turn.positionTotal - turn.position} intervenciones después de esta en la fase inicial.`);
  } else {
    lines.push(`- Ciclo de observación ${(turn.cycleIndex ?? 0) + 1}: respuesta ${turn.position} de ${turn.positionTotal}. Turno global ${turn.number}.`);
  }
  lines.push(`- **Objetivo de este turno:** ${turn.objective}`);
  lines.push("");
  lines.push(roleComplement(turn));
  lines.push(`- Versión vigente del plan: commit \`${i.planCommit.slice(0, 12)}\` (archivo \`${PLAN_FILE}\`). Trabaja solo sobre esa versión.`);
  if (state.config.allowWeb) lines.push("- Búsqueda web e investigación: permitidas.");
  if (state.config.contextDirs.length) {
    lines.push(`- Carpetas de contexto en solo lectura: ${state.config.contextDirs.map((d) => `\`${d}\``).join(", ")}.`);
  }
  lines.push("");
  lines.push("## Petición original del usuario");
  lines.push("");
  lines.push(i.brief.trim());
  lines.push("");
  if (state.decisions.length) {
    lines.push("## Decisiones y restricciones del usuario (no se cambian por acuerdo entre participantes)");
    lines.push("");
    for (const d of state.decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (state.clarifications.length) {
    lines.push("## Aclaraciones del usuario a preguntas bloqueantes");
    lines.push("");
    for (const c of state.clarifications) lines.push(`- ${c}`);
    lines.push("");
  }
  if (turn.kind === "cycle" && i.observation) {
    lines.push("## Observación del usuario que abre este ciclo");
    lines.push("");
    lines.push(i.observation.trim());
    lines.push("");
  }
  if (i.othersSince.length) {
    const DIFF_BUDGET = 24000;
    let used = 0;
    lines.push(i.othersSince.length === 1 ? "## Intervención previa" : "## Intervenciones desde tu último turno");
    lines.push("");
    for (const { turn: lo, diff } of i.othersSince) {
      if (!lo.acta) continue;
      lines.push(`### Participante ${lo.participant} (turno ${lo.number})`);
      lines.push("");
      lines.push(renderActa(lo.acta));
      if (diff && diff.trim()) {
        const room = DIFF_BUDGET - used;
        if (room > 500) {
          const d = diff.length > room ? diff.slice(0, room) + "\n… (diff recortado; el plan vigente está completo)" : diff;
          used += d.length;
          lines.push("Diff de su turno sobre plan.md:");
          lines.push("");
          lines.push("```diff");
          lines.push(d.trimEnd());
          lines.push("```");
          lines.push("");
        }
      }
    }
  } else if (turn.number > 1) {
    lines.push("## Intervenciones previas");
    lines.push("");
    lines.push("_No hay actas previas disponibles._");
    lines.push("");
  }
  const open = collectOpenItems(state, turn.number);
  if (open.desacuerdos.length || open.preguntas.length) {
    lines.push("## Estado acumulado del debate");
    lines.push("");
    if (open.desacuerdos.length) {
      lines.push("Desacuerdos registrados hasta ahora:");
      for (const d of open.desacuerdos) lines.push(`- ${d}`);
      lines.push("");
    }
    if (open.preguntas.length) {
      lines.push("Preguntas abiertas para el usuario (no bloqueantes):");
      for (const q of open.preguntas) lines.push(`- ${q}`);
      lines.push("");
    }
  }
  if (i.blockingAnswer) {
    lines.push("## Respuesta del usuario a tu pregunta bloqueante");
    lines.push("");
    lines.push(i.blockingAnswer.trim());
    lines.push("");
    lines.push("Continúa este mismo turno con esa información.");
    lines.push("");
  }
  if (i.planContent !== undefined) {
    lines.push(`## Plan vigente completo (${PLAN_FILE})`);
    lines.push("");
    lines.push("```markdown");
    lines.push(i.planContent.trimEnd());
    lines.push("```");
    lines.push("");
  }
  lines.push("## Qué hacer ahora");
  lines.push("");
  if (i.planContent !== undefined) {
    lines.push(kimiOutputInstructions("participant"));
  } else {
    lines.push(`1. Lee \`${PLAN_FILE}\` y el material anterior.`);
    lines.push(`2. Cumple el objetivo del turno editando \`${PLAN_FILE}\` directamente (modifica, no reescribas).`);
    lines.push("3. Termina entregando el acta en el formato JSON solicitado. Sus listas pueden ir vacías.");
  }
  return lines.join("\n") + "\n";
}

/** Complemento por función del turno: apertura, revisión o respuesta a observación. */
export function roleComplement(turn: TurnRecord): string {
  if (turn.kind === "cycle") {
    const pos = `el ${turn.position}.º de ${turn.positionTotal} en responder`;
    return `**Tu función en este ciclo.** El usuario añadió una observación; tiene prioridad sobre las propuestas previas que contradiga. Este ciclo concede una intervención a cada participante y eres ${pos}. Actualiza los requisitos afectados, revisa sus consecuencias sobre el plan${turn.position > 1 ? " y responde también a las actas de quienes respondieron antes en este ciclo" : ""}. Conserva las decisiones no afectadas. No abras discusiones nuevas que la observación no toque.`;
  }
  if (turn.number === 1) {
    return "**Tu función: abrir el debate.** A partir de la petición y las restricciones, prepara una primera versión completa pero proporcionada: objetivos, alcance, requisitos, alternativas, estrategia o arquitectura, etapas, dependencias, riesgos y criterios de aceptación. Explicita los supuestos y deja identificadas las decisiones realmente abiertas. Ofrece una base revisable; no presentes tus preferencias como acuerdos de todos los participantes.";
  }
  return "**Tu función: revisar.** Comprueba primero si el plan vigente satisface la petición del usuario. Responde a las objeciones relevantes de las actas recientes y propón cambios aplicables ahora. Vincula cada acuerdo o rechazo a la propuesta correspondiente. No defiendas una decisión por ser tuya ni reabras un asunto sin una razón nueva. Si no cambias una sección, no la regeneres.";
}

function collectOpenItems(state: DebateState, beforeTurn: number): { desacuerdos: string[]; preguntas: string[] } {
  const desacuerdos: string[] = [];
  const preguntas: string[] = [];
  for (const t of state.turns) {
    if (t.number >= beforeTurn || !t.acta) continue;
    for (const d of t.acta.desacuerdos) desacuerdos.push(`(turno ${t.number}, ${t.participant}) ${d.tema}: ${d.postura_propia} / ${d.postura_ajena}`);
    for (const q of t.acta.preguntas_usuario) if (!q.bloqueante) preguntas.push(`(turno ${t.number}) ${q.pregunta}`);
  }
  return { desacuerdos: desacuerdos.slice(-12), preguntas: preguntas.slice(-12) };
}

/** Prompt corto para continuar un turno pausado por pregunta bloqueante (adaptadores con sesión). */
export function blockingAnswerPrompt(answer: string): string {
  return `## Respuesta del usuario a tu pregunta bloqueante\n\n${answer.trim()}\n\nContinúa este mismo turno con esa información: termina de editar \`${PLAN_FILE}\` y entrega el acta en el formato JSON solicitado.\n`;
}

export interface ConsolidationInput {
  brief: string;
  decisions: string[];
  clarifications: string[];
  planContent: string;
  debateContent: string;
  /** true para adaptadores sin herramientas (devuelven el documento completo). */
  inline: boolean;
}

export function consolidationPrompt(i: ConsolidationInput): string {
  const lines: string[] = [];
  lines.push("# Encargo de consolidación");
  lines.push("");
  if (i.inline) {
    lines.push(consolidatorRules("kimi"));
    lines.push("---");
    lines.push("");
  }
  lines.push("## Petición original del usuario");
  lines.push("");
  lines.push(i.brief.trim());
  lines.push("");
  if (i.decisions.length) {
    lines.push("## Decisiones confirmadas por el usuario (intocables)");
    lines.push("");
    for (const d of i.decisions) lines.push(`- ${d}`);
    lines.push("");
  }
  if (i.clarifications.length) {
    lines.push("## Aclaraciones del usuario");
    lines.push("");
    for (const c of i.clarifications) lines.push(`- ${c}`);
    lines.push("");
  }
  if (i.inline) {
    lines.push(`## Plan aprobado (${PLAN_FILE})`);
    lines.push("");
    lines.push("```markdown");
    lines.push(i.planContent.trimEnd());
    lines.push("```");
    lines.push("");
    lines.push(`## Transcripción del debate (${DEBATE_FILE})`);
    lines.push("");
    lines.push("```markdown");
    lines.push(i.debateContent.trimEnd());
    lines.push("```");
    lines.push("");
    lines.push("## Qué hacer ahora");
    lines.push("");
    lines.push(kimiOutputInstructions("consolidator"));
  } else {
    lines.push("## Qué hacer ahora");
    lines.push("");
    lines.push(`1. Lee \`${PLAN_FILE}\` (plan aprobado, solo lectura) y \`${DEBATE_FILE}\` (transcripción).`);
    lines.push(`2. \`${CANDIDATE_FILE}\` ya existe y es una copia exacta del plan aprobado. Edita únicamente ese archivo.`);
    lines.push("3. Conserva todas las decisiones y los encabezados. Agrega al final `## Puntos sin consenso`.");
    lines.push("4. Al terminar, responde con un resumen breve de lo que reorganizaste. No devuelvas el documento en el mensaje.");
  }
  return lines.join("\n") + "\n";
}

export function kimiOutputInstructions(role: "participant" | "consolidator"): string {
  if (role === "consolidator") {
    return [
      "Devuelve el documento consolidado completo, y nada más, con este formato exacto:",
      "",
      KIMI_PLAN_MARKER,
      "(aquí el Markdown completo del plan consolidado, incluida la sección `## Puntos sin consenso`)",
      KIMI_END_MARKER,
    ].join("\n");
  }
  return [
    "Devuelve el plan completo modificado y el acta, con este formato exacto y sin texto fuera de los marcadores:",
    "",
    KIMI_PLAN_MARKER,
    "(aquí el Markdown completo de plan.md ya modificado; conserva los encabezados)",
    KIMI_ACTA_MARKER,
    "(aquí el acta como un único objeto JSON válido conforme al schema indicado)",
    KIMI_END_MARKER,
  ].join("\n");
}

export function debateHeader(state: DebateState, brief: string): string {
  return `# Debate: ${state.title}

Creado: ${state.createdAt}. Participantes: ${state.order.join(", ")} (en orden de palabra). Rondas de la fase inicial: ${state.config.rounds}.

## Petición del usuario

${brief.trim()}

`;
}

export function debateTurnEntry(turn: TurnRecord, label: string, extra?: string): string {
  const lines: string[] = [];
  const kind = turn.kind === "initial" ? `fase inicial, intervención ${turn.position}/${turn.positionTotal}` : `ciclo ${(turn.cycleIndex ?? 0) + 1}, respuesta ${turn.position}/${turn.positionTotal}`;
  lines.push(`## Turno ${turn.number} · Participante ${turn.participant} (${kind})`);
  lines.push("");
  // Sin nombre de modelo: los participantes pueden leer este archivo y el debate es anónimo.
  void label;
  lines.push(`${turn.substitute ? `Cubierto por un sustituto temporal; causa: ${turn.substituteReason ?? "fallo del modelo original"}. ` : ""}${turn.commit ? `Revisión: \`${turn.commit.slice(0, 12)}\`.` : ""}`);
  if (turn.blockingAnswer) lines.push(`Pregunta bloqueante respondida por el usuario: ${turn.blockingAnswer}`);
  if (turn.reviewFlag) lines.push(`Marca para revisión: ${turn.reviewFlag}`);
  lines.push("");
  if (turn.acta) lines.push(renderActa(turn.acta));
  if (extra) lines.push(extra);
  lines.push("");
  return lines.join("\n");
}
