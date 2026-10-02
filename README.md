# Osky Project Planning

Debate de planeación de proyectos entre modelos de IA de frontera. De dos a diez
participantes construyen y revisan un mismo `plan.md` por turnos rotativos; un modelo
distinto consolida al cierre como candidato revisable; un sustituto cubre el turno de un
modelo que falla. El diseño está en `nuevo_plan_claude.md`.

## Modelos y proveedores

Cada participante es un modelo del catálogo de frontera más una **vía de acceso**:

| Vía | Cómo se usa | Herramientas |
|---|---|---|
| CLI con login | Claude Code (suscripción Claude) o Codex (suscripción ChatGPT) | Edita el plan, búsqueda web, lee carpetas de contexto |
| CLI con clave | Claude Code, Codex o Gemini CLI con clave de API | Igual que arriba, facturado a la API |
| API | Anthropic (SDK oficial), OpenAI, Google, xAI, Moonshot, DeepSeek, Alibaba, Z.ai, OpenRouter, DigitalOcean, Replicate | Recibe el plan en el mensaje y lo devuelve completo |

Catálogo (solo topes de gama, verificado el 2-oct-2026): Claude Fable 5.1, Claude Opus 5.5,
GPT-6 Astra, Gemini 3.1 Pro, Grok 4.7, Kimi K3, DeepSeek V4 Pro, Qwen3.8 Max y GLM-5.3. Cada
uno lista sus vías disponibles (`osky-planning models`). En la app hay además "Otro modelo"
para escribir un id a mano cuando salga un modelo nuevo.

Notas de acceso:
- Gemini CLI ya no acepta login de cuentas personales de Google desde el 18-jun-2026; se usa
  con `GEMINI_API_KEY`. La app también lee la clave de `~/.gemini/.env`.
- Claude Fable 5.1 en Claude Code con login: en Pro solo con créditos de uso; en Max y en
  asientos premium de Team, incluido hasta el 50% del límite semanal.
- Codex con clave usa `CODEX_API_KEY` solo para `codex exec`; no toca el login guardado.
- Usar CLIs de suscripción desde una app propia puede chocar con los términos de consumo de
  cada proveedor; revísalos antes de distribuir.

Las claves se guardan en `secrets.env` dentro de la carpeta de configuración, con permisos
solo para el usuario: `~/.config/osky-project-planning` en Linux,
`~/Library/Application Support/osky-project-planning` en macOS y
`%APPDATA%\osky-project-planning` en Windows. La configuración de la versión anterior
(`~/.config/osky-debate`) se migra sola.

## App de escritorio

```bash
pnpm dev            # ventana en modo desarrollo con recarga
pnpm build:app      # compila a out/ (main, preload y renderer)
pnpm dist           # Linux: AppImage y .deb en release/
pnpm dist:mac       # macOS: .dmg y .zip (ejecutar en una Mac)
pnpm dist:win       # Windows: instalador NSIS (ejecutar en Windows)
```

La ventana tiene tres zonas: debates a la izquierda, plan en vivo al centro (con diff
por turno y diff del candidato de consolidación) y debate a la derecha (turnos con acta,
streaming del turno en curso). Arriba están los participantes en orden de palabra y los
controles de turno; abajo la caja para observaciones, respuestas a preguntas bloqueantes y
decisiones. **Ajustes** tiene dos pestañas: modelos por defecto (participantes,
consolidador, alterno, sustituto) y proveedores y claves (estado de cada CLI, inicio de
sesión en una terminal, guardar, probar y borrar claves).

Instalación en Linux: `sudo dpkg -i release/*.deb`, o sin root `scripts/install-user.sh`,
que copia el AppImage a `~/Applications`, crea la entrada del menú y retira la instalación
anterior con el nombre viejo. La app detecta los CLIs aunque el menú del escritorio no
herede el PATH de la terminal (`~/.local/bin`, NVM, Homebrew en macOS, npm global en
Windows).

Nota: si lanzas Electron desde una terminal integrada de VS Code, esa terminal define
`ELECTRON_RUN_AS_NODE=1` y Electron arranca como Node puro. Usa una terminal normal o
`env -u ELECTRON_RUN_AS_NODE pnpm dev`.

## Versiones y releases

Las versiones usan el formato `AAAA.M.D.N`: fecha de la compilación y número de compilación
del día. `2026.10.2.1` es la primera del 2 de octubre de 2026.

```bash
pnpm release                # etiqueta la siguiente compilación de hoy y la empuja
pnpm release 2026.10.2.3    # versión explícita
```

Al empujar la etiqueta `vAAAA.M.D.N`, GitHub Actions (`.github/workflows/release.yml`)
compila en Linux, macOS y Windows, corre las pruebas en los tres sistemas y publica un
Release con AppImage, `.deb`, `.dmg` para Apple Silicon e Intel, y el instalador `.exe`.
Por ahora macOS lleva firma ad-hoc sin notarizar y Windows va sin firma; las notas del
release explican cómo abrirlos la primera vez.

## Requisitos

- Node 22+, pnpm y git.
- Los CLIs que vayas a usar (`claude`, `codex`, `gemini`) y las claves de las APIs elegidas.

```bash
pnpm install
pnpm test          # suite con participantes simulados, sin cuota
pnpm typecheck
```

## Uso

```bash
alias debate='node_modules/.bin/tsx src/cli/index.ts'   # o pnpm build && ./bin/osky-planning.js

debate models                      # catálogo y vías, con estado de claves
debate providers                   # proveedores y claves configuradas
debate key OPENROUTER_API_KEY      # guarda una clave (la lee de stdin)

# Crear un debate (sorteo del orden; --start B fija quién abre)
debate new "Mi proyecto" --brief-file peticion.md --rounds 3 --decision "Todo en español"
debate new "Mi proyecto" --brief "..." -m claude-fable-5.1@anthropic:api gpt-6-astra@codex:cli-login grok-4.7@openrouter:api
debate new "Mi proyecto" --brief "..." --cycle-order alternate   # alterna quién abre cada ciclo
debate new "Prueba" --brief "..." --fake --participants 3 --run      # simulado, sin cuota

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
- Fallo → un reintento con el mismo modelo → el sustituto configurado (Kimi K3 por defecto) cubre el turno, marcado como
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
src/core/providers.ts   proveedores: CLIs y APIs, claves, URLs
src/core/catalog.ts     catálogo de modelos frontera y sus vías
src/core/secrets.ts     secrets.env por sistema operativo
src/core/adapters/      claude, codex, gemini (CLIs), anthropic (SDK), openai-compat, replicate, fake
src/core/config.ts      configuración y registro de adaptadores
src/cli/index.ts        comandos de terminal
app/main/               proceso principal de Electron: IPC, ajustes, login, PATH, vigilancia de plan.md
app/preload/            puente seguro (contextBridge)
app/renderer/           React: TopBar, Sidebar, PlanPanel, DebatePanel, NewDebateModal, SettingsModal, ModelPicker
test/                   motor (FakeAdapter), proveedores y adaptadores HTTP simulados
```
