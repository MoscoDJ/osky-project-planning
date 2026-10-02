# Sistema de debate para planeación de proyectos — propuesta fusionada (Claude)

Fecha: 23 de septiembre de 2026. Estado: v1.1, construida a partir de `plan_gpt.md` y
`plan_claude.md`, con los ajustes del usuario sobre consolidación y acta (sección 15).
Contiene solo planificación; no implementa nada.

Qué toma de cada propuesta:

- **De GPT:** la tabla de rotación con objetivo por turno, el protocolo compartido y el
  paquete de información por turno, la verificación de identidad del modelo en cada
  mensaje, el motor como único publicador de la versión oficial, la protección contra
  versiones obsoletas y ediciones externas, la plantilla del plan generado, los criterios
  de aceptación, el inventario del equipo y la detección del PATH desde KDE.
- **De Claude:** los flags y hallazgos verificados de los tres CLIs, el acta de turno con
  JSON Schema, la edición directa del borrador con las herramientas nativas del modelo,
  git como historial de revisiones, el anonimato de participantes, Gemini como
  consolidador por API, el adaptador falso para desarrollar sin cuota, y el motor
  utilizable desde terminal antes de tener interfaz.
- **Donde se contradicen**, la sección 14 explica qué se eligió y por qué.

## 1. Objetivo y decisiones confirmadas

Aplicación de escritorio para Kubuntu donde el usuario describe un proyecto y dos
participantes construyen y revisan un mismo plan por turnos. El resultado es `plan.md`
más un historial legible de quién cambió qué y por qué. El usuario observa, corrige y
decide cuándo el plan está terminado.

| Tema | Decisión del usuario |
|---|---|
| Participantes | Claude Fable 5.1 (High) y GPT-6 Astra (High), ambos en rol de planificación |
| Acceso | Claude Code con login Claude (suscripción Max 20x detectada) y Codex CLI con login ChatGPT Pro. Sin API |
| Consolidador | Gemini 3.1 Pro (`gemini-3.1-pro-preview`) vía Gemini CLI, por API con clave en `~/.gemini/.env`. Alternativa manual si falla: Kimi K3 (`kimi-k3`) en DigitalOcean, por API OpenAI-compatible, clave en `~/.config/osky-debate/secrets.env`. Los debatientes nunca consolidan |
| Cierre | La consolidación produce un candidato con diff visible; el plan aprobado solo cambia si el usuario lo acepta |
| Sustituto temporal | Si un modelo falla en su turno y el reintento también falla, Kimi K3 cubre ese turno, marcado como sustitución. El modelo original vuelve en el siguiente turno (sección 2.5) |
| Anonimato | Los modelos se conocen como Participante A y B. El usuario ve los nombres reales |
| Contexto de repo | Opcional por debate, en solo lectura. La mayoría serán proyectos nuevos |
| Búsqueda web | Permitida, incluida investigación |
| Idioma | Todo en español |
| Stack | Electron + TypeScript + React |
| Alcance | Herramienta personal en este equipo, con posible publicación futura |
| Pruebas | Autorizadas con las cuentas reales; hechas el 23-sep-2026 (sección 13) |

Supuestos: un debate activo por vez, proyectos almacenados localmente, inferencia en los
servicios de cada proveedor (no funciona sin Internet).

## 2. Acceso a los modelos

### 2.1 Principio

Se ejecuta el CLI oficial de cada proveedor como subproceso en modo no interactivo. No
se extraen cookies ni tokens, no se usa el Agent SDK con credenciales de suscripción y
no se activa facturación de API para Claude ni OpenAI. Cada CLI gestiona su propio
login. Los consolidadores van por API por decisión del usuario: Gemini con clave
cargada por su propio CLI, y Kimi K3 con clave leída por el motor desde
`~/.config/osky-debate/secrets.env` (permisos 600, fuera de todo workspace y del
código). Ninguna clave se escribe en archivos del proyecto ni en los planes.

### 2.2 Conectores y flags verificados

| | Claude Code 2.1.280 | Codex CLI 0.156.1 | Gemini CLI 0.60.0 |
|---|---|---|---|
| Comando headless | `claude -p` (prompt por stdin) | `codex exec "<prompt>"` | `gemini -p "<prompt>"` |
| Modelo / esfuerzo | `--model claude-fable-5-1 --effort high` | `-m gpt-6-astra -c model_reasoning_effort="high"` (ya en `config.toml`) | `-m gemini-3.1-pro-preview` |
| Streaming | `--output-format stream-json --verbose --include-partial-messages` | `--json` (JSONL: `thread.started`, `item.*`, `turn.completed`) | `-o stream-json` |
| Sesión | `--session-id <uuid>` al abrir, `--resume <uuid>` después | `codex exec resume <thread_id> "<prompt>"` | `-r <id>` |
| Acta estructurada | `--json-schema` → `structured_output` en el evento `result` | `--output-schema <archivo>` + `-o <archivo>` | no aplica (consolidador) |
| Restricción de herramientas | `--allowedTools Read,Glob,Grep,Edit,Write,WebSearch,WebFetch` (sin Bash) | `-s workspace-write -C <workspace>`, `--search` para web | `--approval-mode auto_edit --skip-trust` |
| Reglas del debate | `--append-system-prompt-file` + `CLAUDE.md` | `AGENTS.md` | `GEMINI.md` |
| Carpeta de contexto | `--add-dir` | `--add-dir` (lectura fuera del workspace ya permitida por el sandbox) | `--include-directories` |
| Consumo reportado | `rate_limit_event`, `modelUsage`, `total_cost_usd` (estimado) | `usage` en `turn.completed` (tokens) | `stats` en la salida JSON |

Peculiaridades verificadas que el conector debe absorber:

1. Claude: los flags variádicos (`--allowedTools`, `--disallowedTools`, `--tools`) se
   tragan el prompt posicional. El prompt va siempre por stdin.
2. Claude: si se lanza desde otro proceso de Claude Code hay que limpiar `CLAUDECODE` y
   `CLAUDE_CODE_ENTRYPOINT`. El adaptador lo hace siempre.
3. Codex: no tiene herramienta de lectura separada; lee con shell. La regla "prohibido
   ejecutar comandos" lo bloquea. Su regla dice: shell solo para leer y `apply_patch`.
4. Codex: `exec resume` no acepta `-C` ni `-s`; hereda el directorio de la sesión y el
   sandbox se ajusta con `-c sandbox_mode="read-only"`. Sí acepta `--json`,
   `--output-schema`, `-o`, `-m`.
5. Codex: avisa "Reading additional input from stdin" si stdin no es TTY. Se redirige
   desde `/dev/null`.
6. Gemini: en carpeta no confiable no carga `~/.gemini/.env`. `--skip-trust` es
   obligatorio en headless.
7. Rutas: Codex vive en Node de NVM y Claude en `~/.local/bin`. Lanzada desde el menú de
   KDE la app no hereda el PATH de la terminal; detecta los ejecutables y permite
   configurar las rutas. Ninguna ruta personal se fija en el producto.

**Conector HTTP para Kimi K3 (alternativa de consolidación).** No es un CLI: es una
llamada a `https://inference.do-ai.run/v1/chat/completions`, compatible con OpenAI, con
`model: "kimi-k3"` y la clave en cabecera `Authorization`. Verificado el 23-sep-2026:
la clave lista 76 modelos, entre ellos `kimi-k3` y `kimi-k2.6`, y una llamada mínima a
`kimi-k3` respondió HTTP 200 con el modelo confirmado y uso de tokens en la respuesta
(una primera llamada dio HTTP 402 hasta que el usuario activó la facturación de la
cuenta). El adaptador recibe el mismo paquete de consolidación
que Gemini y devuelve el candidato completo en Markdown, que el motor escribe en
`plan.candidate.md`. Sin herramientas ni sesión: una sola petición con streaming SSE.

### 2.3 Verificación de identidad del modelo (obligatoria)

En las pruebas de GPT, dos peticiones mínimas a Fable 5.1 activaron una sustitución
automática a Opus 4.8 (`model_refusal_fallback`, categoría `cyber`). En las pruebas de
Claude, con un prompt real de planeación, `modelUsage` reportó `claude-fable-5-1`. Las
dos observaciones son compatibles: la sustitución existe y depende del contenido.

Regla del conector:

- Leer el modelo en **cada mensaje** del asistente y en los eventos de sustitución, no
  solo en el evento inicial ni en el resumen agregado.
- Si el modelo efectivo no es el autorizado, el turno se conserva como diagnóstico, no
  se publica en `plan.md`, no consume intervención y la interfaz muestra "identidad no
  confirmada" con la causa. Se aplica la política de fallo de 2.5: reintento con el
  mismo modelo y, si vuelve a fallar, Kimi K3 cubre el turno.
- No sustituir modelos, reducir esfuerzo ni activar facturación automáticamente. No
  intentar sortear una negativa del proveedor.
- Los contadores internos del CLI (`num_turns`) no equivalen a intervenciones. Una
  intervención es un encargo completo con resultado validado.

### 2.4 Consumo

La app muestra lo que cada proveedor expone: ventana de uso y estado de límite en
Claude, tokens en Codex, estadísticas en Gemini. El costo en dólares que estima Claude
Code es informativo y se etiqueta así; no se presenta como cargo. Se distingue consumo
incluido, uso adicional y costo de API (solo Gemini). En la cuenta Max probada, el uso
adicional está deshabilitado a nivel organización, lo que evita cargos sorpresa.

### 2.5 Sustituto temporal: Kimi K3

Decisión del usuario: si algún modelo falla, Kimi K3 es el reemplazo temporal. Se aplica
a los debatientes y al consolidador.

- Un turno falla cuando el CLI termina con error, agota el timeout, devuelve un acta
  inválida, la identidad del modelo no se confirma o la publicación no pasa las
  validaciones. El primer fallo produce **un reintento** con el mismo modelo.
- Si el reintento también falla, el motor ejecuta ese turno con Kimi K3. El plan
  aprobado no se toca hasta que la intervención sustituta pase las mismas validaciones.
- Kimi no tiene herramientas ni sesión: recibe en el prompt el protocolo, el paquete del
  turno y el plan completo, y devuelve el plan modificado completo más el acta. El motor
  escribe el borrador y lo valida igual que a cualquier turno.
- La sustitución se marca en todas partes: el acta lleva `sustituto: "kimi-k3"`, el
  commit dice `Turno k · Participante A (sustituto Kimi K3)`, la interfaz lo muestra y
  `debate.md` lo registra con la causa del fallo original.
- Es temporal: en el siguiente turno de ese participante el motor vuelve al modelo
  original. Si vuelve a fallar, se repite el mismo ciclo (reintento y luego Kimi).
- Cuenta como intervención del participante, no como turno extra, porque cubre el
  encargo de ese turno. El usuario puede desactivar la sustitución automática en la
  configuración para que un segundo fallo solo pause el debate.
- Para la consolidación, Kimi es la alternativa manual descrita en 4.3.

## 3. Tecnología y equipo de destino

**Electron + React + TypeScript**, con el motor (`debate-core`) como paquete Node
independiente que también corre desde terminal. Motivos: el trabajo pesado es Markdown
en vivo y diffs, donde el ecosistema web es superior; los tres CLIs son procesos que se
lanzan con `child_process` y emiten JSONL; un solo lenguaje. Tauri queda como alternativa
ligera (requiere Rust, que no está instalado) y Flutter como alternativa válida si se
prefiere Dart (está instalado, 3.41.4).

Equipo inspeccionado: Kubuntu sobre Ubuntu 26.04.1 LTS, KDE Plasma 6.6.6 en Wayland,
i9-11900K, 32 GB de RAM, RTX 3080, Node 24.20.0, pnpm 12.3.4. Recursos de sobra; la
validación de escritorio se centra en KDE/Wayland con NVIDIA: escalado, portapapeles,
selector de archivos, apertura del navegador para login, suspensión y reanudación.

Componentes: React, react-markdown para el render, Monaco o CodeMirror para el editor y
la vista de diff, chokidar para vigilar archivos, git como almacén de revisiones,
JSON/JSONL para estado y eventos. Sin servidor en la nube.

## 4. Reglas del debate

### 4.1 Fase inicial: rotación con objetivo por turno

Se sortea una sola vez quién abre y se persiste; reiniciar la app no lo cambia. A es
quien abre, B el otro.

| Turno | Participante | Objetivo de la intervención |
|---|---|---|
| 1 | A · 1/3 | Elaborar el primer plan sobre la plantilla (sección 9). Explicitar supuestos y preguntas |
| 2 | B · 1/3 | Revisar el plan completo, justificar mejoras e incorporarlas. Declarar qué mantiene, cambia y rechaza |
| 3 | A · 2/3 | Evaluar la revisión: aceptar o refutar con motivos, ajustar. Consolidar lo acordado |
| 4 | B · 2/3 | Resolver objeciones abiertas, reforzar viabilidad, alcance y dependencias |
| 5 | A · 3/3 | Revisar coherencia global, prioridades, riesgos y criterios de aceptación |
| 6 | B · 3/3 | Cierre de fase: pulir, listar desacuerdos pendientes y preguntas agrupadas para el usuario |

Una intervención es una respuesta completa al encargo del turno, con las consultas y
herramientas que use dentro. Una respuesta válida que concluye "sin cambios" cuenta.
Tras el turno 6 la app se detiene y espera al usuario.

### 4.2 Ciclos de observaciones

Cada observación del usuario abre un ciclo de exactamente dos intervenciones, una por
participante. El segundo recibe la observación, la respuesta del primero y el plan ya
modificado. Quién inicia cada ciclo se alterna; el primer ciclo lo inicia B porque A
abrió la fase inicial. El usuario puede cambiar este orden antes de iniciar. El ciclo se
repite mientras el usuario agregue observaciones.

### 4.3 Cierre y consolidación

"Finalizar plan" congela la versión aprobada. Después, y solo si el usuario lo activa,
corre la consolidación con Gemini 3.1 Pro. Está fuera del presupuesto de seis turnos,
no debate y no cambia decisiones.

Entrada del consolidador: `brief.md` (petición original y aclaraciones), la lista de
decisiones confirmadas por el usuario, `plan.md` aprobado y `debate.md` completo.

Salida: **un candidato, nunca un reemplazo.** El consolidador trabaja sobre una copia,
`plan.candidate.md`, y el plan aprobado no se toca. La interfaz muestra el diff entre
plan aprobado y candidato, con la sección "Puntos sin consenso" que el consolidador
escribe a partir de las posturas de A y B. El usuario puede aceptar el candidato (se
publica como revisión "Consolidación · Gemini"), editarlo antes de aceptar, o
descartarlo y conservar el plan aprobado.

Si la consolidación falla o el candidato no pasa las validaciones (Markdown parseable,
plantilla presente, ninguna decisión del usuario alterada), el plan aprobado se conserva
intacto y el usuario elige: reintentar con Gemini, o cambiar a Kimi K3. Nunca se pasa
automáticamente a un participante del debate: eso cambiaría la autoría y añadiría una
intervención fuera del presupuesto. El cambio de consolidador es una decisión manual y
queda registrado en `debate.md`.

### 4.4 Desacuerdos y autoridad del usuario

- No se declara consenso por silencio ni porque alguien escribió al final.
- Un cambio puede quedar incorporado pero pendiente de revisión por el otro.
- Las decisiones discutidas se registran con alternativas, argumentos y consecuencias.
- Las restricciones explícitas del usuario no se cambian por acuerdo entre las IAs.
- No se reabren decisiones resueltas sin evidencia nueva o cambio de requisitos.
- Las preguntas no bloqueantes se agrupan al final de la fase. Si falta un dato
  indispensable, el participante lo declara en el acta como bloqueante; la app pausa,
  el usuario responde y la respuesta continúa **el mismo turno** vía reanudación de
  sesión, sin consumir intervención.

## 5. Documento compartido: borrador editable, publicación controlada

Se combina la edición nativa (verificada) con el motor como único publicador (GPT).

- **Borrador:** cada participante edita `plan.md` directamente en el workspace del
  debate con sus herramientas nativas (`Edit` en Claude, `apply_patch` en Codex). Las
  pruebas mostraron que así modifican sin reescribir y conservan la estructura.
- **Versión oficial:** es el último commit de git. El archivo en disco durante un turno
  es un borrador visible en vivo, no la versión oficial.
- **Publicación:** al terminar el turno, el motor valida y solo entonces hace commit
  `Turno k · Participante X`. Si la validación falla, `git checkout -- plan.md` restaura
  la versión oficial y el borrador se guarda aparte como material recuperable.

Validaciones antes de publicar:

1. Identidad del modelo confirmada (sección 2.3).
2. Acta válida contra el JSON Schema.
3. El turno partió de la versión oficial vigente (hash del commit entregado en el
   paquete del turno). Una propuesta sobre una versión obsoleta nunca se publica.
4. Solo cambió `plan.md`; cualquier otro archivo modificado invalida el turno.
5. Porcentaje de líneas cambiadas visible en el acta; si supera un umbral configurable
   sin justificación de reestructuración, se marca para revisión del usuario.
6. Markdown parseable y encabezados de la plantilla presentes.

Edición externa: si el usuario o cualquier programa modifica `plan.md` fuera de turno,
chokidar lo detecta, se conservan ambas versiones y el siguiente turno no arranca hasta
resolverlo. En la interfaz el usuario puede editar solo cuando el debate está detenido.
La vista en vivo distingue el borrador en curso de la versión oficial.

## 6. Sistema de prompts

### 6.1 Tres capas

1. **Reglas persistentes por CLI** (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, generados):
   el protocolo compartido de 6.2 más las restricciones específicas del CLI (qué
   herramientas puede usar para leer y editar). Se escriben una vez por debate.
2. **Paquete del turno** (prompt por stdin en cada intervención): los datos variables
   de 6.3.
3. **Contrato de salida** (JSON Schema, el mismo para ambos): el acta de 6.4.

### 6.2 Protocolo compartido

Texto entregado a ambos antes de su primera intervención. Los corchetes los llena la
app. High y las restricciones de herramientas se configuran en el CLI; el texto no los
sustituye.

> Participas como [PARTICIPANTE] en un proceso de planeación de proyectos junto con
> [OTRO PARTICIPANTE], otro modelo frontera. El usuario es el moderador y espera un plan
> útil, viable y suficientemente concreto para ejecutarlo después. Tu responsabilidad es
> aportar criterio, detectar problemas y mejorar el documento compartido. No se trata
> de ganar el debate sino de que el plan salga lo mejor posible; el plan lo ejecutará
> una persona real y la calidad de tus decisiones determina si el proyecto sale bien.
>
> Trabaja con rigor. Evalúa alternativas relevantes, explica sus costes y beneficios y
> conserva lo que ya funciona. Puedes coincidir con el otro participante, complementar
> su propuesta o refutarla. Cada cambio sustantivo debe tener una razón vinculada a los
> objetivos y restricciones del usuario. No inventes objeciones ni cambios cosméticos
> para justificar tu turno; tampoco aceptes por cortesía: si el otro tiene razón,
> acéptalo sin defender tu propuesta por autoría, y si no la tiene, dilo con motivos.
>
> La fase inicial tiene seis intervenciones alternadas: tres tuyas y tres del otro.
> El orden se decidió al azar. Después, cada observación del usuario concede una
> respuesta a cada participante. Al cerrar, un tercer modelo consolidará el documento
> sin cambiar decisiones. La aplicación controla los turnos; al terminar tu
> intervención debes detenerte.
>
> Este es tu turno [TURNO] en la fase [FASE]. Tu objetivo específico es [OBJETIVO DEL
> TURNO]. La versión vigente del plan es [VERSION]. Trabaja únicamente sobre esa
> versión con los requisitos originales, las aclaraciones, el plan y el historial.
>
> Si abres el debate, construye el primer plan sobre la plantilla e identifica los
> supuestos. En los turnos siguientes evalúa la propuesta anterior y modifica
> preferentemente las secciones necesarias; no reconstruyas todo sin justificarlo.
> Edita `plan.md` directamente con tus herramientas; es un borrador que la aplicación
> validará y publicará. Es el único archivo que puedes modificar.
>
> Para cada cambio sustantivo indica el problema que resuelve, la modificación, su
> justificación y sus consecuencias. Distingue hechos comprobados, inferencias y
> preferencias. Si haces una afirmación técnica cambiante, verifica una fuente con las
> herramientas de consulta y búsqueda web habilitadas; si no puedes, márcala como
> pendiente. No inventes fuentes ni pruebas.
>
> Mantén las decisiones del usuario. Si discrepas de una decisión previa, explica qué
> evidencia nueva o contradicción justifica reabrirla. No declares consenso sobre algo
> que el otro participante aún no revisó. Si falta un dato indispensable para decidir
> con responsabilidad, decláralo como bloqueante en el acta y detente; el usuario
> responderá y continuarás este mismo turno. Todo lo demás son supuestos razonables o
> preguntas no bloqueantes.
>
> Limítate a planificar: no implementes el proyecto, no instales dependencias, no
> ejecutes cambios en el sistema ni crees otros archivos.
>
> Al terminar entrega el acta en el formato JSON solicitado. Puedes declarar "sin
> cambios" si el plan ya satisface los criterios de este turno. Busca un plan
> proporcionado al problema: viabilidad, experiencia de uso, alcance, recursos,
> mantenimiento y criterios de aceptación, sin complejidad innecesaria. Todo en
> español.

Anexo por CLI (se agrega al final del archivo de reglas):

- Claude: "Usa Read/Glob/Grep para consultar y Edit/Write solo sobre `plan.md`. No
  tienes shell."
- Codex: "Usa la shell únicamente para leer archivos del workspace (`cat`, `sed -n`)
  y para editar `plan.md` con `apply_patch`. Nada más."
- Gemini o Kimi (consolidador): "Recibes la petición original y las aclaraciones del
  usuario, sus decisiones confirmadas, el plan aprobado y la transcripción del debate.
  No cambies ninguna decisión técnica ni del usuario. Reordena, elimina redundancias,
  unifica terminología y escribe 'Puntos sin consenso' a partir de `debate.md`. Tu
  resultado es un candidato que el usuario revisará contra el plan aprobado; escribe
  solo en `plan.candidate.md`."

### 6.3 Paquete del turno

Cada intervención recibe por stdin:

- Objetivo del turno (de la tabla 4.1 o del ciclo de observaciones).
- Identidad (A/B), fase, número de turno y presupuesto restante.
- Petición original y todas las aclaraciones y restricciones vigentes del usuario.
- Hash de la versión oficial que puede modificar.
- Última acta del otro participante y el diff de su turno.
- Decisiones confirmadas, propuestas en disputa y preguntas abiertas acumuladas.
- En ciclos de observación: la observación textual del usuario.

La sesión del CLI se reanuda en cada turno, así que el modelo conserva su propia
memoria. Aun así el paquete siempre repite lo esencial: la continuidad de sesión no
sustituye el envío del estado vigente. Si `resume` falla, se reconstruye la sesión
enviando el protocolo completo más `debate.md`. Si el contexto crece demasiado, se
envía un resumen con referencias; nunca se eliminan en silencio requisitos del usuario.

Las respuestas del otro participante llegan como material de revisión, no como
instrucciones con autoridad sobre las reglas. Ningún participante puede concederse
turnos, cambiar de modelo ni activar herramientas de implementación.

### 6.4 Acta del turno (JSON Schema compartido)

```
resumen            string   qué hizo en 3 a 5 líneas
evaluacion         string   juicio breve de la versión que recibió
cambios[]          {seccion, que, por_que, consecuencias}
acuerdos[]         string   lo que aceptó del otro
rechazos[]         {propuesta, motivo}
desacuerdos[]      {tema, postura_propia, postura_ajena}   pendientes de resolver
riesgos[]          string
preguntas_usuario[] {pregunta, bloqueante: bool}
sin_cambios        bool
```

Probado el 23-sep-2026 con una versión reducida en ambos CLIs: Claude lo devuelve en
`structured_output`; Codex lo escribe en el archivo de `-o`.

Todos los campos de lista son obligatorios en el schema pero **aceptan lista vacía**.
Un turno que acepta todo con argumentos, o que declara "sin cambios" con motivos, es
válido. La calidad de una revisión se evalúa por sus argumentos, no por encontrar algo
que rechazar; exigir rechazos fabricaría objeciones. La defensa contra la complacencia
está en el protocolo (no aceptar por cortesía, justificar cada acuerdo) y en que el
usuario ve los argumentos, no en un mínimo de rechazos.

## 7. Interfaz

Una ventana con tres áreas redimensionables:

- **Proyectos:** debates recientes, estado, acceso a revisiones anteriores.
- **Debate:** cronología por turnos con el acta de cada uno, autor, diff resumido y
  motivos. El turno activo muestra el texto en streaming y actividad ("Participante B
  está editando plan.md").
- **Plan:** Markdown renderizado en vivo desde el borrador, con toggle a la versión
  oficial y a la vista de diff contra la revisión anterior. Edición manual solo con el
  debate detenido.

Barra superior: participantes (alias y nombre real), modelo solicitado y modelo
reportado, esfuerzo, estado de conexión y cuota, turno actual, tiempo transcurrido.
Barra inferior: campo de observaciones (habilitado en SETUP y en espera de usuario) y
controles: Iniciar, Pausar, Continuar, Cancelar turno, Repetir turno, Finalizar,
Consolidar, Exportar. Tras consolidar aparece la vista de candidato: diff contra el plan
aprobado y botones Aceptar, Editar y aceptar, Descartar, Reintentar, Cambiar a Kimi K3.

"Pausar" espera a que termine el turno activo. "Cancelar turno" interrumpe el proceso,
conserva el borrador, restaura la versión oficial y no cuenta como intervención. En la
espera del usuario se muestra un resumen mecánico: cambios, desacuerdos, preguntas
agrupadas, con estados "incorporado", "revisado por ambos" y "aprobado por el usuario".
Los indicadores muestran solo lo que el proveedor expone; no hay porcentaje ficticio de
avance ni acceso al razonamiento interno.

## 8. Persistencia y recuperación

Workspace por debate:

```
~/debates/2026-09-23-slug/
  plan.md        versión oficial en HEAD; borrador en disco durante un turno
  plan.candidate.md   salida de la consolidación, hasta que el usuario la acepte o descarte
  brief.md       petición original y aclaraciones del usuario
  decisions.md   decisiones confirmadas por el usuario (entrada de todos los turnos y del consolidador)
  debate.md      historial legible: prompt, actas, observaciones, decisiones
  CLAUDE.md  AGENTS.md  GEMINI.md     reglas generadas
  debate.json    estado: participantes, sesiones, turno, fase, sorteo, config
  events.jsonl   eventos crudos de cada CLI por turno (diagnóstico)
  .git/          una revisión por turno publicado
```

- Git es el almacén de revisiones inmutables: diff por turno, volver a cualquier
  revisión, exportar sin la app. Cada commit lleva turno, participante, modelo
  efectivo y hash del acta.
- `debate.json` se escribe con reemplazo atómico tras cada transición de estado. Al
  arrancar, el motor reconcilia estado y git; un `plan.md` distinto de HEAD sin turno
  activo se trata como edición externa por resolver.
- Cada turno tiene un id único y se publica una sola vez. Un fallo de red, login o
  cuota guarda el estado y no avanza el contador. Antes de reintentar se comprueba si
  hay un resultado completo recuperable, porque el proveedor puede haber consumido la
  solicitud interrumpida. Los reintentos automáticos son limitados.
- Las credenciales las gestionan los CLIs; nada de tokens en el proyecto. El visor de
  Markdown no ejecuta contenido activo.

SQLite no se usa en el MVP: git más JSON cubren revisiones, estado y eventos para una
herramienta personal. Si más adelante hace falta consulta transversal entre debates, se
agrega sin cambiar el formato de workspace.

## 9. Estructura del plan generado

Plantilla que el turno 1 rellena y los demás conservan:

1. Objetivo y resultado esperado.
2. Necesidades del usuario y criterios de éxito.
3. Alcance incluido y excluido.
4. Requisitos y restricciones.
5. Alternativas evaluadas y decisiones justificadas.
6. Arquitectura o estrategia de ejecución.
7. Etapas, entregables y dependencias.
8. Validación y criterios de aceptación.
9. Riesgos, supuestos y medidas de respuesta.
10. Preguntas y desacuerdos pendientes.

El plan contiene decisiones y trabajo ejecutable. La discusión va a `debate.md`, con
referencias desde las decisiones que lo necesiten. La consolidación agrega "Puntos sin
consenso" al final.

## 10. Desarrollo por etapas

| Etapa | Trabajo | Condición de salida |
|---|---|---|
| 0. Validar acceso | Hecha (sección 13). Queda: forzar y observar una sustitución de modelo y una cancelación a mitad de turno | Detección de identidad y cancelación probadas |
| 1. Motor | Máquina de estados, sorteo, rotación, ciclos, paquete del turno, acta, publicación con validaciones, git, `debate.json`. FakeAdapter con turnos simulados. CLI `debate new / next / say / close` | Ciclo completo correcto con participantes simulados, sin cuota |
| 2. Conectores | ClaudeAdapter, CodexAdapter, GeminiAdapter con los flags de 2.2, KimiAdapter HTTP, parsers JSONL y SSE, identidad, consumo, reanudación, reconstrucción de sesión, flujo de candidato de consolidación | Debate real de seis turnos más un ciclo y una consolidación revisada por el usuario, cancelable y recuperable |
| 3. Interfaz | Electron: proyectos, debate con streaming, plan en vivo con diff, controles, ajustes, detección de rutas de CLIs | Dirigir un debate completo desde una ventana |
| 4. Robustez | Timeouts, reintentos, límites de cuota, salida malformada, edición externa, exportar, empaquetado .deb o AppImage | Criterios de aceptación de la sección 11 cumplidos |
| 5. Validación en Kubuntu | Instalación, lanzamiento desde KDE, login vía navegador, Wayland/NVIDIA, suspensión | Flujo completo en este equipo |

MVP: dos participantes con los valores pedidos, consolidador opcional, un debate activo,
Markdown local, historial, seis intervenciones, ciclos de observaciones, pausa,
cancelación y recuperación. Se posponen multiusuario, sincronización, móvil y más de dos
debatientes. La publicación futura se prepara con conectores separados, configuración
portable y ausencia de rutas o credenciales personales en el código.

## 11. Criterios de aceptación

- El sorteo inicial es equilibrado y se conserva al reiniciar.
- Una fase inicial produce exactamente tres intervenciones completas por participante,
  alternadas, cada una con el objetivo de la tabla 4.1 en su paquete.
- Una observación del usuario produce exactamente una respuesta por participante, con
  el orden de inicio alternado, y después se detiene.
- El segundo de cada ciclo recibe la observación, la respuesta del primero y el plan
  actualizado.
- Ningún modelo inicia fuera de turno, modifica otro archivo ni implementa el proyecto.
- Cada revisión de `plan.md` se atribuye a un turno con acta, modelo efectivo y versión
  anterior.
- Un acta inválida, un turno sobre versión obsoleta, una sustitución de modelo o una
  respuesta incompleta no modifican la versión oficial.
- Cerrar la app durante un turno permite recuperar la última versión oficial y el
  estado pendiente.
- Los errores de login o cuota no consumen intervención ni producen sustituciones
  silenciosas.
- Una pregunta bloqueante pausa el turno y la respuesta del usuario lo continúa sin
  consumir intervención.
- La interfaz muestra desacuerdos y no confunde la última palabra con consenso.
- El usuario puede leer, comparar y exportar el Markdown sin la app.
- El costo estimado se etiqueta como estimado y el costo de API de los consolidadores
  se muestra aparte.
- La consolidación nunca modifica el plan aprobado por sí sola: produce un candidato
  con diff visible y solo la aceptación del usuario lo publica.
- Un fallo de consolidación conserva el plan aprobado intacto; el cambio a Kimi K3 es
  manual y ningún participante del debate recibe ese turno.
- Un acta con `rechazos` y `desacuerdos` vacíos pero con argumentos es válida y publica
  el turno.

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Sustitución automática de modelo (observada Fable → Opus 4.8) | Identidad por mensaje, turno no publicado, aviso al usuario |
| Consumo de cuota: seis o más turnos en High por debate | Indicador de ventana, pausa, N configurable, FakeAdapter para desarrollo |
| Cambios de flags o formato JSONL en los CLIs | Adaptadores aislados, versiones registradas, prueba de humo antes de actualizar |
| Un modelo reescribe en vez de editar | Regla explícita, porcentaje de cambio en el acta, revisión del usuario |
| Un modelo se sale del rol | Herramientas restringidas, workspace solo con Markdown, validación de archivos tocados |
| Complacencia mutua | Protocolo de no aceptar por cortesía y de justificar cada acuerdo; el usuario evalúa los argumentos del acta. No se exigen rechazos, para no fabricar objeciones |
| Consolidador que altera decisiones o falla | Salida como candidato con diff, validación de decisiones intactas, plan aprobado nunca se toca sin aceptación; reintento o cambio manual a Kimi K3 |
| Cuenta de DigitalOcean sin créditos (HTTP 402 posible si se agotan) | El adaptador traduce 402 a "consolidador no disponible" y ofrece reintentar o volver a Gemini; el plan aprobado no se toca |
| `resume` falla o el contexto crece | Reconstrucción de sesión con protocolo más `debate.md` |
| Sandbox de Codex requiere bubblewrap o landlock | Funcionó en la prueba; se verifica al empaquetar |
| PATH distinto desde el menú de KDE | Detección y configuración de rutas |
| Dos procesos escribiendo el mismo archivo | Turnos estrictamente secuenciales; el motor bloquea hasta publicar |

## 13. Pruebas realizadas el 23 de septiembre de 2026

Ambas propuestas hicieron pruebas con las cuentas reales, en directorios temporales,
sin instalar dependencias ni cambiar preferencias globales. Resultados combinados:

| Prueba | Claude Code | Codex CLI | Gemini CLI |
|---|---|---|---|
| Login y suscripción | claude.ai, Max 20x | ChatGPT, plan Pro | clave de API |
| Modelo efectivo | Fable 5.1 confirmado en un turno real de planeación; en dos peticiones mínimas hubo sustitución a Opus 4.8 | `gpt-6-astra` en catálogo con High; 271 tokens de razonamiento en el turno real | `gemini-3.1-pro-preview` responde |
| Modo plan / restricción | `--permission-mode plan` y `--allowedTools` funcionan | preset `plan` y sandbox `read-only` y `workspace-write` funcionan | `plan` y `auto_edit` funcionan |
| Streaming | eventos progresivos, `rate_limit_event` | JSONL con `item.*` y `usage` | JSON con `stats` |
| Acta con schema | `structured_output` válido | archivo `-o` válido | no aplica |
| Editar sin reescribir | plan inicial de 24 líneas | diff 10+/9- sobre el plan de Claude, estructura intacta | agregó "Puntos sin consenso" sin tocar decisiones |
| Reanudación | mismo `session_id`, memoria intacta | mismo `thread_id` tras reiniciar proceso, memoria intacta | no probada |
| Uso adicional | `isUsingOverage=false`, deshabilitado a nivel organización | uso ordinario permitido | costo de API |

Sin probar todavía: las seis intervenciones seguidas sobre un proyecto real, agotamiento
de cuota, fallos de red, cancelación a mitad de respuesta, y la interfaz en KDE.

## 14. Dónde las propuestas se contradecían y qué se eligió

| Tema | GPT | Claude | Elegido y por qué |
|---|---|---|---|
| Quién escribe `plan.md` | Solo el motor, a partir de propuestas por sección | El modelo edita directamente | Híbrido (sección 5): el modelo edita el borrador con herramientas nativas, que funciona bien, y el motor valida y publica en git, que da la protección que pedía GPT |
| Transporte de Codex | App Server por stdio | `codex exec` | `codex exec` para el MVP porque es estable y ya probado; App Server queda para catálogo y cuota cuando salga de experimental, encapsulado en el adaptador |
| Base de datos | SQLite | `debate.json` + git | JSON + git en el MVP; SQLite si hace falta después |
| Tercer modelo | Postergado, sin árbitro | Gemini consolida por API, con respaldo en un participante | Decisión del usuario: Gemini consolida fuera del presupuesto, produce un candidato revisable y nunca reemplaza el plan aprobado. Si falla, reintento o cambio manual a Kimi K3; los participantes no consolidan |
| Formato de propuesta | Sin definir | JSON Schema probado | JSON Schema compartido, ampliado con los campos de evaluación y desacuerdos que pedía GPT |
| Objetivo por turno | Tabla con objetivo específico | Turnos genéricos | Tabla de GPT |
| Preguntas bloqueantes | Pausan y continúan el mismo turno | Van al acta | Regla de GPT, implementada con reanudación de sesión |
| Identidad del modelo | Verificar por mensaje | Confiar en `modelUsage` | Regla de GPT; el hallazgo de la sustitución lo justifica |

## 14b. Revisión de `nuevo_plan_gpt.md` (23-sep-2026)

El plan integrado de GPT coincide con este en lo esencial: Electron y motor
independiente, seis turnos con objetivo por turno, acta estructurada con listas vacías
permitidas, motor como único publicador, identidad por mensaje, git sin SQLite, Gemini
por API como candidato revisable y sin cambio automático de consolidador. Lo que aportó y
se incorporó al código:

| Aporte de GPT | Qué se hizo |
|---|---|
| Orden de los ciclos: "empieza quien no habló último" conserva la alternancia global; alternar quién abre cada ciclo hace que un participante hable a ambos lados del usuario | Adoptado como default (`cycleOrder: global`). El modo `alternate` queda como opción. GPT tenía razón: la versión anterior hacía hablar a B dos veces seguidas |
| Un turno saltado marca el debate como abreviado; nunca se afirma que se completaron todas las intervenciones | Adoptado: `abbreviated` en el estado y aviso en el resumen |
| El consolidador no resuelve en silencio: sección "Observaciones del consolidador pendientes de revisión", sin elegir ganador, con informe breve de cambios | Adoptado en las reglas del consolidador; el informe se guarda en el candidato y se muestra al revisar |
| Campo `fuentes` en el acta para las referencias consultadas | Adoptado en el schema (lista obligatoria, puede ir vacía) |
| Exclusión mutua por debate aunque haya dos ventanas | Adoptado: lock por workspace con detección de proceso huérfano |
| Conservar la entrada exacta de cada turno para investigar divergencias | Adoptado: copia del prompt por intento en `.debate/turns/` |
| Prompts por función: apertura, revisión y observación como complementos del protocolo | Adoptado en el paquete del turno; la observación del usuario tiene prioridad sobre lo que contradiga |

Lo que no se adoptó y por qué:

- **App Server de Codex** en lugar de `codex exec`: sigue experimental; `exec` ya está
  validado con Astra en High y con `--search` global. Se reconsidera cuando salga de
  experimental.
- **Propuestas de edición por operaciones con identificadores de sección** en vez de la
  edición directa del borrador: las pruebas reales muestran que los modelos editan bien
  con sus herramientas nativas y el motor ya valida versión, alcance y plantilla antes de
  publicar. Cambiar el contrato ahora encarecería sin evidencia de necesidad.
- **Registro de decisiones con estados** (incorporado, revisado por ambos, aprobado) y
  **restaurar una versión con refresco de sesiones**: son funciones de la interfaz;
  quedan para la etapa 3.
- **Manejo de contexto desbordado** con selección trazable: pendiente; hoy el paquete
  envía todo y la sesión se reconstruye si falla `resume`. Se atiende cuando aparezca un
  debate que lo exija.
- **Cancelación con descarte de eventos tardíos**: pendiente junto con la cancelación
  misma, que aún no existe en el motor.

Observación de GPT que conviene tener presente: un workspace solo con Markdown no es un
aislamiento de herramientas por sí mismo. Por eso las restricciones reales están en los
flags de cada CLI y en la validación de archivos tocados antes de publicar.

## 15. Estado de ejecución y pendientes

**Etapas 1 y 2 implementadas (23-sep-2026)** en este repositorio: motor (`src/core`),
adaptadores Claude, Codex, Gemini, Kimi y simulado, CLI (`src/cli`) y suite de 16
pruebas con participantes simulados. Ver `README.md`.

Validado con un debate real de una ronda (Claude abre, Codex revisa, Gemini y Kimi
consolidan como candidato): identidad de Fable confirmada por mensaje, acta con schema en
ambos CLIs, búsqueda web en ambos, reanudación de sesión, publicación con git por turno,
candidato revisable sin tocar el plan aprobado, sustituto automático y marca de revisión
por reestructuración. Hallazgos corregidos durante la validación: `--search` de Codex es
global y va antes de `exec`; Kimi necesita el schema del acta en el prompt; la marca de
sustituto describe el intento publicado, no la historia del turno.

**Etapa 3 implementada (23-sep-2026):** app Electron + React en `app/`, con las tres
zonas de la sección 7, controles de turno, streaming del turno activo, diff por turno y
del candidato, caja de observaciones y decisiones, diálogo de nuevo debate, lista de
debates, vigilancia de `plan.md` en disco y detección del PATH de los CLIs desde KDE.
El motor ganó `pause()` y `cancel()` (la cancelación aborta el proceso del CLI, no cuenta
como intervención y no dispara reintento ni sustituto). Empaquetado con electron-builder
como AppImage y .deb (`pnpm dist`).

Pendientes:

1. Validar la app instalada en KDE/Wayland con un debate real completo (etapa 5).
2. Forzar y observar una sustitución de modelo en Claude para calibrar el detector.
3. Probar agotamiento de cuota y fallos de red con los CLIs reales.
4. Restaurar una versión anterior desde la interfaz y registro de decisiones con estados
   (funciones de interfaz postergadas en 14b).

Los cuatro modelos (Fable 5.1, GPT-6 Astra, Gemini 3.1 Pro y Kimi K3) quedaron
verificados con llamadas reales el 23-sep-2026.

Cambios de esta revisión (v1.1, 23-sep-2026) a petición del usuario: consolidación como
candidato revisable sin reemplazo automático, sin respaldo en participantes, con Kimi K3
como alternativa manual y con `brief.md` más decisiones como entrada; `rechazos` y
`desacuerdos` aceptan lista vacía.

## 16. Revisión del 2-oct-2026: Osky Project Planning

A petición del usuario:

- **Nombre:** el producto pasa a llamarse Osky Project Planning (paquete, app, menú, CLI
  `osky-planning`, carpeta de configuración `osky-project-planning`). La configuración de
  `~/.config/osky-debate` se migra sola.
- **Fable 5.1 por API:** en Claude Pro, Fable ya solo corre con créditos de uso. El valor por
  defecto es Claude Code con clave de API (`--bare` + `ANTHROPIC_API_KEY`), que conserva las
  herramientas; la API oficial de Anthropic con el SDK queda como alternativa.
- **Modelos configurables:** catálogo de frontera (`src/core/catalog.ts`) con vías por
  proveedor y modo de acceso: CLI con login (Claude Code, Codex), CLI con clave (Claude Code,
  Codex, Gemini CLI) y API (Anthropic, OpenAI, Google, xAI, Moonshot, DeepSeek, Alibaba,
  Z.ai, OpenRouter, DigitalOcean, Replicate). Las claves se gestionan desde Ajustes.
- **N participantes:** de 2 a 10, con orden de palabra sorteado. La fase inicial tiene
  rondas × N turnos; cada observación abre un ciclo de N respuestas. El paquete de cada turno
  trae las actas de todos los demás desde el último turno propio. El archivo de reglas de
  cada CLI es genérico para que dos participantes puedan compartir CLI, y `debate.md` ya no
  nombra modelos para preservar el anonimato.

Hallazgos de la investigación del 2-oct-2026 que cambian el diseño:

- Gemini CLI dejó de servir cuentas personales de Google el 18-jun-2026: solo clave de API.
  Su sucesor con login es Antigravity CLI (`agy`), no integrado todavía.
- Codex acepta `CODEX_API_KEY` en `codex exec` sin tocar el login guardado.
- Hay CLIs con login para Grok (Grok Build, beta) y Kimi (Kimi Code); no integrados todavía.
- Replicate va rezagado en modelos frontera (solo Fable 5 y Gemini 3.1 Pro).
- DigitalOcean lista modelos en `/models` que la clave puede no estar autorizada a usar
  (GLM-5.3 respondió 403 con la clave actual).
