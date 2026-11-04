-- Notificaciones de alerta y su medición de latencia (OE5). Ver contexto del proyecto, §6.2.

-- Instante exacto en que se cumplió cada condición. creada_en y escalada_en son el momento en que el motor
-- lo detectó (en el siguiente tick o posición), así que la diferencia también cuenta como latencia.
ALTER TABLE alerta ADD COLUMN IF NOT EXISTS umbral_cumplido_en   TIMESTAMPTZ;
ALTER TABLE alerta ADD COLUMN IF NOT EXISTS escalada_cumplida_en TIMESTAMPTZ;

-- Tokens de Firebase Cloud Messaging de la app del adoptante (uno por teléfono).
CREATE TABLE IF NOT EXISTS token_push (
  id             BIGSERIAL PRIMARY KEY,
  adoptante_id   BIGINT NOT NULL REFERENCES adoptante(id),
  token          TEXT   NOT NULL UNIQUE,
  plataforma     TEXT   NOT NULL DEFAULT 'ANDROID' CHECK (plataforma IN ('ANDROID', 'WEB')),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  desactivado_en TIMESTAMPTZ,
  motivo_baja    TEXT
);
CREATE INDEX IF NOT EXISTS token_push_adoptante ON token_push (adoptante_id) WHERE activo;

-- Cada envío de una alerta a un destinatario por un canal.
--   condicion_en → enviada_en → entregada_en → leida_en
-- Latencia de alerta (OE5) = entregada_en − condicion_en.
CREATE TABLE IF NOT EXISTS notificacion (
  id             BIGSERIAL PRIMARY KEY,
  alerta_id      BIGINT NOT NULL REFERENCES alerta(id),
  tipo           TEXT   NOT NULL CHECK (tipo IN ('NUEVA', 'ESCALADA')),
  destinatario   TEXT   NOT NULL CHECK (destinatario IN ('ADOPTANTE', 'FUNDACION')),
  canal          TEXT   NOT NULL CHECK (canal IN ('FCM', 'WEB')),
  token_push_id  BIGINT REFERENCES token_push(id),
  condicion_en   TIMESTAMPTZ NOT NULL,   -- umbral o plazo de escalada cumplido
  creada_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_en     TIMESTAMPTZ,            -- aceptada por FCM, o publicada a la web
  entregada_en   TIMESTAMPTZ,            -- acuse del cliente al recibirla
  leida_en       TIMESTAMPTZ,            -- la persona la abrió
  proveedor_id   TEXT,                   -- id del mensaje en FCM
  error          TEXT                    -- SIN_TOKEN, FCM_NO_CONFIGURADO o el error de FCM
);
CREATE INDEX IF NOT EXISTS notificacion_alerta ON notificacion (alerta_id);
