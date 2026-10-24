# HuellaSegura — Contexto del proyecto para el desarrollo

> Documento de arranque para el código. Pónganlo en la raíz del repositorio. Si usan Claude Code, guárdenlo también como `CLAUDE.md`: así cualquier sesión lo lee antes de tocar el código.
> Última consolidación: 24-oct-2026. Marcas: **[DECIDIDO]** ya acordado · **[PROPUESTO]** recomendado, falta confirmar · **[PENDIENTE]** sin definir.

---

## 1. Qué es el proyecto

**HuellaSegura: sistema de seguimiento georreferenciado para la detección temprana del abandono de animales de compañía entregados en adopción por fundaciones de Santiago de Cali.**

- **Equipo:** Michael Esteban García Díaz (cód. 148910) y Víctor Manuel Marín Marín (cód. 148919). Ingeniería de Sistemas, Universidad ECCI. Director: Ing. David Escobar.
- **Problema:** las fundaciones entregan animales en adopción y pierden toda visibilidad después de la entrega. Ningún indicador público mide lo que pasa tras la adopción.
- **Solución:** un collar GPS 4G comercial reporta posiciones; un backend propio evalúa si el animal está dentro de su **zona segura** y, si permanece fuera más allá de un umbral sin excepción declarada, alerta al adoptante y a la **fundación de origen**.
- **Aporte original (lo que hay que defender ante el jurado):** la combinación de **umbral de permanencia + excepción declarada + enrutamiento de la alerta a la fundación de origen**. Las geocercas por sí solas no son el aporte.
- **Principio rector:** *el sistema no declara abandono*. Produce evidencia trazable para que la fundación decida. El criterio legal de abandono son 30 días calendario sin reclamación (Ley 2054 de 2020).

### Objetivo general
Desarrollar un prototipo funcional de sistema de seguimiento georreferenciado, con una aplicación móvil para adoptantes, una plataforma web para fundaciones y un dispositivo comercial de geolocalización, que permita seguir a los animales entregados en adopción por fundaciones de Santiago de Cali y generar alertas tempranas ante posible pérdida o abandono.

### Objetivos específicos (cada uno se traduce en código o datos)
| OE | Enunciado | Qué implica en el desarrollo |
|---|---|---|
| OE1 | Caracterizar el seguimiento posadopción de al menos una fundación de Cali | Requisitos y modelo BPMN del proceso actual (no es código, alimenta el backlog) |
| OE2 | Diseñar la arquitectura y el modelo de datos relacional (animales, adoptantes, zonas seguras, excepciones, alertas) | Esquema PostgreSQL/PostGIS, `openapi.yaml`, documento de arquitectura |
| OE3 | Implementar las zonas seguras y el motor de alertas por umbral de permanencia con excepciones | **Núcleo del proyecto:** ingesta + máquina de estados + enrutamiento de alertas |
| OE4 | Desarrollar la app móvil (adoptantes) y la plataforma web (fundación) | Clientes que consumen la API REST |
| OE5 | Validar con un piloto: precisión, latencia de alerta, falsos positivos y usabilidad | Instrumentación: marcas de tiempo, bitácora de transiciones, exportes para análisis |

---

## 2. Definiciones operativas (úsenlas tal cual en el código y en la BD)

| Término | Definición | Nombre sugerido en código |
|---|---|---|
| Zona segura | Círculo con centro en el domicilio registrado del adoptante y un radio en metros | `zona_segura` (centro `geography(Point)`, `radio_m`) |
| Umbral de permanencia | Tiempo continuo máximo fuera de la zona antes de alertar. **Lo parametriza la fundación** | `umbral_permanencia_min` |
| Excepción declarada | Aviso del adoptante desde el móvil por una salida legítima (paseo, veterinaria, viaje). Suspende las alertas de forma temporal y acotada | `excepcion` (`motivo`, `inicio`, `fin`) |
| Alerta | Notificación automática al adoptante y a la fundación cuando se supera el umbral sin excepción vigente | `alerta` |
| Escalada | Alerta sin respuesta del adoptante tras X horas; pasa a manos de la fundación | estado `ESCALADA` |
| Sin señal | El collar deja de reportar durante N minutos, desde cualquier estado | estado `SIN_SEÑAL` |
| Abandono | Lo determina la fundación, nunca el sistema. Referencia: 30 días (Ley 2054 de 2020) | — |

---

## 3. Arquitectura [DECIDIDO salvo donde se indica]

```
Collar TK911 Pro 4G ──trama TCP (watch, puerto 5093)──▶ Traccar ──HTTP POST JSON──▶ API HuellaSegura (Node/Express)
   (configurado por SMS)                               decodifica    /ingesta/posiciones        │
                                                       y filtra      /ingesta/eventos           ▼
                                                                                      PostgreSQL + PostGIS
                                                                                                │
                                                                         Motor de estados (motor.js) ──▶ Alertas
                                                                                                │        ├─▶ Push FCM → app del adoptante
                                                                                                │        └─▶ Plataforma web de la fundación
                                                                         API REST (OpenAPI) ◀── App móvil · Plataforma web
```

**Decisiones de arquitectura que deben respetarse:**
1. **Traccar solo como capa de ingesta.** Recibe y decodifica las tramas y las reenvía a nuestra API. **No usamos sus geocercas ni sus notificaciones:** toda la lógica de zona segura vive en nuestro backend. Ventaja que hay que decir en el documento: cambiar de collar solo cambia la configuración por SMS y el puerto; ingesta, BD y motor quedan iguales. *(La alternativa, un decodificador propio, está **[PENDIENTE]** en la bitácora 7.4; la recomendación es no hacerlo, porque no forma parte del aporte y consume sprints).*
2. **La lógica de geocercas va en el servidor, no en el dispositivo.** Así la fundación cambia parámetros sin tocar el hardware y cada decisión del motor queda auditable.
3. **Las posiciones son inmutables** (son evidencia): nunca se hace `UPDATE`. La única excepción es la supresión de datos exigida por la Ley 1581 (ver §9).
4. **Inserción idempotente:** Traccar reintenta, así que la misma posición puede llegar dos veces. `UNIQUE (traccar_position_id)` + `ON CONFLICT DO NOTHING`, y solo se procesan las posiciones nuevas.
5. **Responder 200 rápido a Traccar** y procesar el motor después (`setImmediate` o una cola). Si la BD falla, responder 500 para que Traccar reintente.
6. **Distancias con PostGIS** (`ST_Distance`/`ST_DWithin` sobre `geography`) o Haversine en Node. PostGIS sirve además para las consultas de la plataforma (últimas posiciones antes de perder señal, recorridos).

---

## 4. Stack tecnológico

| Capa | Tecnología | Estado |
|---|---|---|
| Ingesta GPS | Traccar (Java, Apache 2.0). Última versión verificada: 6.15.3 (26-ago-2026) | [DECIDIDO] |
| Backend | Node.js 20+ con Express; API REST documentada con OpenAPI (Swagger) | [DECIDIDO] |
| Base de datos | PostgreSQL + PostGIS. Base `huellasegura` separada de la base `traccar` (pueden compartir servidor) | [DECIDIDO] |
| Web (fundaciones) | React + MapLibre GL + OpenStreetMap | [DECIDIDO] |
| Móvil (adoptantes) | React Native **o** Flutter. Solo Android en el piloto, distribuida por prueba interna de Google Play | **[PENDIENTE]** el framework |
| Notificaciones | Firebase Cloud Messaging (plan gratuito) | [DECIDIDO] |
| Pruebas | Unitarias con cobertura ≥ 70 % sobre la lógica de negocio; aceptación como escenarios ejecutables definidos antes de cada sprint | [DECIDIDO] |
| Infraestructura | VPS 2 vCPU / 4 GB RAM (Traccar + API + motor + PostgreSQL), dominio .co, HTTPS con Let's Encrypt | [DECIDIDO] |
| Gestión | Scrum, sprints de 2 semanas, Git/GitHub, Jira o Trello, Figma, Zotero | [DECIDIDO] |

Todo el software es gratuito; el único pago es Google Play (US$25, una vez). iOS queda fuera (requiere Mac y US$99/año).

---

## 5. Motor de alertas: máquina de estados (OE3, el corazón del proyecto) [PROPUESTO, falta escribir `motor.js`]

Cada adopción activa está en **un solo estado**. Cada transición se guarda con su causa y su marca de tiempo: ese registro es la evidencia de la fundación y la base de las métricas del OE5.

| Estado | Entra cuando | Sale cuando |
|---|---|---|
| `DENTRO` | La posición está **confiablemente** dentro del radio | Sale confiablemente → `FUERA_EN_GRACIA` |
| `FUERA_EN_GRACIA` | Salió; empieza a contar el umbral de permanencia | Vuelve → `DENTRO` · el adoptante declara excepción → `EXCEPCION` · se supera el umbral → `ALERTA` |
| `EXCEPCION` | El adoptante reportó paseo, veterinaria o viaje | Vence estando fuera → `FUERA_EN_GRACIA` · vuelve → `DENTRO` |
| `ALERTA` | Se superó el umbral sin excepción vigente; se notifica al adoptante **y** a la fundación de origen | El adoptante responde o el animal vuelve · sin respuesta en X horas → `ESCALADA` |
| `ESCALADA` | No hubo respuesta del adoptante | Solo la cierra la fundación. El sistema acumula días hacia el criterio de 30 días, pero **no declara abandono** |
| `SIN_SEÑAL` | No llegan reportes durante N minutos, desde cualquier estado (eventos `deviceUnknown`/`deviceOffline` de Traccar) | Vuelve a reportar → se reevalúa |

**Por qué `SIN_SEÑAL` importa:** quien abandona puede quitar el collar o dejar que se descargue. Perder la señal estando fuera, o justo después de salir, es evidencia y debe pesar en la plataforma.

### Manejo del error del GPS (obligatorio en el motor)
El p95 del error horizontal puede llegar a **47,8 m** en trama urbana densa (Gutierrez et al., 2025). Por eso:
1. **Histéresis, no un borde único:**
   - fuera solo si `distancia − error > radio`
   - dentro solo si `distancia + error < radio`
   - en medio, se mantiene el estado anterior.
   `error` = precisión reportada por el collar si existe; si no (el TK911 Pro puede no reportarla), el **p95 medido en Cali** durante los sprints 4 y 5, guardado como parámetro.
2. **El umbral de permanencia también filtra falsos positivos:** un salto aislado de 50 m no dispara nada si el umbral exige, por ejemplo, 20 minutos continuos fuera.
3. **Descartar posiciones de baja calidad:** `valid = false`, pocos satélites o precisión mala no cambian el estado (se guardan igual, porque son evidencia).
4. **El radio por defecto no puede ser menor que el error esperado.** El radio y el umbral se fijan con datos medidos (hito H3, sprint 5).

### Parámetros del motor [PENDIENTE: valores finales tras la medición]
| Parámetro | Quién lo fija | Valor de arranque sugerido |
|---|---|---|
| `radio_m` por defecto | Fundación, con datos de error | ≥ p95 medido (no menos de ~50 m hasta medir) |
| `umbral_permanencia_min` | Fundación | 20 min (ejemplo de la bitácora) |
| `horas_para_escalar` (X) | Fundación | por definir |
| `min_sin_senal` (N) | Equipo, según el intervalo de reporte | 15 min (`status.timeout = 900` en Traccar) |
| `error_m` de respaldo | Equipo | p95 medido en Cali |
| Calidad mínima | Equipo | `valid = true`; satélites/precisión según lo que reporte el collar |

### Resultado propio para la sustentación
Comparar el número de alertas **con y sin histéresis** sobre las mismas trazas del piloto.

---

## 6. Modelo de datos

### 6.1 Entidades acordadas en la metodología (OE2)
`animal`, `adoptante`, `fundacion`, `adopcion`, `dispositivo`, `zona_segura`, `posicion`, `excepcion`, `alerta`.

### 6.2 Entidades adicionales que necesita el código [PROPUESTO]
- `usuario` con rol (`ADMIN_FUNDACION`, `PERSONAL_FUNDACION`, `ADOPTANTE`): acceso restringido por rol, como exige la Ley 1581.
- `parametros_fundacion`: radio por defecto, umbral, horas para escalar.
- `estado_seguimiento`: estado actual del motor por adopción (una fila por adopción activa).
- `transicion_estado`: bitácora inmutable de cada cambio de estado (desde, hacia, causa, posición que la causó, marca de tiempo).
- `notificacion`: cada envío de una alerta, con `enviada_en`, `entregada_en` y `leida_en` para medir la latencia.
- `evento_conexion`: eventos de Traccar (`deviceOnline`/`deviceOffline`/`deviceUnknown`).
- `consentimiento`: autorización del adoptante (versión de la política, fecha y evidencia).

La relación clave para el aporte es **alerta → adopción → fundación de origen**: la alerta siempre se enruta a la fundación que entregó al animal.

### 6.3 Tablas de ingesta ya escritas (`schema_ingesta.sql`)
```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- dispositivo_uid = identificador del dispositivo en Traccar (normalmente el IMEI)
CREATE TABLE IF NOT EXISTS dispositivo (
  dispositivo_uid  TEXT PRIMARY KEY,
  mascota_id       BIGINT NOT NULL,            -- FK a animal en el modelo principal
  modelo           TEXT,
  activo           BOOLEAN NOT NULL DEFAULT TRUE
);

-- Posiciones tal como llegan de Traccar (inmutables)
CREATE TABLE IF NOT EXISTS posicion (
  id                   BIGSERIAL PRIMARY KEY,
  traccar_position_id  BIGINT UNIQUE NOT NULL,  -- idempotencia ante reintentos
  dispositivo_uid      TEXT NOT NULL REFERENCES dispositivo(dispositivo_uid),
  fix_time             TIMESTAMPTZ NOT NULL,    -- hora del GPS
  server_time          TIMESTAMPTZ NOT NULL,    -- llegada a Traccar (latencia)
  lat                  DOUBLE PRECISION NOT NULL,
  lon                  DOUBLE PRECISION NOT NULL,
  geom                 GEOGRAPHY(POINT, 4326) NOT NULL,
  precision_m          REAL,                    -- NULL si el collar no la reporta
  satelites            SMALLINT,
  velocidad_kn         REAL,
  bateria_pct          REAL,
  valida               BOOLEAN NOT NULL,
  atributos            JSONB,                   -- el resto de lo que mande el collar
  recibido_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posicion_disp_tiempo ON posicion (dispositivo_uid, fix_time DESC);

CREATE TABLE IF NOT EXISTS evento_conexion (
  id               BIGSERIAL PRIMARY KEY,
  traccar_event_id BIGINT UNIQUE,
  dispositivo_uid  TEXT NOT NULL REFERENCES dispositivo(dispositivo_uid),
  tipo             TEXT NOT NULL,
  ocurrido_en      TIMESTAMPTZ NOT NULL,
  recibido_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Nota: conviene que `dispositivo` apunte a la **adopción** activa (o tener una tabla `asignacion_dispositivo` con vigencia), porque un mismo collar pasa de la medición de error al piloto y puede reasignarse.

---

## 7. Integración con Traccar

### 7.1 `traccar.xml` (claves ya definidas; ruta `/opt/traccar/conf/traccar.xml`)
| Clave | Valor | Para qué |
|---|---|---|
| `database.url` | `jdbc:postgresql://localhost:5432/traccar` | Base propia de Traccar, distinta de `huellasegura` |
| `database.saveOriginal` | `true` | Guarda la trama hex como evidencia |
| `forward.type` | `json` | Reenvío de posiciones |
| `forward.url` | `https://api.huellasegura.co/ingesta/posiciones` | Endpoint de ingesta |
| `forward.header` | `X-Traccar-Secret: <secreto largo>` | Solo Traccar puede llamar a la ingesta |
| `forward.retry.enable` / `.count` / `.limit` | `true` / `10` / `1000` | No perder posiciones si la API se reinicia |
| `event.forward.type` / `.url` / `.header` | `json` / `.../ingesta/eventos` / mismo secreto | Reenvío de eventos |
| `event.status.enable` | `true` | Genera `deviceOnline` / `deviceOffline` / `deviceUnknown` → `SIN_SEÑAL` |
| `status.timeout` | `900` | 15 min sin datos → desconocido. Ajustar al intervalo de reporte |
| `filter.enable`, `filter.invalid`, `filter.zero`, `filter.duplicate` | `true` | Filtros de calidad antes de reenviar |
| `filter.future` | `86400` | Descarta posiciones con fecha futura |

Puertos: abrir en el firewall solo **5093** (protocolo watch del TK911 Pro) y **5055** (OsmAnd, para el simulador y Traccar Client).

### 7.2 Endpoints de ingesta (`ingesta.js`, ya escrito; importa `procesarPosicion` y `procesarConexion` de `motor.js`)
- `POST /ingesta/posiciones` — cuerpo `{ position, device }`. Valida `X-Traccar-Secret`, inserta con `ON CONFLICT DO NOTHING`, responde 200 y, si la fila es nueva, llama `procesarPosicion(device.uniqueId, posicionId)`.
- `POST /ingesta/eventos` — cuerpo `{ event, position|null, device }`. Solo guarda los eventos de conexión y llama `procesarConexion(device.uniqueId, event.type)`.
- Campos usados de Traccar: `position.id`, `fixTime`, `serverTime`, `latitude`, `longitude`, `accuracy`, `speed` (en nudos), `valid`, `attributes.sat`, `attributes.batteryLevel`; `device.uniqueId`.
- **Antes de producción:** registrar el JSON real de la primera posición del TK911 Pro y confirmar los nombres de los atributos. Cada protocolo reporta atributos distintos; los que falten se guardan como nulos.

### 7.3 Pruebas sin hardware
Traccar acepta el protocolo **OsmAnd en el puerto 5055** (`GET/POST http://<host>:5055/?id=<uid>&lat=..&lon=..&timestamp=..&accuracy=..`). Con la app **Traccar Client** o con un script **simulador de trayectorias** se reproducen los escenarios del motor:
- salida corta (vuelve antes del umbral),
- salida prolongada (debe alertar),
- salida con excepción vigente (no debe alertar),
- saltos de posición por error de medición (no deben alertar),
- pérdida de señal fuera de la zona (`SIN_SEÑAL`).

Las mismas trazas, reproducibles, sirven para medir falsos positivos con y sin histéresis.

---

## 8. Hardware y conectividad

### 8.1 Collar: TKSTAR TK911 Pro 4G, versión SA ("TK911pro-4GSA") [DECIDIDO]
| Dato | Valor |
|---|---|
| Red | LTE-FDD B1/B2/B3/B4/B5/B7/B8/B28/B66 + GSM 850/900/1800/1900 (cubre a Claro, Tigo, Movistar y WOM) |
| Peso y tamaño | 41 g; 75 × 29 × 18 mm |
| Batería | Li-ion 700 mAh, hasta 7 días en reposo; carga 5 V/1 A con cable propietario |
| Protocolo Traccar | **watch, puerto 5093** (mensajes que empiezan por "911") |
| Intervalo por defecto | `UPLOAD:60` (60 s) |
| Identificador en Traccar | El ID impreso en la parte de atrás del equipo |
| Firmware reportado | `TK911-Pro (70SALASE_V_4.0 2023/12/01)` |
| Incluye | Soporte para collar, cable de carga y destornillador (no incluye el collar) |

**Comandos SMS conocidos** (contraseña por defecto `123456`):
```
admin123456 <número_admin>          # registra el celular administrador
adminip123456 <IP_o_dominio> 5093   # apunta el collar a nuestro Traccar
upload123456 <segundos>             # intervalo de reporte
timezone123456 -5                   # zona horaria de Colombia
sleep123456 off                     # desactiva el modo de reposo
gprs123456                          # activa el envío por datos
check123456 / imei123456            # consulta configuración e IMEI
```
- Después de `adminip`, el collar **deja de reportar a la nube de TKSTAR**: no dependemos de su app ni de suscripciones.
- **[PENDIENTE]** el comando de APN y el APN de la SIM: confirmarlo con la primera unidad.
- Riesgo conocido: un usuario de Traccar reportó que no pudo cambiar el intervalo (posiciones cada ~3 s). Si pasa, el consumo de datos sube (ver 8.2).
- Al comprar en AliExpress, elegir explícitamente la variante **4GSA**: las publicaciones mezclan versiones 2G y 4G como "colores".

### 8.2 SIM y datos [PROPUESTO en el presupuesto]
- **Kalley Móvil** (operador virtual sobre la red 4G de Tigo): SIM a $11.000, con SMS a $10 y **datos por demanda a $40/MB** (se activa con `*733#`).
- Consumo estimado: ~25 MB al mes por collar con reporte cada 60 s; ~150 MB con reporte cada 10 s.
- Plan B si el intervalo no se puede subir: un paquete de 30 días (Kalley Vívelo Full, $22.900, o Claro Todo Incluido, $24.000).
- El 2G está prácticamente apagado en Colombia: no usar equipos solo 2G.

### 8.3 Bienestar animal
El conjunto collar + soporte + rastreador **no puede superar el 2 % del peso corporal** (Coughlin y van Heezik, 2015). Con 41 g más ~30 g de soporte y collar, el **peso mínimo del animal es ≈ 3,6 kg**. El uso se suspende ante cualquier signo de estrés, con valoración del personal veterinario de la fundación. Conviene guardar el peso del animal y validar esta regla al asignar un collar.

### 8.4 Alternativa descartada o en espera
- Eview EV-206M (19 g, LTE-M/NB-IoT): **opcional**. Depende de una cobertura LTE-M en Cali que no está verificada y no tiene precio público.
- Mictrack MT825: descartado (no tiene B7).
- Collar propio con ESP32 (LilyGO T-SIM7080G-S3): **fuera de alcance**. Como mucho, simulador.

---

## 9. Datos personales (Ley 1581 de 2012) — requisitos que afectan el código
- **Consentimiento informado** firmado por cada adoptante **antes** de activar el seguimiento: guardarlo con versión y fecha (`consentimiento`).
- **Finalidad limitada** al seguimiento posadopción y **minimización** de los datos.
- **Acceso restringido por rol:** el adoptante ve solo su animal; la fundación ve solo sus adopciones.
- **Cifrado** en tránsito (HTTPS) y en reposo.
- Derechos de **conocer, actualizar, rectificar y suprimir:** procedimiento documentado. Al terminar el piloto se ofrece la supresión.
- **Tensión de diseño:** las posiciones son inmutables (no se editan), pero deben poder **suprimirse o anonimizarse** al ejercer el derecho de supresión. Implementar la supresión como una operación explícita y auditada, no como un `UPDATE`.

---

## 10. Métricas del OE5: el código debe dejarlas medibles
| Métrica | Cómo se mide | Datos que hay que guardar |
|---|---|---|
| Precisión | Error horizontal frente a puntos de control (domicilio y 2 puntos exteriores por caso), reportado como mediana y p95 | Posiciones crudas + coordenadas de los puntos de control |
| Latencia de alerta | Desde que se cumple la condición de umbral hasta que la notificación se recibe, en ambos destinatarios | `transicion_estado.ocurrida_en`, `notificacion.enviada_en`, `entregada_en`, `leida_en` (relojes sincronizados) |
| Falsos positivos y negativos | Alertas que, verificadas por teléfono con el adoptante, eran salidas legítimas o error de posición | Campo de resultado de la verificación en `alerta` |
| Usabilidad | Escala SUS aplicada a adoptantes y a la fundación (escala adjetival de Bangor et al.) | Fuera del sistema (formularios) |

El análisis es descriptivo y exploratorio: percentiles, e intervalos de confianza del 95 % por el método de Wilson. Conviene un endpoint o script de **exportación** (CSV) de posiciones, transiciones y alertas.

---

## 11. Funcionalidades por cliente (OE4)

**App móvil del adoptante** [PROPUESTO]
- Iniciar sesión y aceptar el consentimiento.
- Ver en el mapa la última posición y la zona segura de su animal.
- **Declarar una excepción** (paseo, veterinaria o viaje, con duración acotada).
- Recibir alertas push (FCM) y **responder** a una alerta, lo que cierra el estado `ALERTA`.
- Ver la batería del collar y avisos de "sin señal".

**Plataforma web de la fundación** [PROPUESTO]
- Gestión de animales, adoptantes, adopciones y asignación de collares.
- Definición de la zona segura (centro y radio en el mapa) y de los parámetros (umbral, horas para escalar).
- Tablero de estados en tiempo casi real, con mapa (MapLibre + OSM).
- Bandeja de alertas y escaladas; cierre del caso por parte de la fundación.
- **Expediente de evidencia:** recorrido, transiciones, excepciones y pérdidas de señal de cada adopción.
- Exportes para el OE5.

---

## 12. Estructura de repositorio sugerida [PROPUESTO]
```
huellasegura/
├── CONTEXTO_HuellaSegura.md   (este archivo; o CLAUDE.md)
├── docker-compose.yml        # postgres+postgis, traccar, api (entorno local)
├── traccar/
│   └── traccar.xml
├── backend/
│   ├── src/
│   │   ├── ingesta/          # ingesta.js (endpoints de Traccar)
│   │   ├── motor/            # motor.js (máquina de estados) + pruebas
│   │   ├── api/              # rutas REST para web y móvil
│   │   ├── notificaciones/   # FCM y avisos a la fundación
│   │   └── db/               # migraciones (schema_ingesta.sql y modelo principal)
│   └── test/                 # unitarias (≥ 70 % en la lógica) y escenarios de aceptación
├── simulador/                # trayectorias sintéticas contra OsmAnd :5055
├── web/                      # React + MapLibre
├── movil/                    # React Native o Flutter (pendiente)
└── docs/
    ├── openapi.yaml
    ├── modelo_er.md
    └── arquitectura.md
```

**Orden recomendado para arrancar el código:**
1. `docker-compose` con PostgreSQL/PostGIS y Traccar en local.
2. Migraciones: modelo principal + `schema_ingesta.sql`.
3. `ingesta.js` funcionando contra Traccar.
4. **Simulador** de trayectorias por OsmAnd (puerto 5055), para no depender del hardware.
5. **`motor.js`** (máquina de estados) con sus pruebas sobre trazas sintéticas. Es el aporte original: debe estar validado con el simulador para el hito H4 (sprint 8).
6. `openapi.yaml` y la API REST; después, la web y la app.

---

## 13. Cronograma (Scrum, 16 sprints de 2 semanas)
- **Fase 0 (oct 2026 – ene 2027):** aprobación del anteproyecto, acta con la fundación (bloqueante), verificación de cobertura y bandas, compra e importación de los collares (3 a 6 semanas de envío).
- **Sprint 1 empieza el 1-feb-2027; el sprint 16 termina el 12-sep-2027.**

| Sprints | Actividad |
|---|---|
| S1 | Montaje de VPS, dominio, Traccar, repositorio y tablero Scrum |
| S1–S3 | Entrevistas en la fundación, modelado del proceso, requisitos, formato de autorización de datos |
| S3–S4 | Arquitectura, modelo de datos con PostGIS, `openapi.yaml` |
| S4–S5 | Medición del error de posición en Cali (p50/p95); fijar el radio y el umbral con datos |
| S5 | Ingesta de posiciones y eventos desde Traccar |
| S5–S7 | Motor de estados (umbral, excepción, histéresis, `SIN_SEÑAL`) |
| S6–S7 | Simulador de trayectorias y pruebas automatizadas; diseño UX/UI en Figma |
| S7–S8 | Enrutamiento de alertas al adoptante y a la fundación de origen |
| S8–S11 | Plataforma web y app móvil |
| S11–S12 | Integración y pruebas de extremo a extremo |
| S12 | Preparación del piloto (selección de animales por peso, autorizaciones, instalación) |
| S13–S15 | Piloto y medición |
| S15–S16 | Análisis, documento final y sustentación |

**Hitos:** H1 collares recibidos y entorno operativo (fin de S1, 14-feb-2027) · H2 requisitos, arquitectura y modelo aprobados (S4, 28-mar) · H3 radio y umbral fijados con datos (S5, 11-abr) · **H4 motor validado con el simulador (S8, 23-may)** · H5 sistema integrado (S12, 18-jul) · H6 fin del piloto (S15, 29-ago) · H7 entrega del documento (S16, 12-sep-2027).

Como el desarrollo empieza en la fase 0, adelantar los pasos 1 a 5 del §12 desde ya reduce el riesgo del cronograma.

---

## 14. Presupuesto de materiales vigente
Escenario actual (`Presupuesto_Materiales_HuellaSegura.xlsx`): **2 rastreadores para 2 mascotas, sin unidad de reposición.** Los mismos collares miden primero el error (S4–S11) y luego van al piloto (S12–S16).
- Total con 10 % de imprevistos: **$572.185 COP** (rastreadores $387.924; IVA de importación $73.706, en un solo envío de menos de US$200 FOB, sin arancel; SIM y datos $35.239; collares $23.300).
- Riesgo: si un rastreador falla, el piloto queda con un solo animal. Sumar uno de reposición sube el total a ≈ $878.571.

---

## 15. Fuera de alcance
Hardware o firmware propio; monitoreo fisiológico o conductual; telemedicina, historia clínica o donaciones; despliegue en producción y comercialización; iOS en el piloto; valoración jurídica de procesos sancionatorios (competencia de las autoridades distritales).

---

## 16. Pendientes que afectan el código
- **Bloqueante:** acta o carta de compromiso con la fundación aliada (acceso a adoptantes, consentimiento y recepción de alertas).
- **[PENDIENTE]** framework móvil: React Native o Flutter.
- **[PENDIENTE]** confirmar Traccar como ingesta (la recomendación) frente a un decodificador propio.
- **[PENDIENTE]** valores de `radio_m`, `umbral_permanencia_min`, `horas_para_escalar` y `min_sin_senal`: salen de la medición (H3) y de la fundación.
- **[PENDIENTE]** número final de mascotas del piloto (escenario actual: 2; la bitácora proponía de 5 a 10).
- **[PENDIENTE]** APN y comando de APN del TK911 Pro con la SIM elegida; JSON real de la primera posición.
- Redactar el requisito del dispositivo como **"protocolo soportado por Traccar y servidor configurable (IP y puerto)"**, no como "GT06/JT808".

---

## 17. Referencias técnicas
- Traccar, referencia del archivo de configuración: https://www.traccar.org/configuration-file/
- TK911 Pro 4G con Traccar (foro): https://www.traccar.org/forums/topic/pet-tracker-tk911-pro-4g-working-solution-with-home-assistant/
- TK911 Pro, ficha del fabricante: https://tkstargps.com/Product/tkstarwinnespetgpstrackertk911pro.html
- Kalley Móvil, tarifas prepago: https://www.kalleymovil.com.co/prepago
- Marco legal: Ley 1774 de 2016 (animales como seres sintientes), Ley 2054 de 2020 (30 días para declarar abandono), Ley 1581 de 2012 (protección de datos).
- Error GPS urbano: Gutierrez et al. (2025). Peso del collar en gatos: Coughlin y van Heezik (2015). Usabilidad: Lewis (2018); Bangor et al. (2009).
