# HuellaSegura — v0.1 (web)

Primera versión del rastreo de animales y zonas seguras: backend con el motor de estados, plataforma web
de la fundación y simulador de trayectorias. El contexto completo del proyecto está en el documento de anteproyecto.

## Requisitos
- Node.js 20 o superior
- Docker Desktop (para PostgreSQL + PostGIS)

## Arranque local

```bash
docker compose up -d                 # PostGIS en el puerto 5433
cd backend
cp .env.example .env
npm install
npm run migrar
npm run semilla                      # fundación de demostración, 3 collares simulados y cuentas de prueba
npm run dev                          # API en http://localhost:3000
```

En otra terminal:

```bash
cd web
npm install
npm run dev                          # web en http://localhost:5173
```

Y para ver el motor en acción, en una tercera terminal:

```bash
node simulador/simular.js --demo
```

La demo mueve tres collares a la vez: `sim-001` sale y no vuelve a tiempo (alerta y escalada), `sim-002` sale con
una excepción de paseo (no alerta) y `sim-003` tiene saltos de posición por error del GPS (no alerta).

La semilla crea estas cuentas, todas con la contraseña `huella-demo-2027`:

| Cuenta | Rol | Dónde ingresa |
|---|---|---|
| `admin@demo.huellasegura.co` | Administrador de la fundación | Web |
| `personal@demo.huellasegura.co` | Personal de la fundación | Web (y el simulador) |
| `adoptante1@` … `adoptante3@demo.huellasegura.co` | Adoptante | App móvil (`/api/movil`) |

Para el piloto, cree el primer administrador real con
`npm run crear-usuario -- --correo ana@fundacion.org --nombre "Ana Pérez" --fundacion 1` (pide la contraseña).

### Otros escenarios

```bash
node simulador/simular.js --uid sim-001 --escenario salida_corta
```

`dentro` · `salida_corta` · `salida_prolongada` · `con_excepcion` · `saltos` · `sin_senal` · `borde`

Opciones: `--intervalo <s>` (5 por defecto), `--precision <m>` (simula que el collar reporta precisión),
`--destino http://<host>:5055/` (envía a Traccar por OsmAnd en vez de a la API), `--verbose`.

La semilla usa parámetros cortos (umbral de 2 min, escalada a los 3 min, sin señal a los 1,5 min) para ver el ciclo
completo en minutos. Se cambian en la pestaña **Parámetros**.

## Pruebas

```bash
cd backend
npm test                  # motor, notificaciones y autenticación, con cobertura (sin base de datos)
npm run test:integracion  # permisos y consentimiento contra la base de docker compose
```

## Qué hay en esta versión

| Parte | Archivo | Estado |
|---|---|---|
| Modelo de datos (PostGIS) | `backend/src/db/migraciones/001_modelo.sql` | Todas las entidades de §6.1 y §6.2 |
| Motor de estados (función pura) | `backend/src/motor/motor.js` | Los 6 estados, histéresis, umbral, excepciones, escalada, sin señal |
| Motor ↔ BD + reloj | `backend/src/motor/servicio.js`, `server.js` | Tick cada `TICK_SEGUNDOS` para lo que depende del tiempo |
| Ingesta | `backend/src/ingesta/ingesta.js` | Traccar (`/ingesta/posiciones`, `/ingesta/eventos`) y OsmAnd directo (`/ingesta/osmand`) |
| API REST | `backend/src/api/rutas.js` | Seguimiento, expediente, zonas, excepciones, alertas, parámetros, exportes CSV, SSE |
| Web de la fundación | `web/` | Mapa en vivo, alta de adopciones, editor de zona, expediente, bandeja de alertas, parámetros |
| Notificaciones y latencia | `backend/src/notificaciones/` | Push FCM al adoptante, aviso web a la fundación, acuses y métricas (OE5) |
| Autenticación y consentimiento | `backend/src/auth/`, `api/auth.js`, `api/movil.js` | Roles, sesiones revocables, límite de intentos, Ley 1581 |
| Simulador | `simulador/simular.js` | 7 escenarios |

### Ubicar la zona segura por dirección
Al crear una adopción o editar la zona, se puede escribir la dirección del adoptante (`Cra 32A # 12-34`) o
unas coordenadas (`3.4516, -76.5320`) en lugar de marcar el punto en el mapa
(`backend/src/geocodificacion/`, endpoint `GET /api/geocodificar?q=`).

- Una dirección colombiana se ubica por el **cruce de las dos vías** (Carrera 32A con Calle 12), porque el
  nombre de una vía sola se repite en varios barrios de Cali. Si trae placa (`-34`), se avanzan esos metros
  hacia la siguiente vía cruzada.
- El cruce se calcula con la geometría de Nominatim (1–5 s). Si no aparece, se consulta Overpass, que es más
  completo pero a veces tarda 30–45 s.
- Si el cruce existe en varios lugares (p. ej. Cali y Yumbo), la web muestra cada opción con su barrio.
- El sufijo cardinal cuenta: «Calle 5 Oeste» y «Calle 5» son vías distintas.
- Es una ayuda, no una verdad: la fundación debe confirmar el punto y puede ajustarlo con un clic en el mapa.
- Usa los servicios gratuitos de OpenStreetMap, que piden no más de una consulta por segundo, identificarse y
  guardar en caché (todo eso lo hace el backend). Para el piloto conviene poner un correo en
  `GEOCODIFICACION_CONTACTO`.

### Notificaciones y latencia de alerta (OE5)
Cada alerta genera una fila en `notificacion` por destinatario y canal, con cuatro marcas de tiempo:

`condicion_en` (umbral o plazo de escalada cumplido) → `enviada_en` → `entregada_en` (acuse del cliente) → `leida_en`

La **latencia de alerta** es `entregada_en − condicion_en`. Incluye el retardo del tick del motor y el viaje del acuse,
así que es una cota superior honesta.

- **NUEVA** va a la fundación de origen (web, por SSE) y al adoptante (push FCM a cada teléfono registrado).
- **ESCALADA** va solo a la fundación.
- La web acusa cada aviso al recibirlo y lo marca leído al hacer clic. La app móvil debe hacer lo mismo con
  `POST /api/movil/notificaciones/:id/entregada` y `/leida`, usando el `notificacion_id` que llega en los datos de la push.
- Un aviso que no se pudo enviar también queda registrado (`SIN_TOKEN`, `FCM_NO_CONFIGURADO`, `UNREGISTERED`),
  porque cuenta como no entregado en las métricas. Un token que FCM reporta como inválido se da de baja.
- La bandeja de alertas muestra la mediana y el p95 por destinatario (`GET /api/metricas/latencia`), y
  `notificaciones.csv` trae las latencias en segundos para el informe.

**Activar FCM:** en la consola de Firebase, *Configuración del proyecto → Cuentas de servicio → Generar nueva clave
privada*, y poner la ruta del JSON en `FCM_CREDENCIALES` del `.env`. No se sube al repositorio. La app registra su
token con `POST /api/movil/tokens` (`{ "token": "...", "plataforma": "ANDROID" }`).

### Usuarios, roles y consentimiento (Ley 1581)
- **Roles.** *Administrador* y *personal* de la fundación usan la web; el administrador además cambia los
  parámetros y crea cuentas (pestaña **Usuarios**). El *adoptante* usa la app móvil (`/api/movil/...`) y solo ve
  sus propias adopciones. Cada consulta de la web se limita a la fundación del usuario.
- **Sesiones.** Token aleatorio de 256 bits; en la base solo se guarda su SHA-256, así que se puede revocar y una
  copia de la base no sirve para suplantar a nadie. La web lo lleva en una cookie `HttpOnly; SameSite=Strict`
  (12 h); la app lo envía como `Authorization: Bearer` (30 días). Cinco intentos fallidos bloquean ese correo
  desde esa IP durante 15 min. Las contraseñas se guardan con scrypt.
- **Consentimiento.** No se registra una adopción sin la autorización firmada (con la referencia del formato).
  El adoptante también puede aceptarla o revocarla desde la app. **Sin autorización vigente no se guardan las
  posiciones de su collar ni corre el motor**; la fundación sí puede cerrar los casos que hubieran quedado abiertos.
  Un collar sin asignar (medición del error) se sigue registrando, porque no hay datos de ninguna persona.
- **Política.** El texto está en `backend/src/auth/politica.js` y es un **borrador**: lo deben revisar la fundación
  y el director. Al cambiarlo hay que subir `POLITICA_VERSION`; cada consentimiento guarda la versión aceptada.
- **Producción.** Con HTTPS, poner `COOKIE_SEGURA=1`, y `DETRAS_DE_PROXY=1` si va detrás de Nginx.

**API de la app móvil** (todas con `Authorization: Bearer <token>`):

| Método y ruta | Para qué |
|---|---|
| `POST /api/auth/iniciar` `{correo, contrasena, cliente: "MOVIL"}` | Devuelve el token |
| `GET /api/movil/adopciones` | Sus animales: estado, zona, última posición, excepción y alerta abierta |
| `POST /api/movil/adopciones/:id/excepciones` `{motivo, duracion_min}` | Declarar paseo, veterinaria o viaje |
| `POST /api/movil/alertas/:id/responder` `{respuesta}` | Responder una alerta |
| `GET` · `POST` · `DELETE /api/movil/consentimiento` | Ver la política, aceptarla (`{version}`) o revocarla |
| `POST /api/movil/tokens` `{token, plataforma}` | Registrar el token de FCM |
| `POST /api/movil/notificaciones/:id/entregada` · `/leida` | Acuses para medir la latencia |
| `POST /api/auth/contrasena` `{actual, nueva}` · `POST /api/auth/salir` | Cambiar la contraseña temporal · cerrar sesión |

### Decisiones del motor que conviene validar con el director
- **El umbral sigue contando sin señal.** Si el animal salió y el collar se apagó, la alerta igual se genera (queda
  registrada con la causa `UMBRAL_SUPERADO_SIN_SEÑAL`).
- **La respuesta del adoptante abre una nueva ventana de umbral.** Si sigue fuera sin excepción, se vuelve a alertar.
- **Una excepción no apaga una alerta ya emitida.** Para eso el adoptante tiene que responder.
- **Al vencer una excepción estando fuera,** el umbral cuenta desde el fin de la excepción.
- **Una alerta escalada solo la cierra la fundación,** aunque el animal haya vuelto.

## Pendiente para las siguientes versiones
- Traccar en `docker-compose` con el `traccar.xml` de §7.1.
- `openapi.yaml`.
- Supresión auditada de datos.
- App móvil del adoptante (la API ya está lista en `/api/movil`; hoy la fundación registra por la web lo que el adoptante le comunica por teléfono).
