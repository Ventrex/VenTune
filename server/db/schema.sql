-- =====================================================================
-- VenTune — databaseschema (PostgreSQL 16)
-- =====================================================================
-- Dit script is idempotent: het kan veilig meerdere keren draaien.
-- De server is de bron van waarheid voor spelstate; de tabellen hier
-- bewaren de vragenbank, presets, lobbies, spelers en rondes.
-- =====================================================================

-- Extensie voor UUID-generatie (gen_random_uuid).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- ENUM-types (met guards zodat herhaald draaien geen fout geeft)
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'titel_type') THEN
        CREATE TYPE titel_type AS ENUM ('film', 'serie');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'titel_taal') THEN
        CREATE TYPE titel_taal AS ENUM ('nl', 'en');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'lobby_status') THEN
        CREATE TYPE lobby_status AS ENUM ('wachten', 'bezig', 'afgelopen');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ronde_status') THEN
        CREATE TYPE ronde_status AS ENUM ('wachten', 'raden', 'bonus', 'afgelopen');
    END IF;
END$$;

-- ---------------------------------------------------------------------
-- Vragenbank: titels
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS titels (
    id             SERIAL PRIMARY KEY,
    naam           TEXT        NOT NULL,
    aliassen       TEXT[]      NOT NULL DEFAULT '{}',
    type           titel_type  NOT NULL,
    taal           titel_taal  NOT NULL,
    jaar           INTEGER,
    land           TEXT,
    genres         TEXT[]      NOT NULL DEFAULT '{}',
    tmdb_id        INTEGER,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_titels_type    ON titels (type);
CREATE INDEX IF NOT EXISTS idx_titels_taal    ON titels (taal);
CREATE INDEX IF NOT EXISTS idx_titels_jaar    ON titels (jaar);
CREATE INDEX IF NOT EXISTS idx_titels_genres  ON titels USING GIN (genres);

-- ---------------------------------------------------------------------
-- Vragenbank: tracks (per titel één of meer nummers)
--
-- De audio komt uit iTunes (gratis preview-clip van 30s) of, als fallback,
-- een lokaal bestand onder /media. Er is geen Spotify en geen login nodig.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
    id               SERIAL PRIMARY KEY,
    titel_id         INTEGER     NOT NULL REFERENCES titels (id) ON DELETE CASCADE,
    -- Bron van de audio: 'itunes' of 'lokaal'.
    bron             TEXT        NOT NULL DEFAULT 'itunes'
                     CHECK (bron IN ('itunes', 'lokaal')),
    -- iTunes-trackid (indien van iTunes), handig om later te verversen.
    itunes_track_id  BIGINT,
    -- De daadwerkelijke audio-URL: iTunes previewUrl of /media/bestand.m4a.
    preview_url      TEXT        NOT NULL,
    tracknaam        TEXT        NOT NULL,
    artiest          TEXT        NOT NULL,
    herkenbaarheid   SMALLINT    NOT NULL DEFAULT 3
                     CHECK (herkenbaarheid BETWEEN 1 AND 5),
    aangemaakt_op    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracks_titel_id ON tracks (titel_id);

-- ---------------------------------------------------------------------
-- Presets: opgeslagen filtercombinaties van de host
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presets (
    id             SERIAL PRIMARY KEY,
    naam           TEXT        NOT NULL,
    -- Filterwaarden
    categorie      TEXT        NOT NULL DEFAULT 'beide',  -- films | series | beide
    taal           TEXT        NOT NULL DEFAULT 'beide',  -- nl | en | beide
    periode_start  INTEGER     NOT NULL DEFAULT 1950,
    periode_eind   INTEGER     NOT NULL DEFAULT 2100,
    rondes         INTEGER     NOT NULL DEFAULT 10,        -- 10 | 20 | 30 | 0 (eindeloos)
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Lobbies: één actief spel per lobbycode
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lobbies (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    code           CHAR(4)       NOT NULL UNIQUE,
    status         lobby_status  NOT NULL DEFAULT 'wachten',
    -- Gekozen filters (kopie van de preset op moment van starten)
    instellingen   JSONB         NOT NULL DEFAULT '{}'::jsonb,
    huidige_ronde  INTEGER       NOT NULL DEFAULT 0,
    host_speler_id UUID,
    aangemaakt_op  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    bijgewerkt_op  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobbies_code   ON lobbies (code);
CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies (status);

-- ---------------------------------------------------------------------
-- Spelers: horen bij één lobby, herkenbaar aan een sessie-token
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spelers (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_id       UUID        NOT NULL REFERENCES lobbies (id) ON DELETE CASCADE,
    naam           TEXT        NOT NULL,
    spotify_id     TEXT,
    is_gast        BOOLEAN     NOT NULL DEFAULT false,  -- true = geen Premium
    is_host        BOOLEAN     NOT NULL DEFAULT false,
    -- Token voor herstel na disconnect (zonder puntenverlies)
    sessie_token   TEXT        NOT NULL UNIQUE,
    verbonden      BOOLEAN     NOT NULL DEFAULT true,
    score          INTEGER     NOT NULL DEFAULT 0,
    -- Voorraad hints (start 3, +1 per 10 gespeelde vragen)
    hints_over     INTEGER     NOT NULL DEFAULT 3,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spelers_lobby_id ON spelers (lobby_id);
CREATE INDEX IF NOT EXISTS idx_spelers_token    ON spelers (sessie_token);

-- Koppel host_speler_id nu de spelerstabel bestaat.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_lobbies_host_speler'
    ) THEN
        ALTER TABLE lobbies
            ADD CONSTRAINT fk_lobbies_host_speler
            FOREIGN KEY (host_speler_id) REFERENCES spelers (id)
            ON DELETE SET NULL;
    END IF;
END$$;

-- ---------------------------------------------------------------------
-- Rondes: één rij per vraag in een lobby
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rondes (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_id       UUID         NOT NULL REFERENCES lobbies (id) ON DELETE CASCADE,
    rondenummer    INTEGER      NOT NULL,
    titel_id       INTEGER      NOT NULL REFERENCES titels (id),
    track_id       INTEGER      NOT NULL REFERENCES tracks (id),
    start_ms       INTEGER      NOT NULL DEFAULT 0,   -- startpositie in de track
    duur_ms        INTEGER      NOT NULL DEFAULT 30000,
    status         ronde_status NOT NULL DEFAULT 'wachten',
    -- Bonusvraag (uit TMDB), opgeslagen als JSON zodra gegenereerd
    bonusvraag     JSONB,
    gestart_op     TIMESTAMPTZ,
    aangemaakt_op  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (lobby_id, rondenummer)
);

CREATE INDEX IF NOT EXISTS idx_rondes_lobby_id ON rondes (lobby_id);

-- ---------------------------------------------------------------------
-- Antwoorden: gok + bonus per speler per ronde
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS antwoorden (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    ronde_id       UUID        NOT NULL REFERENCES rondes (id) ON DELETE CASCADE,
    speler_id      UUID        NOT NULL REFERENCES spelers (id) ON DELETE CASCADE,
    titel_goed     BOOLEAN     NOT NULL DEFAULT false,
    hints_gebruikt INTEGER     NOT NULL DEFAULT 0,
    verstreken_ms  INTEGER,
    titel_punten   INTEGER     NOT NULL DEFAULT 0,
    bonus_goed     BOOLEAN     NOT NULL DEFAULT false,
    bonus_pogingen INTEGER     NOT NULL DEFAULT 0,
    bonus_punten   INTEGER     NOT NULL DEFAULT 0,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (ronde_id, speler_id)
);

CREATE INDEX IF NOT EXISTS idx_antwoorden_ronde_id  ON antwoorden (ronde_id);
CREATE INDEX IF NOT EXISTS idx_antwoorden_speler_id ON antwoorden (speler_id);

-- =====================================================================
-- Einde schema
-- =====================================================================
