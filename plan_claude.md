# Osky Project Planning — Sistema de debate entre dos IAs (propuesta de Claude)

Estado: borrador v0.3 (2026-09-23). Solo plan, sin código.
Cambios respecto a v0.2: prueba de fase 0 ejecutada con cuota real (Claude y Codex
aprobados, Gemini pendiente de login); decisiones del usuario incorporadas en la
sección 10; Gemini CLI como consolidador.

## 1. Objetivo

Una app de escritorio para Kubuntu donde dos modelos frontera debaten por turnos cómo
planear un proyecto que el usuario describe en un prompt. El resultado es un único
archivo `PLAN.md` que ambos van editando, más una transcripción del debate. Ambos
modelos corren con la sesión de su plan Pro (login), nunca por API.

Participantes:

| Alias | Modelo | Vía | Esfuerzo |
|---|---|---|---|
| Participante A | Claude Fable 5.1 | Claude Code CLI 2.1.280 (`claude -p`), login Pro | high |
| Participante B | GPT-6 Astra | Codex CLI 0.156.1 (`codex exec`), login ChatGPT | high |
| Consolidador | Gemini 3.1 Pro (`gemini-3.1-pro-preview`, vía `-m`) | Gemini CLI 0.60.0 (`gemini -p`), clave de API en `~/.gemini/.env` | — |

Quién es A y quién es B se sortea en cada debate. Los modelos solo conocen a su
interlocutor como "Participante A/B"; el usuario sí ve en la interfaz qué modelo es
cada uno. El consolidador no debate: entra una sola vez al cerrar (ver 4.1).

## 2. Decisiones clave

### 2.1 Cómo se conecta con cada IA sin API

La única forma soportada de usar la suscripción de forma programática es **ejecutar el
CLI oficial como subproceso** en modo no interactivo. Ni el Agent SDK ni la API aceptan
credenciales de suscripción, y las apps de escritorio o web no se pueden automatizar.
Por eso el corazón del sistema es un orquestador que lanza `claude` y `codex`, les pasa
el prompt del turno y lee su salida JSONL en streaming. No se extraen cookies ni tokens;
cada CLI gestiona su propio login.

**Claude Code** (verificado en la máquina, v2.1.280, login Pro):

- `claude -p` para modo headless.
- `--model claude-fable-5-1 --effort high`.
- `--output-format stream-json --verbose --include-partial-messages` para eventos JSONL
  en tiempo real (texto, uso de herramientas, resultado final).
- `--session-id <uuid>` en el primer turno y `--resume <uuid>` en los siguientes, para
  que el modelo conserve la memoria del debate entre turnos.
- `--allowedTools` / `--disallowedTools` / `--tools` para que solo pueda leer el
  workspace y editar `PLAN.md`. Sin `Bash`.
- `--append-system-prompt-file` para las reglas del debate. `CLAUDE.md` del workspace
  las repite.
- `--json-schema` para que el acta del turno salga estructurada (ver 4.3).
- `--add-dir` si el debate debe poder leer un repo existente como contexto.

**Codex CLI** (verificado en la máquina, v0.156.1, `codex login status` = "Logged in
using ChatGPT"):

- `~/.codex/config.toml` ya fija `model = "gpt-6-astra"` y
  `model_reasoning_effort = "high"`. El orquestador lo pasa explícito de todos modos:
  `-m gpt-6-astra -c model_reasoning_effort="high"`.
- `codex exec "<prompt>"` para modo headless; `--json` para eventos JSONL.
- `codex exec resume <session_id> "<prompt>"` para continuar la misma sesión. El id se
  toma del primer evento JSONL del turno de apertura.
- `-C <workspace>` y `-s workspace-write` para que solo pueda escribir dentro del
  workspace del debate. `--skip-git-repo-check` no hace falta porque el workspace es
  repo git.
- `--output-schema <archivo>` para el acta estructurada; `-o <archivo>` guarda el
  último mensaje como respaldo.
- Reglas del debate en `AGENTS.md` del workspace (Codex lo lee automáticamente).
- El App Server de Codex existe pero está marcado experimental; `codex exec` es la
  ruta estable.

**Gemini CLI** (instalado, v0.60.0; verificado con `gemini --help`):

- `gemini -p "<prompt>"` para modo headless; `-o stream-json` o `-o json` para la
  salida; `-r <id>` para reanudar; `-m` para el modelo.
- `--approval-mode plan` (solo lectura) o `auto_edit` (permite editar archivos) para
  el turno de consolidación; `--include-directories` para la carpeta de contexto.
- `--skip-trust` es obligatorio en headless: en una carpeta no confiable Gemini no
  carga `~/.gemini/.env`, y sin él falla con "must specify GEMINI_API_KEY".
- Autenticación: es el único de los tres que va **por API**, decisión del usuario.
  `~/.gemini/settings.json` fija `selectedType: gemini-api-key` y la clave vive en
  `~/.gemini/.env`. El orquestador no toca la clave; la carga el propio CLI.
- Prueba de consolidación hecha (23-sep-2026): con `--approval-mode auto_edit` leyó
  `PLAN.md` y agregó una sección "Puntos sin consenso" con tres objeciones bien
  argumentadas, sin cambiar decisiones. `-o json` devuelve `session_id`, `response` y
  `stats` con los modelos usados.
- Modelo elegido por el usuario: `gemini-3.1-pro-preview`, verificado con una llamada
  real el 23-sep-2026. El orquestador lo pasa siempre con `-m`; el default del CLI
  (`gemini-3.5-flash`) queda solo como respaldo si el Pro no está disponible.

**Resultados de la prueba de fase 0 (23-sep-2026, cuota real, workspace de prueba con
un proyecto pequeño):**

| Prueba | Claude | Codex |
|---|---|---|
| Modelo servido en High | `claude-fable-5-1` confirmado en `modelUsage` | `gpt-6-astra` aceptado, 271 tokens de razonamiento reportados |
| Streaming JSONL | OK (`assistant`, `tool_use`, `result`, `rate_limit_event`) | OK (`thread.started`, `item.*`, `turn.completed` con uso de tokens) |
| Acta con JSON Schema | OK, `structured_output` en el evento `result` | OK, `-o` deja el JSON válido en archivo |
| Edita sin reescribir | OK, plan inicial de 24 líneas | OK, diff de 10+/9- sobre el plan de Claude, estructura intacta |
| Acta con rechazos y acuerdos | OK | OK, 2 rechazos y 3 acuerdos justificados |
| Reanudar sesión | OK, mismo `session_id`, recuerda su turno 1 | OK, mismo `thread_id`, recuerda sus rechazos |
| Restricción de herramientas | OK, sin Bash ni web | OK, sandbox `workspace-write` sobre el workspace |
| Duración turno de apertura | 28 s | similar |

Hallazgos que cambian el diseño:

1. **Codex no tiene herramienta de lectura separada**: lee archivos con comandos de
   shell. Con la regla "prohibido ejecutar comandos" se negó a leer `PLAN.md` y lo
   dijo de forma honesta. Las reglas deben ser **por CLI**: en Codex la shell se
   permite solo para leer y para `apply_patch` sobre `PLAN.md`; en Claude se quita
   `Bash` y se dejan `Read/Edit/Write`.
2. **Flags variádicos de Claude** (`--allowedTools`, `--disallowedTools`, `--tools`)
   se tragan el prompt posicional. El orquestador pasa siempre el prompt por stdin.
3. **`codex exec resume` no acepta `-C` ni `-s`**: hereda el directorio de la sesión
   y el sandbox se cambia con `-c sandbox_mode="read-only"`. Acepta `--json`,
   `--output-schema`, `-o` y `-m`.
4. **Claude anidado**: al lanzar `claude -p` desde otro proceso de Claude Code hay que
   limpiar `CLAUDECODE` y `CLAUDE_CODE_ENTRYPOINT` del entorno. Desde Electron no
   aplica, pero el adaptador lo hace igual por seguridad.
5. **Codex avisa "Reading additional input from stdin"** cuando stdin no es TTY. Es
   inofensivo; se redirige stdin desde `/dev/null`.
6. **Consumo**: Claude reporta `total_cost_usd` informativo (0.62 USD equivalente en
   el turno de apertura) y eventos `rate_limit_event` con el estado de la ventana;
   Codex reporta tokens por turno. Ambos alimentan el indicador de consumo del UI.
7. **Búsqueda web**: en Claude son las herramientas `WebSearch`/`WebFetch`; en Codex
   es el flag `--search`; en Gemini viene incluida.

### 2.2 "Modo planning" no es el plan mode del CLI

El plan mode de Claude Code (`--permission-mode plan`) y el sandbox `read-only` de
Codex bloquean toda escritura de archivos, incluido `PLAN.md`. Lo que se quiere es un
**rol**: planear, no construir. Se logra con dos cosas:

1. Reglas explícitas en el prompt: nada de código, nada de ejecutar comandos, el único
   entregable es `PLAN.md`.
2. Restricción de herramientas: lectura libre, escritura solo en `PLAN.md`, sin shell.
   En Claude con `--allowedTools`; en Codex con `-s workspace-write` sobre un workspace
   que solo contiene Markdown.

Alternativa de respaldo, también verificada como viable: correr ambos en modo de solo
lectura (`--permission-mode plan` / `-s read-only`), recibir la propuesta de cambios
por sección en JSON (`--json-schema` / `--output-schema`) y que el orquestador sea el
único que escribe `PLAN.md`. Da más control pero pierde el "editar, no reescribir"
natural del modelo. Se decide en la etapa 0 con una prueba de cada variante.

### 2.3 Stack: Electron + TypeScript, no Flutter

Recomendación: **Electron + TypeScript + React (Vite)**, con el orquestador como paquete
Node independiente que también se usa desde terminal.

Por qué no Flutter para este caso:

- Lo pesado de la app es renderizar Markdown en vivo y mostrar diffs. Ahí el ecosistema
  web es muy superior (react-markdown, Monaco diff, shiki). En Flutter el paquete
  oficial `flutter_markdown` fue descontinuado y no hay visor de diffs maduro.
- Los dos CLIs son programas Node. Un orquestador Node los lanza con `child_process` y
  consume su JSONL sin puente adicional. En Flutter habría que construir ese puente
  Dart↔proceso de todos modos.
- Un solo lenguaje en todo el proyecto.

Tauri 2 sería la opción ligera, pero obligaría a escribir el orquestador en Rust o como
sidecar, y webkit2gtk en Linux tiene rarezas de render. Queda como alternativa si el
peso de Electron molesta. Flutter es viable si prefieres Dart; solo costaría más en la
parte visual.

## 3. Arquitectura

```
┌──────────────────────── Electron (renderer, React) ────────────────────────┐
│  PLAN.md en vivo (render / diff)  │  Transcripción + streaming del turno    │
│  Barra de turno y controles       │  Caja de texto del usuario              │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │ IPC (eventos)
┌────────────────────────────────────┴───────────────────────────────────────┐
│  debate-core (Node/TS)                                                      │
│  • Máquina de estados del debate      • Generador de reglas (CLAUDE/AGENTS) │
│  • Adaptadores: ClaudeAdapter, CodexAdapter, FakeAdapter (pruebas)          │
│  • Persistencia: debate.json + git commit por turno                         │
│  • Watcher de PLAN.md (chokidar) → eventos al UI                            │
└──────────┬──────────────────────────────────────────────┬──────────────────┘
           │ spawn                                        │ spawn
     claude -p --resume …                      codex exec resume … --json
```

Interfaz común de adaptador:

- `startTurn(prompt, opts) → stream de eventos` (`text`, `tool_use`, `done`, `error`)
- `sessionId` persistente por participante y por debate
- `cancel()` y timeout configurable

`debate-core` expone también un CLI mínimo (`debate new`, `debate next`,
`debate say "..."`, `debate close`) para probar todo el ciclo antes de tener UI.

## 4. Flujo del debate

### 4.1 Máquina de estados

```
SETUP ─▶ TURNO 1 (A abre) ─▶ TURNO 2 (B revisa) ─▶ … ─▶ TURNO 2N ─▶ ESPERA_USUARIO
                                                                          │
              ┌───────────────────────────────────────────────────────────┘
              ▼
   Usuario escribe observación ─▶ réplica 1 ─▶ réplica 2 ─▶ ESPERA_USUARIO  (bucle)
              │
              └─ Usuario cierra ─▶ CONSOLIDACIÓN (opcional) ─▶ CERRADO
```

- `N` = interacciones por participante en la fase principal. Default 3 (6 turnos).
- SETUP: prompt del usuario, sorteo de quién abre (se guarda en `debate.json` para que
  reiniciar no lo altere), creación del workspace, `git init`, generación de
  `CLAUDE.md` / `AGENTS.md`, `PLAN.md` con plantilla vacía.
- Turno 1: el que abre redacta el plan inicial en `PLAN.md`.
- Turno 2: el otro lee, critica, **modifica directamente** `PLAN.md` y argumenta.
- Turnos 3 a 2N: réplicas alternadas. Cada uno puede replicar, aceptar, complementar.
- ESPERA_USUARIO: la caja de texto se habilita. Cada observación del usuario da derecho
  a **una** respuesta por participante. Empieza el que no habló último.
- CONSOLIDACIÓN: un turno final a cargo de un tercer modelo, Gemini vía Gemini CLI,
  que no participó en el debate. Recibe `PLAN.md` y `DEBATE.md`, deja el plan limpio
  sin cambiar decisiones y agrega una sección "Puntos sin consenso" con las posturas
  de A y B. Corre con `--approval-mode auto_edit` sobre el workspace (solo Markdown).
  Configurable: si Gemini no está disponible, lo hace el participante que no editó
  último.
- Después de cada turno: `git commit -m "Turno k · Participante X"`. El diff entre
  commits es lo que muestra el UI como "qué cambió en este turno".
- Un turno que falla (red, cuota, timeout) no cuenta como intervención. Se conserva el
  borrador y el usuario decide: repetir o saltar.

### 4.2 Workspace por debate

```
~/debates/2026-09-23-sistema-debate/
  PLAN.md        # única fuente de verdad del plan
  DEBATE.md      # transcripción: prompt inicial, acta de cada turno, observaciones
  CLAUDE.md      # reglas del debate para Claude (generado)
  AGENTS.md      # mismas reglas para Codex (generado)
  debate.json    # estado: participantes, session ids, turno actual, fase, config
  .git/
```

El workspace solo contiene Markdown, así que aunque un modelo intente salirse del rol
no hay nada que ejecutar ni romper.

### 4.3 Contrato de salida por turno (acta)

Además de editar `PLAN.md`, cada turno devuelve un acta estructurada con el mismo JSON
Schema en ambos CLIs (`--json-schema` en Claude, `--output-schema` en Codex). El
orquestador la agrega a `DEBATE.md` y la muestra en el UI:

- `resumen`: qué hizo en el turno, en 3 a 5 líneas.
- `cambios`: lista de {sección, qué cambió, por qué}.
- `rechazos`: lo que propuso el oponente y no aceptó, con motivo.
- `acuerdos`: lo que sí aceptó del oponente.
- `preguntas_usuario`: dudas que solo el usuario puede resolver.

Esto obliga a que "aplaudir" venga con sustancia y hace legible el debate sin leer todo
el diff.

## 5. Reglas del debate (esqueleto del prompt inicial)

Se genera en español y se entrega como system prompt adicional y como `CLAUDE.md` /
`AGENTS.md`. Secciones:

1. **Contexto**: "Participas en un debate de planeación de proyectos entre dos IAs. Tu
   interlocutor es otro modelo frontera. El moderador es el usuario."
2. **Objetivo**: producir el mejor plan posible para el proyecto descrito. No se trata
   de ganar sino de que el plan salga lo mejor posible. Se valora la crítica concreta y
   también reconocer cuando el otro tiene razón.
3. **Formato**: N turnos por participante, alternados. Quién abre, qué se espera en el
   turno de apertura y en los de réplica. Después, rondas de una respuesta por
   observación del usuario. La aplicación controla los turnos; al terminar tu
   intervención te detienes.
4. **Alcance**: solo planear. Prohibido escribir código, ejecutar comandos o crear
   otros archivos. El único entregable es `PLAN.md`.
5. **Cómo editar**: modificar, no reescribir. Conservar la estructura salvo razón
   fuerte. Cada cambio se refleja en el acta. Reescrituras totales solo justificadas.
6. **Cómo debatir**: argumentos concretos con motivos técnicos; señalar riesgos, costos
   y alternativas; nada de halagos vacíos; si no cambias nada, explica por qué el plan
   ya está bien. Cada réplica debe declarar qué mantiene, qué cambia y qué rechaza. Las
   restricciones del usuario no se cambian por acuerdo entre las IAs. No se declara
   consenso sobre algo que el otro aún no revisó.
7. **Salida del turno**: el acta con el esquema de 4.3.
8. **Motivación**: el plan lo va a ejecutar una persona real; la calidad de tus
   decisiones determina si el proyecto sale bien.

## 6. Interfaz

Una ventana, tres zonas:

- **Izquierda: PLAN.md en vivo.** Render Markdown que se actualiza al detectar cambios
  en disco. Toggle "Ver diff del turno" para comparar contra el commit anterior.
- **Derecha: debate.** Transcripción por turnos con el acta de cada uno. El turno activo
  muestra el texto en streaming y un indicador de actividad ("Participante B está
  editando PLAN.md…").
- **Abajo: caja del usuario.** Solo habilitada en SETUP y en ESPERA_USUARIO.
- **Barra superior:** turno actual (p. ej. 4/6), quién habla, estado. Botones: Iniciar,
  Pausar, Repetir turno, Saltar turno, Cerrar plan, Exportar.
- **Panel lateral:** debates anteriores, cada uno reabrible.
- **Ajustes:** ids de modelo, esfuerzo, N, timeout por turno, anonimizar participantes,
  carpeta de contexto opcional, quién consolida.

## 7. Fases de desarrollo

**Fase 0 · Validar el concepto a mano. Hecha (23-sep-2026).**
Se corrió un debate de dos turnos con cuota real: apertura con Claude, revisión con
Codex, reanudación de sesión en ambos y consolidación con Gemini por API. Todo pasó;
los hallazgos están en 2.1. El diseño queda confirmado para arrancar la fase 1.

**Fase 1 · debate-core + CLI.**
Adaptadores Claude y Codex, FakeAdapter (CLI falso que simula turnos para probar sin
gastar cuota), máquina de estados, generador de reglas, persistencia en `debate.json`,
commit por turno, parser de JSONL de cada CLI. Todo el ciclo completo funciona desde
terminal.

**Fase 2 · UI Electron.**
Render en vivo de `PLAN.md`, diff por turno, transcripción con streaming, caja de
usuario, controles de turno, historial de debates, ajustes.

**Fase 3 · Robustez.**
Timeouts y reintento de turno, mensajes claros cuando un plan llega al límite de uso,
recuperación si falla `resume` (reinyectar transcripción), exportar `PLAN.md` +
`DEBATE.md`, empaquetado (.deb o AppImage), prueba en Kubuntu con Wayland y X11.

**Fase 4 · Extras (opcionales).**
Tercer modelo como juez, plantillas de prompt, carpeta de contexto de solo lectura,
métricas del debate (cuánto cambió cada turno).

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Consumo de cuota: 6+ turnos a esfuerzo alto por debate, con ventanas de 5 h; Fable puede consumir créditos adicionales según el plan | Pausar/reanudar, N configurable, FakeAdapter para desarrollo, aviso de límite, medir consumo en fase 0 |
| Los CLIs cambian flags o formato JSONL | Los adaptadores aíslan cada CLI; pruebas de humo por versión |
| Un modelo reescribe todo en vez de editar | Regla explícita + el UI muestra el % del archivo cambiado; el usuario puede repetir turno |
| Un modelo se sale del rol e intenta programar | Restricción de herramientas y workspace solo con Markdown |
| `resume` falla o el contexto crece demasiado | Respaldo: turno sin sesión con la transcripción completa inyectada |
| Sandbox de Codex en Linux requiere bubblewrap/landlock | Verificar en fase 0 |
| La cuenta no sirve `gpt-6-astra` en High aunque esté en config | Verificar en fase 0 con una llamada real; no sustituir modelo en silencio |
| Sesgo de complacencia: los modelos se dan la razón demasiado rápido | Acta con `rechazos` obligatorio, regla "declara qué mantienes, cambias y rechazas" |
| Dos agentes editando el mismo archivo fuera de turno | Los turnos son estrictamente secuenciales; el orquestador bloquea el siguiente hasta el commit del anterior |

## 9. Sugerencias

1. **Anonimizar a los participantes** ("Participante A/B") en vez de decir Claude y
   GPT. Reduce sesgo de marca y hace que los argumentos pesen por sí mismos. Opción
   configurable.
2. **Turno de consolidación al cerrar.** Después de varias rondas el plan acumula
   parches. Un último turno para dejarlo limpio y listar los puntos sin consenso vale
   mucho. Puede hacerlo el que no editó último, o alternarse entre debates.
3. **Separar plan y debate.** `PLAN.md` queda limpio; toda la argumentación va a
   `DEBATE.md`. Al final te llevas el plan sin ruido.
4. **Git por turno.** Casi gratis y da el diff por turno, historial y la posibilidad de
   "revertir al turno 3".
5. **Carpeta de contexto opcional.** Si el proyecto a planear ya existe, montar el repo
   en solo lectura para que ambos planeen sobre lo real.
6. **Búsqueda web permitida** durante el debate (ambos CLIs la tienen). Para planear
   suele ayudar; se puede apagar por debate.
7. **N y roles configurables** por debate, con 3 como default.

## 10. Decisiones tomadas (23-sep-2026)

| Tema | Decisión |
|---|---|
| Acceso | Claude Code con login Pro y Codex CLI con login ChatGPT, sin API. Gemini es el único que va por API, con clave en `~/.gemini/.env`. Los tres verificados con llamadas reales |
| Anonimato | Los modelos se ven como "Participante A/B". El usuario ve los nombres reales en la interfaz |
| Contexto de repo | Opcional por debate. La mayoría serán proyectos nuevos; si es mejorar uno existente, se monta la carpeta en solo lectura (`--add-dir` en Claude y Codex, `--include-directories` en Gemini) |
| Consolidación | Gemini vía Gemini CLI, un solo turno al cerrar. Respaldo: el participante que no editó último |
| Búsqueda web | Permitida, incluida la investigación. `WebSearch`/`WebFetch` en Claude, `--search` en Codex |
| Idioma | Todo en español: reglas, actas, plan y transcripción |
| Stack | Electron + TypeScript + React, orquestador Node independiente |
| Prueba de fase 0 | Aprobada y ejecutada |

## 11. Pendientes

1. Arrancar la fase 1 (debate-core + CLI) con los tres adaptadores ya calibrados por
   los hallazgos de 2.1. No queda ninguna verificación previa pendiente.
