# HuellaSegura — v0.1 (web)

Primera versión del rastreo de animales y zonas seguras: backend con el motor de estados, plataforma web
de la fundación y simulador de trayectorias. El contexto completo del proyecto está en [CLAUDE.md](CLAUDE.md).

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
npm run semilla                      # fundación de demostración + 3 collares simulados
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
npm test        # escenarios del motor sobre trazas sintéticas, con cobertura
```

## Qué hay en esta versión

| Parte | Archivo | Estado |
|---|---|---|
| Modelo de datos (PostGIS) | `backend/src/db/migraciones/001_modelo.sql` | Entidades de §6.1 y §6.2 salvo `usuario`, `notificacion` y `consentimiento` |
| Motor de estados (función pura) | `backend/src/motor/motor.js` | Los 6 estados, histéresis, umbral, excepciones, escalada, sin señal |
| Motor ↔ BD + reloj | `backend/src/motor/servicio.js`, `server.js` | Tick cada `TICK_SEGUNDOS` para lo que depende del tiempo |
| Ingesta | `backend/src/ingesta/ingesta.js` | Traccar (`/ingesta/posiciones`, `/ingesta/eventos`) y OsmAnd directo (`/ingesta/osmand`) |
| API REST | `backend/src/api/rutas.js` | Seguimiento, expediente, zonas, excepciones, alertas, parámetros, exportes CSV, SSE |
| Web de la fundación | `web/` | Mapa en vivo, alta de adopciones, editor de zona, expediente, bandeja de alertas, parámetros |
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

### Decisiones del motor que conviene validar con el director
- **El umbral sigue contando sin señal.** Si el animal salió y el collar se apagó, la alerta igual se genera (queda
  registrada con la causa `UMBRAL_SUPERADO_SIN_SEÑAL`).
- **La respuesta del adoptante abre una nueva ventana de umbral.** Si sigue fuera sin excepción, se vuelve a alertar.
- **Una excepción no apaga una alerta ya emitida.** Para eso el adoptante tiene que responder.
- **Al vencer una excepción estando fuera,** el umbral cuenta desde el fin de la excepción.
- **Una alerta escalada solo la cierra la fundación,** aunque el animal haya vuelto.

## Pendiente para las siguientes versiones
- Autenticación y roles (`usuario`), y consentimiento (Ley 1581). Hoy la API actúa como una única fundación.
- `notificacion` con `enviada_en`, `entregada_en` y `leida_en`, y FCM, para medir la latencia (OE5).
- Traccar en `docker-compose` con el `traccar.xml` de §7.1.
- `openapi.yaml`.
- Supresión auditada de datos.
- App móvil del adoptante (hoy la web simula sus acciones: declarar excepción y responder alerta).
