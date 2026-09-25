# osky-debate

Motor y CLI del sistema de debate de planeación entre IAs. Dos participantes (Claude
Fable 5.1 vía Claude Code y GPT-6 Astra vía Codex CLI, ambos con suscripción) construyen
y revisan un mismo `plan.md` por turnos; Gemini 3.1 Pro consolida al cierre; Kimi K3 es
el sustituto temporal cuando un modelo falla. El diseño completo está en
`nuevo_plan_claude.md`.

Este paquete cubre las etapas 1 a 3 del plan: motor, adaptadores, CLI de terminal y la
app de escritorio (Electron + React) en `app/`.

## App de escritorio

```bash
pnpm dev            # ventana en modo desarrollo con recarga
pnpm build:app      # compila a out/ (main, preload y renderer)
pnpm dist           # AppImage y .deb en release/
```

La ventana tiene tres zonas: debates a la izquierda, plan en vivo al centro (con diff
por turno y diff del candidato de consolidación) y debate a la derecha (turnos con acta,
streaming del turno en curso). Arriba están los controles de turno (Iniciar, Un turno,
Pausar, Cancelar, Reintentar, Saltar, Finalizar, Consolidar, Aceptar, Descartar) y abajo la
caja para observaciones, respuestas a preguntas bloqueantes y decisiones.

Instalación standalone: `sudo dpkg -i release/*.deb` deja "Osky Debate" en el menú de KDE,
o ejecuta directamente `release/*.AppImage`. Sin root: `scripts/install-user.sh` copia el
AppImage a `~/Applications`, extrae el icono y crea la entrada del menú en
`~/.local/share/applications`. La app detecta `claude`, `codex` y `gemini`
aunque el menú de KDE no herede el PATH de la terminal (busca en `~/.local/bin` y en la
versión de Node más reciente de NVM).

Nota: si lanzas Electron desde una terminal integrada de VS Code, esa terminal define
`ELECTRON_RUN_AS_NODE=1` y Electron arranca como Node puro. Usa una terminal normal o
`env -u ELECTRON_RUN_AS_NODE pnpm dev`.

## Requisitos

- Node 22+ y pnpm.
- `claude` (Claude Code) con login de suscripción, `codex` con login ChatGPT, `gemini`
  con clave de API en `~/.gemini/.env`.
- Clave de DigitalOcean para Kimi K3 en `~/.config/osky-debate/secrets.env`:
  `DO_INFERENCE_API_KEY=...` (permisos 600). Nunca va en el repo ni en los planes.
- Opcional: `~/.config/osky-debate/config.json` para cambiar modelos, rutas de los CLIs,
  carpeta de debates, timeout o umbral de cambio. Cualquier campo de `DEFAULT_CONFIG`
  en `src/core/config.ts` se puede sobrescribir.

```bash
pnpm install
pnpm test          # suite con participantes simulados, sin cuota
pnpm typecheck
```

## Uso

```bash
alias debate='node_modules/.bin/tsx src/cli/index.ts'   # o pnpm build && ./bin/debate.js

# Crear un debate (sorteo de quién abre; --start A|B lo fija)
debate new "Mi proyecto" --brief-file peticion.md --rounds 3 --decision "Todo en español"
debate new "Mi proyecto" --brief "..." --cycle-order alternate   # alterna quién abre cada ciclo
debate new "Prueba" --brief "..." --fake --run      # simulado, sin cuota

# Fase inicial y ciclos
debate run  <workspace>            # ejecuta turnos hasta que haga falta el usuario
debate next <workspace>            # un turno (con reintento y sustituto automático)
debate say  "observación" -w <workspace> --run   # abre un ciclo de dos respuestas
debate say  "respuesta" -w <workspace>           # responde una pregunta bloqueante
debate decide "restricción" -w <workspace>
debate status <workspace>
debate acta 3 -w <workspace>
debate retry <workspace> · debate skip <workspace>

# Cierre
debate finalize <workspace>
debate consolidate <workspace> [--alt]   # candidato en plan.candidate.md + diff
debate accept <workspace> · debate discard <workspace>
```

## Workspace de un debate

```
~/debates/AAAA-MM-DD-slug/
  plan.md              versión oficial en HEAD; borrador durante un turno
  plan.candidate.md    salida de la consolidación hasta aceptar o descartar
  brief.md             petición y aclaraciones del usuario
  decisions.md         decisiones del usuario
  debate.md            transcripción: actas, observaciones, consolidación
  CLAUDE.md AGENTS.md GEMINI.md   reglas generadas por CLI
  debate.json          estado del motor (ignorado por git)
  .debate/             schema del acta y logs JSONL crudos por intento
  .git/                una revisión por turno publicado
```

## Garantías del motor

- Turnos estrictamente secuenciales; un turno solo se publica si el modelo efectivo es el
  autorizado, el acta valida contra el schema, solo cambió `plan.md`, el Markdown conserva
  la plantilla y partió de la versión vigente. Si algo falla, `git` restaura el plan.
- Fallo → un reintento con el mismo modelo → Kimi K3 cubre el turno, marcado como
  sustituto; el modelo original vuelve en su siguiente turno.
- Pregunta bloqueante → el turno se pausa; la respuesta del usuario lo continúa en la
  misma sesión sin consumir intervención.
- La consolidación nunca toca el plan aprobado: produce un candidato con diff y solo
  `accept` lo publica.
- Las listas del acta pueden ir vacías: no se exigen rechazos. El acta incluye `fuentes`.
- Ciclos de observación: por defecto empieza quien no habló último, así nadie habla dos
  veces seguidas (`--cycle-order global`). Con `alternate` se alterna quién abre cada ciclo.
- Un turno saltado marca el debate como abreviado en el estado y en el resumen.
- Un lock por workspace impide que dos procesos ejecuten turnos a la vez; un lock huérfano
  se recupera solo.
- Cada intento guarda el prompt exacto que recibió el modelo en `.debate/turns/*.prompt.md`.

## Estructura del código

```
src/core/types.ts       tipos del estado, turnos, acta, eventos
src/core/schema.ts      JSON Schema del acta + validación (ajv) + render
src/core/prompts.ts     protocolo, anexos por CLI, paquete del turno, consolidación
src/core/engine.ts      máquina de estados, validaciones, publicación, git
src/core/git.ts         helpers de git
src/core/adapters/      claude, codex, gemini, kimi (HTTP), fake (pruebas)
src/core/config.ts      configuración y registro de adaptadores
src/cli/index.ts        comandos de terminal
app/main/               proceso principal de Electron: IPC, vigilancia de plan.md, PATH
app/preload/            puente seguro (contextBridge)
app/renderer/           React: TopBar, Sidebar, PlanPanel, DebatePanel, NewDebateModal
test/engine.test.ts     suite con FakeAdapter
```
