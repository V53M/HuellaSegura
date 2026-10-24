-- Modelo principal de HuellaSegura (v1 web). Ver CLAUDE.md §6.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS fundacion (
  id      BIGSERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL
);

-- Parámetros del motor: los fija la fundación (§5).
CREATE TABLE IF NOT EXISTS parametros_fundacion (
  fundacion_id            BIGINT PRIMARY KEY REFERENCES fundacion(id),
  radio_m_defecto         REAL    NOT NULL DEFAULT 60 CHECK (radio_m_defecto >= 10),
  umbral_permanencia_min  REAL    NOT NULL DEFAULT 20 CHECK (umbral_permanencia_min > 0),
  horas_para_escalar      REAL    NOT NULL DEFAULT 6  CHECK (horas_para_escalar > 0),
  min_sin_senal           REAL    NOT NULL DEFAULT 15 CHECK (min_sin_senal > 0),
  error_m_respaldo        REAL    NOT NULL DEFAULT 48 CHECK (error_m_respaldo >= 0),
  usar_histeresis         BOOLEAN NOT NULL DEFAULT TRUE,   -- para comparar alertas con y sin histéresis
  actualizado_en          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adoptante (
  id         BIGSERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  telefono   TEXT,
  direccion  TEXT
);

CREATE TABLE IF NOT EXISTS animal (
  id            BIGSERIAL PRIMARY KEY,
  fundacion_id  BIGINT NOT NULL REFERENCES fundacion(id),
  nombre        TEXT NOT NULL,
  especie       TEXT NOT NULL CHECK (especie IN ('PERRO', 'GATO', 'OTRO')),
  peso_kg       REAL CHECK (peso_kg > 0),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La adopción guarda la fundación de origen: a ella se enruta toda alerta.
CREATE TABLE IF NOT EXISTS adopcion (
  id              BIGSERIAL PRIMARY KEY,
  animal_id       BIGINT NOT NULL REFERENCES animal(id),
  adoptante_id    BIGINT NOT NULL REFERENCES adoptante(id),
  fundacion_id    BIGINT NOT NULL REFERENCES fundacion(id),
  fecha_entrega   DATE   NOT NULL DEFAULT CURRENT_DATE,
  activa          BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS adopcion_activa_por_animal ON adopcion (animal_id) WHERE activa;

CREATE TABLE IF NOT EXISTS zona_segura (
  adopcion_id     BIGINT PRIMARY KEY REFERENCES adopcion(id),
  centro          GEOGRAPHY(POINT, 4326) NOT NULL,
  radio_m         REAL NOT NULL CHECK (radio_m >= 10),
  actualizada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- dispositivo_uid = identificador en Traccar (normalmente el IMEI)
CREATE TABLE IF NOT EXISTS dispositivo (
  dispositivo_uid  TEXT PRIMARY KEY,
  modelo           TEXT,
  activo           BOOLEAN NOT NULL DEFAULT TRUE
);

-- Un collar pasa de la medición de error al piloto y puede reasignarse: la asignación tiene vigencia.
CREATE TABLE IF NOT EXISTS asignacion_dispositivo (
  id               BIGSERIAL PRIMARY KEY,
  dispositivo_uid  TEXT   NOT NULL REFERENCES dispositivo(dispositivo_uid),
  adopcion_id      BIGINT NOT NULL REFERENCES adopcion(id),
  desde            TIMESTAMPTZ NOT NULL DEFAULT now(),
  hasta            TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS asignacion_vigente_por_disp ON asignacion_dispositivo (dispositivo_uid) WHERE hasta IS NULL;

-- Posiciones tal como llegan (inmutables: son evidencia).
CREATE TABLE IF NOT EXISTS posicion (
  id                   BIGSERIAL PRIMARY KEY,
  traccar_position_id  BIGINT UNIQUE,            -- NULL cuando llega por el endpoint directo (simulador)
  dispositivo_uid      TEXT NOT NULL REFERENCES dispositivo(dispositivo_uid),
  fix_time             TIMESTAMPTZ NOT NULL,
  server_time          TIMESTAMPTZ NOT NULL,
  lat                  DOUBLE PRECISION NOT NULL,
  lon                  DOUBLE PRECISION NOT NULL,
  geom                 GEOGRAPHY(POINT, 4326) NOT NULL,
  precision_m          REAL,
  satelites            SMALLINT,
  velocidad_kn         REAL,
  bateria_pct          REAL,
  valida               BOOLEAN NOT NULL,
  atributos            JSONB,
  recibido_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dispositivo_uid, fix_time)             -- idempotencia también para el endpoint directo
);
CREATE INDEX IF NOT EXISTS posicion_disp_tiempo ON posicion (dispositivo_uid, fix_time DESC);

-- Las posiciones nunca se editan. La supresión (Ley 1581) es un DELETE explícito y auditado.
CREATE OR REPLACE FUNCTION impedir_update_posicion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Las posiciones son inmutables (evidencia): no se permite UPDATE';
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS posicion_inmutable ON posicion;
CREATE TRIGGER posicion_inmutable BEFORE UPDATE ON posicion
  FOR EACH ROW EXECUTE FUNCTION impedir_update_posicion();

CREATE TABLE IF NOT EXISTS evento_conexion (
  id               BIGSERIAL PRIMARY KEY,
  traccar_event_id BIGINT UNIQUE,
  dispositivo_uid  TEXT NOT NULL REFERENCES dispositivo(dispositivo_uid),
  tipo             TEXT NOT NULL,
  ocurrido_en      TIMESTAMPTZ NOT NULL,
  recibido_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS excepcion (
  id           BIGSERIAL PRIMARY KEY,
  adopcion_id  BIGINT NOT NULL REFERENCES adopcion(id),
  motivo       TEXT NOT NULL CHECK (motivo IN ('PASEO', 'VETERINARIA', 'VIAJE')),
  inicio       TIMESTAMPTZ NOT NULL,
  fin          TIMESTAMPTZ NOT NULL,
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fin > inicio)
);
CREATE INDEX IF NOT EXISTS excepcion_adopcion ON excepcion (adopcion_id, fin DESC);

CREATE TABLE IF NOT EXISTS alerta (
  id                       BIGSERIAL PRIMARY KEY,
  adopcion_id              BIGINT NOT NULL REFERENCES adopcion(id),
  fundacion_id             BIGINT NOT NULL REFERENCES fundacion(id),   -- fundación de origen
  creada_en                TIMESTAMPTZ NOT NULL,
  fuera_desde              TIMESTAMPTZ,
  respondida_en            TIMESTAMPTZ,
  respuesta                TEXT,
  escalada_en              TIMESTAMPTZ,
  resuelta_en              TIMESTAMPTZ,
  causa_resolucion         TEXT,          -- VOLVIO · RESPUESTA_ADOPTANTE · CIERRE_FUNDACION
  resultado_verificacion   TEXT CHECK (resultado_verificacion IN ('VERDADERA', 'SALIDA_LEGITIMA', 'ERROR_POSICION'))
);
CREATE INDEX IF NOT EXISTS alerta_fundacion ON alerta (fundacion_id, creada_en DESC);

-- Estado actual del motor: una fila por adopción activa.
CREATE TABLE IF NOT EXISTS estado_seguimiento (
  adopcion_id          BIGINT PRIMARY KEY REFERENCES adopcion(id),
  estado               TEXT NOT NULL DEFAULT 'DENTRO'
                       CHECK (estado IN ('DENTRO','FUERA_EN_GRACIA','EXCEPCION','ALERTA','ESCALADA','SIN_SEÑAL')),
  desde                TIMESTAMPTZ NOT NULL DEFAULT now(),
  fuera_desde          TIMESTAMPTZ,
  estado_previo        TEXT,
  ultimo_reporte       TIMESTAMPTZ,
  ultima_posicion_id   BIGINT REFERENCES posicion(id) ON DELETE SET NULL,
  alerta_id            BIGINT REFERENCES alerta(id)
);

-- Bitácora inmutable de transiciones: evidencia para la fundación y base de las métricas del OE5.
CREATE TABLE IF NOT EXISTS transicion_estado (
  id           BIGSERIAL PRIMARY KEY,
  adopcion_id  BIGINT NOT NULL REFERENCES adopcion(id),
  desde        TEXT NOT NULL,
  hacia        TEXT NOT NULL,
  causa        TEXT NOT NULL,
  posicion_id  BIGINT REFERENCES posicion(id) ON DELETE SET NULL,
  ocurrida_en  TIMESTAMPTZ NOT NULL,
  registrada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transicion_adopcion ON transicion_estado (adopcion_id, ocurrida_en DESC);
