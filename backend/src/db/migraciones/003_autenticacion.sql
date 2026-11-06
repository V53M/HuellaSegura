-- Usuarios, roles, sesiones y consentimiento (Ley 1581 de 2012). Ver contexto del proyecto, §6.2 y §9.

-- Tres roles: la fundación administra y opera; el adoptante solo ve sus propias adopciones.
CREATE TABLE IF NOT EXISTS usuario (
  id               BIGSERIAL PRIMARY KEY,
  correo           TEXT NOT NULL,
  nombre           TEXT NOT NULL,
  rol              TEXT NOT NULL CHECK (rol IN ('ADMIN_FUNDACION', 'PERSONAL_FUNDACION', 'ADOPTANTE')),
  fundacion_id     BIGINT REFERENCES fundacion(id),
  adoptante_id     BIGINT REFERENCES adoptante(id),
  hash_contrasena  TEXT NOT NULL,
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso    TIMESTAMPTZ,
  -- El personal pertenece a una fundación; el adoptante, a su ficha de adoptante.
  CHECK ((rol = 'ADOPTANTE' AND adoptante_id IS NOT NULL AND fundacion_id IS NULL)
      OR (rol <> 'ADOPTANTE' AND fundacion_id IS NOT NULL AND adoptante_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_correo ON usuario (lower(correo));
CREATE UNIQUE INDEX IF NOT EXISTS usuario_por_adoptante ON usuario (adoptante_id) WHERE adoptante_id IS NOT NULL;

-- Sesiones revocables. Solo se guarda el SHA-256 del token: una copia de la base no permite suplantar a nadie.
CREATE TABLE IF NOT EXISTS sesion (
  id           BIGSERIAL PRIMARY KEY,
  usuario_id   BIGINT NOT NULL REFERENCES usuario(id),
  token_hash   BYTEA  NOT NULL UNIQUE,
  cliente      TEXT   NOT NULL CHECK (cliente IN ('WEB', 'MOVIL')),
  creada_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_en     TIMESTAMPTZ NOT NULL,
  revocada_en  TIMESTAMPTZ,
  ip           TEXT,
  agente       TEXT
);
CREATE INDEX IF NOT EXISTS sesion_usuario ON sesion (usuario_id) WHERE revocada_en IS NULL;

-- Autorización del adoptante para el tratamiento de sus datos y de la ubicación del collar.
-- Sin un consentimiento vigente no se guardan ni se procesan las posiciones de sus adopciones.
CREATE TABLE IF NOT EXISTS consentimiento (
  id                 BIGSERIAL PRIMARY KEY,
  adoptante_id       BIGINT NOT NULL REFERENCES adoptante(id),
  version_politica   TEXT   NOT NULL,
  medio              TEXT   NOT NULL CHECK (medio IN ('FORMATO_FIRMADO', 'APP')),
  evidencia          TEXT,          -- referencia del formato firmado, o IP y agente de la app
  registrado_por     BIGINT REFERENCES usuario(id),
  aceptado_en        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocado_en        TIMESTAMPTZ,
  motivo_revocacion  TEXT
);
CREATE INDEX IF NOT EXISTS consentimiento_vigente ON consentimiento (adoptante_id) WHERE revocado_en IS NULL;
