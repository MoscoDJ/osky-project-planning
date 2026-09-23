# Propuesta de GPT: sistema de debate para planeación de proyectos

Fecha: 23 de septiembre de 2026.

Estado: segunda revisión, actualizada con las decisiones del usuario y pruebas locales de los CLI. Este archivo contiene exclusivamente la propuesta de GPT. Contiene planificación; no implementa la aplicación ni representa un debate ya realizado entre los modelos.

## 1. Objetivo y alcance

Crear una aplicación de escritorio para Kubuntu donde el usuario describa un proyecto y dos participantes —Claude Fable 5.1 con esfuerzo High y GPT-6 Astra con esfuerzo High— construyan y revisen un mismo plan. Ambos deben trabajar en modo de planificación, mediante acceso por suscripción, sin contratar ni utilizar directamente las API de inferencia.

El resultado será un archivo `plan.md`, acompañado de un historial que permita entender quién cambió qué y por qué. El usuario podrá observar la conversación y el documento, aportar correcciones y decidir cuándo dar el plan por terminado.

Decisiones confirmadas por el usuario:

- Se utilizarán suscripciones nativas de OpenAI y Anthropic. Cursor no forma parte del acceso a los modelos.
- La primera versión será una herramienta personal instalada en este equipo. Una publicación posterior es posible si el resultado es satisfactorio.
- Está autorizada la inspección del equipo y la realización de pruebas con los CLI instalados. El proyecto sigue en planificación, sin implementación de la aplicación.
- Se contempla un tercer proveedor o participante más adelante; su identidad y función se definirán después.

Supuestos de alcance que se mantienen: un debate activo por vez, interfaz y respuestas en español, proyectos almacenados localmente. La inferencia seguirá realizándose en los servicios de los proveedores; almacenar localmente no significa funcionar sin Internet.

La inspección local identificó ChatGPT **Pro** y Claude **Max**, con un nivel de cuota reportado por Claude como Max 20x. La aplicación debe detectar la suscripción efectiva de cada cuenta, sin asumir que ambas se llaman Pro.

## 2. Viabilidad del acceso por suscripción

Se interpreta «sin API» como no usar claves ni facturación directa de las API de modelos. La aplicación sí necesitará comunicarse localmente con los clientes oficiales.

### Integración elegida: suscripciones nativas

- **GPT-6 Astra:** integrar Codex mediante su App Server local, inicialmente por entrada/salida estándar. La prueba con la cuenta real confirmó autenticación ChatGPT Pro, presencia de `gpt-6-astra` en el catálogo, soporte High y modo Plan nativo. También se completaron una respuesta y su continuación después de reiniciar el proceso del conector. Fuentes de la interfaz: [autenticación](https://learn.chatgpt.com/docs/auth), [App Server y catálogo de modelos](https://learn.chatgpt.com/docs/app-server). Evidencia local detallada en la sección 14.
- **Claude Fable 5.1:** utilizar el cliente oficial Claude Code con login de Claude. La prueba confirmó suscripción Max, modo Plan, configuración High, salida progresiva y continuidad de sesión. Sin embargo, las dos solicitudes a Fable 5.1 activaron un cambio automático a Opus 4.8: todavía no se ha validado una respuesta efectiva de Fable 5.1. Fuentes: [autenticación](https://code.claude.com/docs/en/authentication), [ejecución programática](https://code.claude.com/docs/en/headless), [configuración de modelos y sustitución automática](https://code.claude.com/docs/en/model-config).
- **Consumo:** la documentación distingue Max, que incluye una asignación para Fable dentro de sus límites, de Pro, que requiere créditos de uso para Fable. En las pruebas de esta cuenta Max, el CLI informó uso permitido, `isUsingOverage=false` y consumo adicional deshabilitado. Esto describe el estado observado, no garantiza disponibilidad futura. Fuente: [Fable en cada suscripción](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan).

### Extensión futura a un tercer proveedor

El motor usará identificadores de participantes y conectores independientes. Cada conector declarará sus capacidades: autenticación por suscripción, catálogo, esfuerzo, planificación nativa, salida progresiva, reanudación, cancelación y datos de consumo.

El MVP activará únicamente los dos participantes acordados. No se presupone que el tercero sea árbitro ni que reciba turnos adicionales. Su incorporación requerirá definir su papel y adaptar explícitamente el calendario; los seis turnos actuales permanecen iguales. El almacenamiento no limitará los participantes a dos columnas fijas ni el motor dependerá de los nombres de los proveedores.

### Comprobación previa obligatoria

Antes de desarrollar la interfaz completa debe cerrarse la validación con las cuentas reales. Parte de ella ya se realizó con autorización del usuario; la sección 14 separa lo comprobado de lo pendiente:

1. Verificar versión del cliente, login y modalidad de acceso por suscripción.
2. Comprobar los identificadores de los modelos, el esfuerzo High y el modo de planificación disponible en esa interfaz.
3. Obtener una respuesta de cada participante y reanudar ambas sesiones.
4. Comprobar eventos de salida, fin de turno, cancelación y errores de cuota.
5. Comprobar si el consumo está incluido o requiere créditos adicionales. No iniciar consumo adicional sin una decisión explícita del usuario.
6. Registrar qué ajustes puede confirmar el proveedor y cuáles solo puede solicitar el cliente.

No sustituir modelos, reducir esfuerzo ni activar facturación de API automáticamente. Si el acceso solicitado no está disponible, mostrar el impedimento y conservar el proyecto. No afirmar que se verificó High cuando el cliente no exponga evidencia suficiente.

La comprobación de identidad debe consultar el modelo de las respuestas y los eventos de cambio, además del modelo solicitado al iniciar la sesión. Una respuesta de Opus no contará como una intervención de Fable. Si el proveedor cambia de modelo, conservar el resultado como diagnóstico, detener el turno antes de publicar cambios y avisar al usuario. Cuando el cliente lo permita, limitar la selección a los modelos autorizados para que una negativa termine como error en lugar de iniciar una sustitución; esa configuración específica todavía debe probarse. No intentar sortear una negativa del proveedor.

La aplicación utilizará los clientes oficiales y sus flujos de login, sin extraer cookies del navegador ni copiar tokens hacia un cliente de inferencia propio. Para una publicación posterior, cada usuario iniciará sesión con sus propias cuentas. Antes de distribuir se revisarán las condiciones de integración y redistribución vigentes, sin incorporar credenciales personales al instalador. Referencia: [integración y credenciales de Claude Code](https://code.claude.com/docs/en/legal-and-compliance).

## 3. Tecnología recomendada

**Recomendación para el MVP: Electron + React + TypeScript.** Es una decisión de ingeniería para este producto: facilita usar componentes web de Markdown y comparación de documentos, y coordinar procesos locales en un entorno JavaScript/TypeScript. Electron separa la interfaz del proceso con acceso al sistema. Fuente: [modelo de procesos de Electron](https://www.electronjs.org/docs/latest/tutorial/process-model).

| Opción | Ventaja para este proyecto | Coste o inconveniente | Decisión |
| --- | --- | --- | --- |
| Electron | Interfaz de documentos y control de clientes locales con un stack coherente | Distribuye Chromium; hay que medir memoria y tamaño | Primera opción |
| Tauri + React | Interfaz web con integración de escritorio y posibilidad de un paquete más ligero | Añade Rust y dependencias de WebKitGTK en Linux | Alternativa si el consumo local es prioritario |
| Flutter | Viable en Linux, conveniente si ya se domina Dart o se prevé una app móvil | Preveo más integración para edición Markdown avanzada y comparación de versiones | Elegir si existe una preferencia fuerte por Flutter |

Las estimaciones comparativas son criterio de diseño, no resultados de una prueba de rendimiento. Fuentes de compatibilidad: [requisitos de Tauri](https://v2.tauri.app/start/prerequisites/), [compilación Linux con Flutter](https://docs.flutter.dev/platform-integration/linux/building).

Componentes propuestos: React para la interfaz, TypeScript para el motor de turnos, un editor como CodeMirror para Markdown, SQLite para sesiones y eventos, y archivos Markdown legibles fuera de la aplicación. La selección exacta de librerías se validará al implementar. No se necesita servidor propio en la nube.

### Equipo de destino inspeccionado

Datos obtenidos localmente el 23 de septiembre de 2026:

| Componente | Resultado |
| --- | --- |
| Sistema | Kubuntu sobre Ubuntu 26.04.1 LTS; paquete `kubuntu-desktop` instalado |
| Arquitectura y kernel | x86_64, Linux 7.0.0-31-generic |
| Escritorio | KDE Plasma 6.6.6, sesión Wayland |
| CPU | Intel Core i9-11900K, 8 núcleos y 16 hilos |
| RAM | Aproximadamente 32 GB; 31 GiB reportados, unos 15 GiB disponibles al inspeccionar |
| Disco del proyecto | Volumen de aproximadamente 1.6 TiB, con unos 1.3 TiB libres |
| Gráficos | NVIDIA GeForce RTX 3080 e Intel UHD Graphics 750 |
| JavaScript | Node.js 24.20.0, npm 11.19.0 y pnpm 12.3.4 |
| Flutter | Flutter 3.41.4 y Dart 3.11.1 ya instalados |
| Tauri/Rust | WebKitGTK 4.1 instalado; `cargo` y `rustc` no encontrados en el PATH de esta sesión |

El equipo tiene recursos suficientes para el diseño propuesto. No se necesita ejecutar modelos en la GPU local. Mantengo Electron como primera opción por el trabajo de documentos e integración de procesos, no por una limitación del equipo. Flutter ya está disponible y sigue siendo una alternativa válida si existe preferencia por Dart; tenerlo instalado no determina por sí solo la experiencia de desarrollo.

La validación de escritorio se centrará primero en KDE/Wayland con NVIDIA: escalado, entrada de texto, portapapeles, selección de archivos, apertura del navegador para login y suspensión/reanudación. Son comprobaciones pendientes, no fallos observados.

Codex está instalado dentro de una versión de Node administrada por NVM y Claude en `~/.local/bin`. La aplicación lanzada desde el menú de KDE deberá detectar las rutas de los ejecutables y permitir configurarlas: no debe asumir que hereda el mismo PATH que una terminal. Las rutas concretas de este usuario no se fijarán en el producto.

## 4. Reglas exactas del debate

### Fase inicial: tres intervenciones por participante

Se sortea una sola vez quién comienza. Se guarda el resultado para que reiniciar la aplicación no lo altere. A designa al elegido y B al otro.

| Turno | Participante | Objetivo |
| --- | --- | --- |
| 1 | A, intervención 1/3 | Elaborar el primer plan y explicitar supuestos y preguntas |
| 2 | B, intervención 1/3 | Revisar el plan, justificar mejoras e incorporarlas |
| 3 | A, intervención 2/3 | Evaluar la revisión, aceptar o refutar con motivos y ajustar |
| 4 | B, intervención 2/3 | Resolver objeciones y reforzar viabilidad y alcance |
| 5 | A, intervención 3/3 | Revisar coherencia, prioridades, riesgos y criterios de aceptación |
| 6 | B, intervención 3/3 | Consolidar la versión y declarar desacuerdos pendientes |

Una intervención es una respuesta completa al encargo de ese turno, incluidas las consultas o herramientas permitidas dentro de ella. Los mensajes parciales no son turnos adicionales. Una respuesta válida que concluye que no hacen falta cambios también cuenta.

Los contadores internos del proveedor tampoco equivalen a intervenciones del debate: una de las pruebas de Claude devolvió `num_turns=2` para una única petición del usuario. El motor cuenta el encargo completo y su resultado validado, independientemente de reintentos o pasos internos.

Después del sexto turno, la aplicación se detiene y espera al usuario. No añade un tercer árbitro ni un turno de resumen de IA fuera del presupuesto establecido.

### Ciclos posteriores

Cada observación enviada por el usuario abre un ciclo de exactamente dos intervenciones: una de cada participante. El segundo recibe tanto la observación original como la respuesta y la versión modificada por el primero. Al terminar vuelve a esperarse al usuario.

Propuesta de orden: alternar quién inicia cada ciclo posterior, para repartir la oportunidad de responder primero y de cerrar. El primer ciclo de observaciones empezaría con B, porque A abrió la fase inicial. El usuario podrá cambiar esta preferencia antes del inicio.

El ciclo se repite mientras el usuario agregue observaciones. «Finalizar plan» congela la versión elegida; no llama automáticamente a los modelos.

### Desacuerdos y autoridad del usuario

- No declarar consenso por silencio ni porque un participante escribió al final.
- Un cambio puede quedar incorporado pero pendiente de revisión por el otro participante.
- Registrar decisiones discutidas con alternativas, argumentos y consecuencias; el usuario puede resolverlas.
- Las restricciones explícitas del usuario no se cambian mediante acuerdo entre las IA.
- No reabrir decisiones ya resueltas sin aportar evidencia o un cambio de requisitos.
- Las preguntas no bloqueantes se agrupan al terminar la fase. Si falta un dato indispensable, se pausa el turno; responder a esa aclaración continúa el mismo turno.

## 5. Documento compartido y edición por turnos

Los participantes modifican conceptualmente un solo plan. El motor será el único componente que escriba físicamente la versión oficial. Esto permite mantener los clientes en planificación y evita depender de que ese modo permita editar archivos arbitrarios. El problema ya ocurrido con dos agentes escribiendo el mismo documento refuerza esta decisión: cada participante genera una propuesta aislada y solo el gestor de versiones puede incorporarla al plan común.

Flujo de actualización:

1. Entregar al participante una instantánea del plan con identificador de versión y huella de contenido.
2. Recibir su revisión y una propuesta de cambios sobre secciones identificables.
3. Mostrar la propuesta en vivo como borrador.
4. Al terminar correctamente, validar la identidad del modelo, el formato, la versión de origen y las operaciones propuestas.
5. Guardar una revisión inmutable y publicar el nuevo `plan.md` mediante reemplazo atómico.
6. Registrar autor, turno, razones y diferencias; después habilitar al siguiente participante.

Se prefieren cambios por sección sobre reconstruir todo el documento. El primer turno crea la estructura; una reestructuración posterior debe explicar su necesidad. No se aplicarán búsquedas y reemplazos ambiguos.

Una propuesta desactualizada nunca sobrescribe la versión actual. Si el usuario edita desde otro programa, el sistema detecta el cambio, conserva ambas versiones y pausa la aplicación del turno afectado. En la interfaz propia se permite editar cuando el debate está detenido; durante una respuesta se pueden redactar observaciones para enviar después.

La vista en vivo distingue el texto en generación de la versión guardada. Los borradores incompletos sobreviven a errores como material recuperable, pero no se publican como plan válido.

No se presupone que una instrucción en el prompt active el modo Plan nativo. Cada conector debe activarlo mediante su mecanismo documentado y restringir las herramientas de implementación. Si no puede, la aplicación informa la limitación; no presenta una simulación como modo nativo.

## 6. Información que recibe cada participante

En cada turno se envía un paquete explícito:

- Petición original y todas las correcciones vigentes del usuario.
- Protocolo del debate y objetivo de la intervención actual.
- Identidad del participante, fase, número de turno y presupuesto restante.
- Plan oficial completo o, si su tamaño lo impide, una selección explícita y verificable.
- Última intervención del otro participante.
- Decisiones confirmadas, propuestas en disputa y preguntas abiertas.
- Identificador de la versión que puede modificar.

Se mantienen sesiones independientes, una por participante. La continuidad de una sesión no sustituye el envío del plan vigente. Para conversaciones largas se conserva el historial completo local y se envían resúmenes con referencias; nunca se eliminan silenciosamente requisitos del usuario. Si se necesita una operación adicional de IA para resumir, se informa su consumo y no se la disfraza de parte gratuita del motor.

Las respuestas del otro participante se entregan como material de revisión, no como instrucciones con autoridad sobre las reglas. Ningún participante puede concederse turnos extra, cambiar de modelo o activar herramientas de implementación.

## 7. Interfaz propuesta

Una ventana con tres áreas redimensionables:

- **Proyectos:** proyectos recientes, estado y acceso a versiones anteriores.
- **Debate:** conversación cronológica, autor, turno, avances y motivos de los cambios.
- **Plan:** Markdown renderizado, edición cuando esté detenido y comparación con la revisión anterior.

En la parte superior: participantes, modelo solicitado y reportado, esfuerzo, estado de conexión, turno y tiempo transcurrido. En la parte inferior: campo de observaciones y controles para iniciar, pausar, continuar, cancelar el turno y finalizar.

«Pausar» espera a que concluya el turno activo y evita iniciar el siguiente. «Cancelar turno» interrumpe el proceso, conserva el borrador y requiere decidir cómo continuar; no se cuenta como una intervención completada.

Durante la espera del usuario se muestra un resumen mecánico de cambios, decisiones pendientes y preguntas. La interfaz distingue entre «incorporado», «revisado por ambos» y «aprobado por el usuario».

El progreso muestra texto y estados que el proveedor exponga; no promete acceso al razonamiento interno ni un porcentaje ficticio de finalización. Si un cliente no ofrece salida incremental, muestra actividad y publica la respuesta al recibirla.

## 8. Persistencia y recuperación

Cada proyecto tendrá:

- `plan.md`: versión vigente del plan.
- `brief.md`: petición original y aclaraciones del usuario.
- `debate.md`: historial legible exportable, con argumentos y decisiones.
- `revisions/`: instantáneas inmutables de cada versión confirmada.
- Una base de datos local de la aplicación: sesiones, eventos, versiones, estado y metadatos de consumo disponibles.

SQLite registra qué revisión está confirmada. `plan.md` es su copia de trabajo legible y se reconcilia al arrancar si hubo un cierre entre operaciones. Un archivo externo diferente se conserva como edición por resolver, sin borrarlo automáticamente.

Cada turno tiene un identificador único y solo puede confirmarse una vez. Si falla la red, expira el login o se agota la cuota, se guarda el estado y no avanza el contador. Antes de reintentar se comprueba si existe un resultado completo recuperable: la aplicación no puede garantizar que el proveedor no haya consumido una solicitud interrumpida.

Los reintentos automáticos serán limitados. Una repetición no produce una segunda revisión del mismo turno. Cerrar y abrir la aplicación debe conservar quién empieza, los turnos completados y la siguiente acción pendiente.

Los clientes oficiales gestionan sus credenciales. La aplicación no guarda contraseñas ni tokens en archivos del proyecto. El motor permite lectura del material seleccionado y escritura solo mediante el gestor del plan; el visor Markdown no ejecuta contenido activo.

El coste estimado que un CLI exprese en dólares no se presentará como un cargo confirmado. Se distinguirán consumo de la suscripción, uso adicional y métricas estimadas, según los datos que realmente exponga cada proveedor.

## 9. Estructura del plan generado

Plantilla inicial adaptable a cada proyecto:

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

El plan contiene decisiones y trabajo ejecutable. La discusión extensa queda en el historial, con referencias desde las decisiones que lo necesiten.

## 10. Prompt inicial compartido

El siguiente texto se enviará a ambos participantes antes de su primera intervención. Los campos entre corchetes los completa la aplicación. El esfuerzo High y el modo Plan se configuran además en el cliente; este texto no los sustituye.

> Participas como [PARTICIPANTE] en un proceso de planeación de proyectos junto con [OTRO PARTICIPANTE]. El usuario espera un plan útil, viable y suficientemente concreto para poder ejecutarlo después. Tu responsabilidad es aportar criterio, detectar problemas y mejorar el documento compartido.
>
> Trabaja con rigor. Evalúa alternativas relevantes, explica sus costes y beneficios y conserva lo que ya funciona. Puedes coincidir con el otro participante, complementar su propuesta o refutarla. Cada cambio sustantivo debe tener una razón vinculada a los objetivos y restricciones del usuario. No necesitas inventar objeciones ni cambios cosméticos para justificar tu turno.
>
> La fase inicial tiene seis intervenciones alternadas: tres tuyas y tres del otro participante. El orden inicial se decide al azar. Después, cada observación del usuario concede una respuesta a cada participante. La aplicación controla los turnos; al terminar tu intervención debes detenerte.
>
> Este es tu turno [TURNO] en la fase [FASE]. Tu objetivo específico es [OBJETIVO DEL TURNO]. La versión vigente es [VERSION]. Trabaja únicamente sobre esa versión y usa los requisitos originales, las aclaraciones, el plan y el historial suministrados.
>
> Si abres el debate, construye el primer plan e identifica los supuestos. En los turnos siguientes, evalúa la propuesta anterior y modifica preferentemente las secciones necesarias. No reconstruyas todo sin justificarlo. Incorpora las mejoras que puedas concretar durante tu intervención.
>
> Para cada cambio sustantivo indica el problema que resuelve, la modificación propuesta, su justificación y sus consecuencias. Distingue hechos comprobados, inferencias y preferencias. Si haces una afirmación técnica cambiante, verifica una fuente cuando tengas herramientas para ello; en caso contrario, marca la verificación pendiente. No inventes fuentes ni pruebas realizadas.
>
> Mantén las decisiones del usuario. Si discrepas de una decisión previa, explica qué evidencia nueva o contradicción justifica reabrirla. Si el otro participante tiene razón, acepta la mejora sin defender tu propuesta por autoría. No declares consenso si el otro participante todavía no ha revisado un cambio.
>
> Limítate a planificar: no implementes el proyecto, no instales dependencias y no ejecutes cambios en el sistema. Entrega las modificaciones del plan a través del formato de propuesta solicitado; la aplicación guardará el Markdown. Usa únicamente las herramientas de consulta habilitadas.
>
> Tu salida debe incluir: evaluación breve de la versión actual; cambios propuestos con motivos; contenido de las secciones que deben cambiar; desacuerdos o riesgos pendientes; y preguntas para el usuario. Puedes declarar «sin cambios» si el plan ya satisface los criterios de este turno. Ofrece explicaciones claras de las decisiones, sin extenderte en razonamiento interno.
>
> Busca un plan proporcionado al problema: cubre viabilidad, experiencia de uso, alcance, recursos, mantenimiento y criterios de aceptación sin añadir complejidad innecesaria. Si falta información, declara un supuesto razonable cuando permita avanzar. Señala como bloqueante únicamente lo que impida una decisión responsable.
>
> Petición del usuario: [PETICION ORIGINAL].
> Aclaraciones y restricciones vigentes: [REQUISITOS].
> Plan vigente: [PLAN].
> Última intervención y decisiones abiertas: [CONTEXTO].

En turnos posteriores se conserva el protocolo y se refrescan los datos de turno, el plan y las observaciones. Si la sesión se reconstruye, se vuelve a enviar el protocolo completo.

## 11. Desarrollo por etapas

| Etapa | Trabajo | Condición de salida |
| --- | --- | --- |
| 0. Validar acceso | Cerrar la validación de identidad de Fable y completar los casos de error; Astra y los dos logins ya se probaron | Una respuesta y una reanudación con el modelo efectivo correcto por participante |
| 1. Motor del debate | Implementar estados, sorteo, seis turnos y ciclos de observaciones | Secuencias correctas con participantes simulados |
| 2. Documentos | Versiones, cambios por sección, publicación y recuperación | No perder ni duplicar modificaciones ante fallos |
| 3. Conectores | Incorporar la ruta de suscripción elegida | Debate completo real, cancelable y recuperable |
| 4. Interfaz | Editor, vista previa, conversación, diferencias y controles | Observar y dirigir un debate desde una sola ventana |
| 5. Validación en Kubuntu | Instalación, detección de CLI desde KDE, login, persistencia y Wayland/NVIDIA | Ejecutar el flujo completo en este equipo |

Primer MVP: un usuario, dos participantes configurables con los valores pedidos, un debate activo, Markdown local, historial, seis intervenciones, ciclos de observaciones, pausa y recuperación. Se posponen sincronización entre equipos, colaboración multiusuario, aplicaciones móviles y más de dos participantes.

La posibilidad de publicar después se prepara mediante separación de conectores, configuración portable, formatos de proyecto versionados y ausencia de credenciales o rutas personales en el código. No se añade todavía un servidor multiusuario, cobro, cuentas propias ni infraestructura de distribución. El tercer proveedor usará la misma separación cuando se defina.

Las estimaciones de tiempo se fijarán después de la etapa 0: la integración de acceso es la principal incertidumbre y condiciona el esfuerzo real.

## 12. Criterios de aceptación

- El sorteo inicial es equilibrado y se conserva al reiniciar.
- Una fase inicial normal produce exactamente tres intervenciones completas por participante, en alternancia.
- Una observación del usuario produce exactamente una respuesta por participante y después se detiene.
- El segundo participante de cada ciclo recibe el resultado del primero y el plan actualizado.
- Ningún modelo inicia fuera de turno ni implementa el proyecto debatido.
- Cada cambio del plan se atribuye a un turno y conserva su razón y versión anterior.
- Una respuesta incompleta, un parche inválido o una versión obsoleta no dañan `plan.md`.
- Cerrar durante una respuesta permite recuperar el último plan confirmado y el estado pendiente.
- Los errores de login o cuota no consumen un turno lógico ni producen sustituciones silenciosas.
- Un cambio automático de modelo, como el observado de Fable 5.1 a Opus 4.8, se detecta antes de aceptar el turno y modificar el plan.
- La interfaz muestra las discrepancias y no confunde la última palabra con consenso.
- El acceso usa la suscripción seleccionada y se informa cualquier necesidad de consumo adicional antes de activar ese flujo.
- El usuario puede leer y exportar el Markdown sin depender de la aplicación.

## 13. Decisiones confirmadas y pendientes

Confirmado: suscripciones nativas, herramienta personal con posible publicación futura, instalación en este Kubuntu y autorización para pruebas locales. No se necesita volver a preguntar estos puntos.

Recomendación mantenida: Electron + React + TypeScript, Codex App Server por transporte local y Claude Code programático; versiones de clientes registradas y pruebas de compatibilidad antes de actualizarlas. App Server y algunas funciones de planificación se identifican como experimentales en el cliente, por lo que sus cambios deben quedar contenidos en el conector.

Pendientes técnicos:

1. Validar una respuesta efectiva de Fable 5.1, sin confundir una sustitución por Opus con éxito del modelo solicitado.
2. Probar la configuración documentada que impide aceptar modelos alternativos y el comportamiento ante negativas.
3. Validar cancelación, límites de cuota, salida malformada, recuperación de errores y el ciclo completo de seis intervenciones cuando exista el motor.
4. Medir experiencia y consumo de recursos de la interfaz real en KDE/Wayland.

Pendiente para más adelante, por decisión del usuario: identidad, acceso y papel del tercer proveedor. No bloquea la planificación del MVP de dos participantes.

## 14. Resultados de las pruebas locales autorizadas

Pruebas realizadas el 23 de septiembre de 2026. Se utilizaron directorios temporales, solicitudes mínimas y clientes oficiales. No se implementó la aplicación, no se instalaron dependencias y no se modificaron las preferencias globales. Los clientes conservaron sus registros normales de las sesiones de diagnóstico. No se guardan aquí correos, identificadores de cuenta ni credenciales.

### Codex y GPT-6 Astra

- Cliente instalado: `codex-cli 0.156.1`.
- Login: ChatGPT; App Server reportó plan `pro`.
- Consulta del catálogo: `gpt-6-astra` disponible, con `high` entre los esfuerzos admitidos.
- Consulta de modos: preset `plan` disponible.
- Prueba: sesión con `gpt-6-astra`, esfuerzo `high`, planificación nativa, sandbox de solo lectura y sin uso de herramientas durante las respuestas.
- Primera petición: recordar una palabra y devolver una confirmación mínima. Resultado: `FARO OK`, turno completado y eventos de texto progresivo.
- Reanudación: se cerró el proceso App Server, se abrió uno nuevo y se reanudó el mismo hilo. Resultado: `FARO`, manteniendo contexto y configuración High.
- Estado de cuota consultado: uso ordinario permitido. No se activaron créditos ni se cambió la facturación.

Conclusión: el acceso de Astra mediante esta suscripción, el modo Plan, la configuración High, la salida progresiva y la reanudación entre procesos quedaron comprobados para esta prueba mínima. No equivale a validar todavía un debate completo ni a una garantía permanente de cuota.

### Claude Code y solicitud de Fable 5.1

- Cliente instalado: Claude Code `2.1.280`.
- Login: `claude.ai`, proveedor nativo y suscripción `max`; metadatos locales de cuota: Max 20x.
- Configuración solicitada: `claude-fable-5-1`, esfuerzo `high` y modo `plan`. Se deshabilitaron las herramientas y personalizaciones para las pruebas mediante opciones temporales del cliente.
- Dos peticiones mínimas: recordar una palabra y recuperarla al reanudar la misma sesión. Ambas devolvieron texto correcto y eventos de salida progresiva.
- El evento inicial anunciaba Fable 5.1, pero el historial de ambas solicitudes registró `model_refusal_fallback`: el proveedor marcó la categoría `cyber` y cambió a `claude-opus-4-8`. Los mensajes de respuesta también identificaron ese modelo.
- El registro local conservó `permissionMode=plan` y `effort=high`. Los valores describen la configuración de la sesión; no convierten la respuesta de Opus en una respuesta de Fable.
- Los eventos de cuota reportaron uso permitido, `isUsingOverage=false` y `overageDisabledReason=org_level_disabled`.

Conclusión: autenticación nativa, configuración Plan/High, salida progresiva y reanudación de Claude Code comprobadas. **La respuesta efectiva de Fable 5.1 sigue pendiente de validación.** El diagnóstico no determina por qué esas peticiones mínimas activaron la clasificación del proveedor ni demuestra que Fable sea inaccesible para cualquier otra solicitud.

El resumen agregado de uso y el nombre del modelo inicial resultaron insuficientes para atribuir la respuesta. El conector deberá observar los eventos de sustitución y el modelo de los mensajes; cuando la información sea contradictoria, la interfaz mostrará identidad no confirmada y no publicará cambios automáticamente.

### Qué permanece sin probar

No se ejecutaron las seis intervenciones del debate ni ciclos de observaciones sobre un proyecto real. No se forzó el agotamiento de cuotas, no se probaron fallos de red o cancelaciones a mitad de respuesta y no se midió una interfaz de escritorio. Estas verificaciones pertenecen a las siguientes etapas del plan.
