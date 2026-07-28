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
        CREATE TYPE titel_type AS ENUM ('film', 'serie', 'muziek');
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

-- VenTune begon als film- en seriequiz, maar kan ook uitbreiden naar
-- muziekspecials zoals Rock en Smartlappen. De enum-migratie houdt bestaande
-- databases compatibel.
ALTER TYPE titel_type ADD VALUE IF NOT EXISTS 'muziek';

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

-- Bekendheid en poster (uit TMDB). Populariteit filtert obscure titels weg,
-- zodat het spel bij bekende films en series blijft.
ALTER TABLE titels ADD COLUMN IF NOT EXISTS populariteit REAL NOT NULL DEFAULT 0;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS stemmen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS poster_pad TEXT;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS omschrijving TEXT;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS hoofdrollen TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE titels ADD COLUMN IF NOT EXISTS speelplek TEXT;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS studio TEXT;
-- Curatie: waarom staat een titel in de database en is hij geschikt voor de
-- standaardselectie "bekend van Nederlandse tv"?
ALTER TABLE titels ADD COLUMN IF NOT EXISTS toevoeg_reden TEXT NOT NULL
    DEFAULT 'Bestaande VenTune-basislijst; controle door beheerder nodig.';
ALTER TABLE titels ADD COLUMN IF NOT EXISTS nl_tv_bekend BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE titels ADD COLUMN IF NOT EXISTS curatie_status TEXT NOT NULL DEFAULT 'goedgekeurd';
ALTER TABLE titels ADD COLUMN IF NOT EXISTS leeftijdsgrens SMALLINT NOT NULL DEFAULT 16;
DO $$
BEGIN
    ALTER TABLE titels DROP CONSTRAINT IF EXISTS titels_curatie_status_check;
    ALTER TABLE titels ADD CONSTRAINT titels_curatie_status_check
        CHECK (curatie_status IN ('goedgekeurd', 'te_beoordelen', 'uitgesloten'));
    ALTER TABLE titels DROP CONSTRAINT IF EXISTS titels_leeftijdsgrens_check;
    ALTER TABLE titels ADD CONSTRAINT titels_leeftijdsgrens_check
        CHECK (leeftijdsgrens IN (0, 6, 9, 10, 12, 16, 18));
END$$;

CREATE INDEX IF NOT EXISTS idx_titels_type    ON titels (type);
CREATE INDEX IF NOT EXISTS idx_titels_pop     ON titels (populariteit DESC);
CREATE INDEX IF NOT EXISTS idx_titels_taal    ON titels (taal);
CREATE INDEX IF NOT EXISTS idx_titels_jaar    ON titels (jaar);
CREATE INDEX IF NOT EXISTS idx_titels_genres  ON titels USING GIN (genres);
CREATE INDEX IF NOT EXISTS idx_titels_curatie ON titels (nl_tv_bekend, curatie_status, leeftijdsgrens);
CREATE INDEX IF NOT EXISTS idx_titels_studio ON titels (studio);

-- ---------------------------------------------------------------------
-- Vragenbank: tracks (per titel één of meer nummers)
--
-- YouTube is alleen de zoek- en downloadbron voor intro's en titelsongs.
-- Het spel gebruikt uitsluitend volledig lokaal opgeslagen audio. iTunes kan
-- nog als historische bron in bestaande rijen staan, maar previews worden
-- nooit als lokale speeltrack geaccepteerd.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracks (
    id               SERIAL PRIMARY KEY,
    titel_id         INTEGER     NOT NULL REFERENCES titels (id) ON DELETE CASCADE,
    -- Bron van de audio: 'itunes', 'youtube' of 'lokaal'.
    bron             TEXT        NOT NULL DEFAULT 'youtube'
                     CHECK (bron IN ('itunes', 'youtube', 'lokaal')),
    -- iTunes-trackid (indien van iTunes), handig om later te verversen.
    itunes_track_id  BIGINT,
    -- Waar de audio zit: historische iTunes previewUrl, /media/bestand.m4a, of bij
    -- YouTube het video-id.
    preview_url      TEXT        NOT NULL,
    -- Startpositie in seconden (vooral voor YouTube; iTunes-previews starten
    -- op 0).
    start_seconde    INTEGER     NOT NULL DEFAULT 0,
    tracknaam        TEXT        NOT NULL,
    artiest          TEXT        NOT NULL,
    herkenbaarheid   SMALLINT    NOT NULL DEFAULT 3
                     CHECK (herkenbaarheid BETWEEN 1 AND 5),
    aangemaakt_op    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracks_titel_id ON tracks (titel_id);

-- Migratie voor bestaande databases: kolom en verruimde bron-constraint.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS start_seconde INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ALTER COLUMN bron SET DEFAULT 'youtube';

-- Status per track, zodat de kwaliteit langzaam verbetert in plaats van dat
-- er telkens opnieuw gezocht moet worden:
--   werkt        false = afgekeurd, wordt niet meer gespeeld
--   fout_aantal  hoe vaak er een fout gemeld is (hoger = later gekozen)
--   gecontroleerd of iemand deze track heeft goedgekeurd
--   bestand_pad  lokaal gedownload bestand (indien aanwezig)
--   bron_url     de volledige herkomst-URL, zodat niets opnieuw hoeft
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS werkt BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS fout_aantal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS gecontroleerd BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bestand_pad TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS bron_url TEXT;
-- Albumnaam (soundtracks heten vaak naar de film) — nodig om te kunnen
-- controleren of een nummer echt bij de titel hoort.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS laatst_gespeeld TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS keer_gespeeld INTEGER NOT NULL DEFAULT 0;
-- Uitlegbaarheid van de automatische controle. Lage/onbekende scores mogen
-- niet automatisch worden afgespeeld; de admin kan een track bewust markeren.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verificatie_score REAL NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS verificatie_reden TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS laatst_gecontroleerd_op TIMESTAMPTZ;
-- Toekomstvaste lokale audio. Downloads worden nooit automatisch gestart.
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS download_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS download_melding TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS audio_sha256 TEXT;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS gedownload_op TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS media_controle_op TIMESTAMPTZ;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS media_melding TEXT;

DO $$
BEGIN
    ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_download_status_check;
    ALTER TABLE tracks ADD CONSTRAINT tracks_download_status_check
        CHECK (download_status IN ('not_requested', 'pending', 'available', 'failed'));
END$$;

CREATE INDEX IF NOT EXISTS idx_tracks_keuze
    ON tracks (titel_id, werkt, fout_aantal, herkenbaarheid DESC);
CREATE INDEX IF NOT EXISTS idx_tracks_verificatie
    ON tracks (titel_id, werkt, verificatie_score DESC, fout_aantal);

-- Een betrouwbare match blijft de database-kandidaat en wordt niet bij iedere
-- import opnieuw opgezocht. De datum blijft beschikbaar voor audit, URL-checks
-- en handmatige reparaties; de lokale beschikbaarheid staat in download_status.
-- Bestaande gecontroleerde tracks krijgen bij de eerste migratie een
-- controle-datum op basis van hun aanmaakdatum.
UPDATE tracks
   SET laatst_gecontroleerd_op = COALESCE(laatst_gecontroleerd_op, aangemaakt_op)
 WHERE gecontroleerd = true AND laatst_gecontroleerd_op IS NULL;
DO $$
BEGIN
    ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_bron_check;
    ALTER TABLE tracks ADD CONSTRAINT tracks_bron_check
        CHECK (bron IN ('itunes', 'youtube', 'lokaal'));
END$$;

-- ---------------------------------------------------------------------
-- Accounts: alleen hosts hebben een account nodig. Spelers mogen gast blijven.
-- Wachtwoorden worden als scrypt-hash opgeslagen; sessies staan server-side.
-- Het admin-wachtwoord blijft bewust uitsluitend in .env.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gebruikers (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gebruikersnaam      TEXT        NOT NULL,
    gebruikersnaam_norm TEXT        NOT NULL UNIQUE,
    display_naam        TEXT        NOT NULL,
    wachtwoord_hash     TEXT        NOT NULL,
    actief              BOOLEAN     NOT NULL DEFAULT true,
    voorkeuren          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    aangemaakt_op       TIMESTAMPTZ NOT NULL DEFAULT now(),
    laatst_ingelogd     TIMESTAMPTZ
);

-- Migratie voor bestaande hostaccounts. Oudere databases hadden de tabel al
-- zonder voorkeuren; daardoor kon /host/profile stuklopen op g.voorkeuren.
ALTER TABLE gebruikers ADD COLUMN IF NOT EXISTS voorkeuren JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE gebruikers ADD COLUMN IF NOT EXISTS geboortedatum DATE;

CREATE INDEX IF NOT EXISTS idx_gebruikers_naam ON gebruikers (gebruikersnaam_norm);

CREATE TABLE IF NOT EXISTS auth_sessies (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    gebruiker_id   UUID        NOT NULL REFERENCES gebruikers (id) ON DELETE CASCADE,
    token_hash     TEXT        NOT NULL UNIQUE,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
    laatst_gezien  TIMESTAMPTZ NOT NULL DEFAULT now(),
    verloopt_op    TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessies_token ON auth_sessies (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessies_verloop ON auth_sessies (verloopt_op);

-- ---------------------------------------------------------------------
-- Presets: opgeslagen filtercombinaties van de host
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presets (
    id             SERIAL PRIMARY KEY,
    naam           TEXT        NOT NULL,
    -- Filterwaarden
    categorie      TEXT        NOT NULL DEFAULT 'beide',  -- films | series | beide
    taal           TEXT        NOT NULL DEFAULT 'beide',  -- nl | en | beide
    periode_start  INTEGER     NOT NULL DEFAULT 1930,
    periode_eind   INTEGER     NOT NULL DEFAULT 2100,
    rondes         INTEGER     NOT NULL DEFAULT 10,        -- 10 | 20 | 30 | 0 (eindeloos)
    -- Speeltijd per ronde in seconden; 0 = heel nummer, max 5 minuten.
    speeltijd      INTEGER     NOT NULL DEFAULT 0,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migratie voor bestaande databases.
ALTER TABLE presets ADD COLUMN IF NOT EXISTS speeltijd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ALTER COLUMN speeltijd SET DEFAULT 0;
ALTER TABLE presets ALTER COLUMN periode_start SET DEFAULT 1930;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS modus TEXT NOT NULL DEFAULT 'snelste';
ALTER TABLE presets ADD COLUMN IF NOT EXISTS min_bekendheid INTEGER NOT NULL DEFAULT 200;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS zonder_genres TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE presets ADD COLUMN IF NOT EXISTS leeftijd_max INTEGER NOT NULL DEFAULT 0;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS alleen_nl_tv BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS antwoord_modus TEXT NOT NULL DEFAULT 'typen';
ALTER TABLE presets ADD COLUMN IF NOT EXISTS collecties TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE presets ADD COLUMN IF NOT EXISTS categorieen TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE presets ADD COLUMN IF NOT EXISTS leeftijd_deelnemer_min INTEGER NOT NULL DEFAULT 4;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS leeftijd_deelnemer_max INTEGER NOT NULL DEFAULT 99;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS leeftijdspunten_aan BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS leeftijdsfactoren JSONB NOT NULL DEFAULT '{"6": 2, "9": 1.75, "12": 1.5, "16": 1.25, "18": 1}'::jsonb;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS gebruiker_id UUID;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS alleen_gecontroleerd BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE presets ADD COLUMN IF NOT EXISTS kindvriendelijk BOOLEAN NOT NULL DEFAULT false;
DO $$
BEGIN
    ALTER TABLE presets DROP CONSTRAINT IF EXISTS presets_antwoord_modus_check;
    ALTER TABLE presets ADD CONSTRAINT presets_antwoord_modus_check
        CHECK (antwoord_modus IN ('typen', 'meerkeuze'));
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_presets_gebruiker'
    ) THEN
        ALTER TABLE presets
            ADD CONSTRAINT fk_presets_gebruiker
            FOREIGN KEY (gebruiker_id) REFERENCES gebruikers (id)
            ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_presets_gebruiker ON presets (gebruiker_id, aangemaakt_op DESC);

-- ---------------------------------------------------------------------
-- Spelcollecties: een titel kan in meerdere edities tegelijk zitten.
-- Frozen blijft bijvoorbeeld een film én kan tegelijk Disney en Pixar zijn.
-- `type` blijft de inhoudssoort (film/serie/muziek); collecties zijn labels.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collecties (
    id              SERIAL PRIMARY KEY,
    sleutel         TEXT NOT NULL UNIQUE,
    naam            TEXT NOT NULL,
    beschrijving    TEXT,
    standaard_type  TEXT NOT NULL DEFAULT 'beide',
    actief          BOOLEAN NOT NULL DEFAULT true,
    toevoeg_reden   TEXT NOT NULL DEFAULT 'Handmatig aangemaakte VenTune-spelcollectie.',
    aangemaakt_op   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT collecties_sleutel_check CHECK (sleutel ~ '^[a-z0-9][a-z0-9-]*$'),
    CONSTRAINT collecties_type_check CHECK (standaard_type IN ('film', 'serie', 'muziek', 'beide', 'alles'))
);

CREATE TABLE IF NOT EXISTS titel_collecties (
    titel_id        INTEGER NOT NULL REFERENCES titels (id) ON DELETE CASCADE,
    collectie_id    INTEGER NOT NULL REFERENCES collecties (id) ON DELETE CASCADE,
    toegevoegd_op   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (titel_id, collectie_id)
);

CREATE INDEX IF NOT EXISTS idx_titel_collecties_collectie ON titel_collecties (collectie_id, titel_id);

INSERT INTO collecties (sleutel, naam, beschrijving, standaard_type, toevoeg_reden)
VALUES
    ('disney', 'Disney', 'Disney-films en -series', 'beide', 'Bekende Disney-titels voor een eigen Disney-editie.'),
    ('pixar', 'Pixar', 'Pixar-animatiefilms', 'film', 'Bekende Pixar-films voor een eigen Pixar-editie.'),
    ('kids', 'Kids', 'Kindvriendelijke films en series', 'beide', 'Titels voor de kindvriendelijke VenTune-editie.'),
    ('marvel', 'Marvel', 'Marvel-films en -series', 'beide', 'Iconische Marvel-titels voor een superheldeneditie.'),
    ('star-wars', 'Star Wars', 'Star Wars-films en -series', 'beide', 'Disney/Lucasfilm-collectie voor Star Wars.'),
    ('cult-classics', 'Cult Classics', 'Films en series die later iconisch werden', 'beide', 'Culttitels die niet altijd in gewone toplijsten bovenaan staan.'),
    ('fantasy', 'Fantasy', 'Fantasyfilms en -series', 'beide', 'Fantasy-editie voor herkenbare avonturen en werelden.'),
    ('superhelden', 'Superhelden', 'Superheldenfilms en -series', 'beide', 'Marvel/DC en andere superheldentitels.'),
    ('streaming', 'Streaming', 'Bekende streamingfilms en -series', 'beide', 'Bekende streamingtitels voor een Streaming Edition.'),
    ('smartlappen', 'Smartlappen', 'Nederlandse levensliederen en smartlappen', 'muziek', 'Herkenbare Nederlandse muziek voor een Smartlappen-editie.'),
    ('rock', 'Rock', 'Bekende rocknummers en rockklassiekers', 'muziek', 'Herkenbare rockmuziek voor een Rock-editie.'),
    ('kerst', 'Kerst', 'Kerstfilms, kerstseries en kerstmuziek', 'alles', 'Seizoenscollectie voor kerstspecials.')
ON CONFLICT (sleutel) DO UPDATE SET
    naam = EXCLUDED.naam,
    beschrijving = EXCLUDED.beschrijving,
    standaard_type = EXCLUDED.standaard_type;

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
    host_gebruiker_id UUID,
    host_speler_id UUID,
    aangemaakt_op  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    bijgewerkt_op  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobbies_code   ON lobbies (code);
CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies (status);

ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS host_gebruiker_id UUID;
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS host_speler_id UUID;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_lobbies_host_gebruiker'
    ) THEN
        ALTER TABLE lobbies
            ADD CONSTRAINT fk_lobbies_host_gebruiker
            FOREIGN KEY (host_gebruiker_id) REFERENCES gebruikers (id)
            ON DELETE SET NULL;
    END IF;
END$$;

-- ---------------------------------------------------------------------
-- Spelers: horen bij één lobby, herkenbaar aan een sessie-token
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spelers (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    lobby_id       UUID        NOT NULL REFERENCES lobbies (id) ON DELETE CASCADE,
    gebruiker_id   UUID        REFERENCES gebruikers (id) ON DELETE SET NULL,
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
    team_naam      TEXT,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spelers_lobby_id ON spelers (lobby_id);
CREATE INDEX IF NOT EXISTS idx_spelers_token    ON spelers (sessie_token);
ALTER TABLE spelers ADD COLUMN IF NOT EXISTS gebruiker_id UUID;
ALTER TABLE spelers ADD COLUMN IF NOT EXISTS leeftijd SMALLINT;
ALTER TABLE spelers ADD COLUMN IF NOT EXISTS team_naam TEXT;
DO $$
BEGIN
    ALTER TABLE spelers DROP CONSTRAINT IF EXISTS spelers_leeftijd_check;
    ALTER TABLE spelers ADD CONSTRAINT spelers_leeftijd_check
        CHECK (leeftijd IS NULL OR leeftijd BETWEEN 4 AND 120);
END$$;
CREATE INDEX IF NOT EXISTS idx_spelers_gebruiker_id ON spelers (gebruiker_id);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_spelers_gebruiker'
    ) THEN
        ALTER TABLE spelers
            ADD CONSTRAINT fk_spelers_gebruiker
            FOREIGN KEY (gebruiker_id) REFERENCES gebruikers (id)
            ON DELETE SET NULL;
    END IF;
END$$;

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

-- ---------------------------------------------------------------------
-- Meldingen: spelers of de host kunnen aangeven dat er iets mis is met
-- een track (verkeerd nummer, geen geluid). Zo hoef je niet zelf alles
-- na te lopen: in /admin zie je wat er gemeld is.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meldingen (
    id             SERIAL PRIMARY KEY,
    track_id       INTEGER     REFERENCES tracks (id) ON DELETE CASCADE,
    titel_id       INTEGER     REFERENCES titels (id) ON DELETE CASCADE,
    soort          TEXT        NOT NULL DEFAULT 'fout'
                   CHECK (soort IN ('fout', 'geen_geluid', 'verkeerd_nummer', 'geen_track', 'anders')),
    toelichting    TEXT,
    afgehandeld    BOOLEAN     NOT NULL DEFAULT false,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    ALTER TABLE meldingen DROP CONSTRAINT IF EXISTS meldingen_soort_check;
    ALTER TABLE meldingen ADD CONSTRAINT meldingen_soort_check
        CHECK (soort IN ('fout', 'geen_geluid', 'verkeerd_nummer', 'geen_track', 'anders'));
END$$;

CREATE INDEX IF NOT EXISTS idx_meldingen_open ON meldingen (afgehandeld, aangemaakt_op DESC);

-- Beheerbare applicatie-instellingen. Het admin-wachtwoord staat hier
-- bewust niet in; dat blijft uitsluitend in .env.
CREATE TABLE IF NOT EXISTS app_instellingen (
    sleutel        TEXT PRIMARY KEY,
    waarde         JSONB NOT NULL,
    bijgewerkt_op  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_instellingen (sleutel, waarde)
VALUES (
    'thema',
    '{
      "appNaam": "VenTune",
      "ondertitel": "Muziekquiz over films en series",
      "logoPad": "/icon.svg",
      "achtergrond": "#000000",
      "oppervlak": "#0a0a0a",
      "rand": "#1c1c1c",
      "accent": "#c41230",
      "accentDonker": "#8b0f1d",
      "tekst": "#f5f5f5",
      "tekstDim": "#8a8a8a",
      "lettertype": "system-ui"
    }'::jsonb
)
ON CONFLICT (sleutel) DO NOTHING;

INSERT INTO app_instellingen (sleutel, waarde)
VALUES (
    'beheer',
    '{
      "playlistAutomatisch": false,
      "playlistIntervalUren": 24,
      "playlistLaatsteRun": null,
      "playlistVolgendeRun": null,
      "mediaHealthAutomatisch": true,
      "mediaHealthIntervalUren": 24,
      "mediaHealthLaatsteRun": null,
      "mediaHealthVolgendeRun": null,
      "tmdbAutomatisch": true,
      "tmdbIntervalUren": 24,
      "tmdbLaatsteRun": null,
      "tmdbVolgendeRun": null,
      "youtubeAutomatisch": true,
      "youtubeIntervalUren": 24,
      "youtubeLaatsteRun": null,
      "youtubeVolgendeRun": null,
      "downloadsAutomatisch": true,
      "downloadsIntervalUren": 24,
      "downloadsLaatsteRun": null,
      "downloadsVolgendeRun": null
    }'::jsonb
)
ON CONFLICT (sleutel) DO NOTHING;

-- Bestaande installaties meekrijgen: onderhoud draait dagelijks, zodat
-- YouTube-matches, lokale MP3's en metadata niet handmatig bijgehouden
-- hoeven te worden. Playlist-import blijft handmatig omdat die afhankelijk
-- is van samengestelde bronlijsten.
UPDATE app_instellingen
SET waarde = waarde || '{
  "mediaHealthAutomatisch": true,
  "mediaHealthIntervalUren": 24,
  "tmdbAutomatisch": true,
  "tmdbIntervalUren": 24,
  "youtubeAutomatisch": true,
  "youtubeIntervalUren": 24,
  "downloadsAutomatisch": true,
  "downloadsIntervalUren": 24
}'::jsonb,
    bijgewerkt_op = now()
WHERE sleutel = 'beheer';

-- ---------------------------------------------------------------------
-- Zoekcache: onthoudt wat er al opgehaald is (YouTube/iTunes), zodat
-- dezelfde zoekopdracht niet telkens opnieuw hoeft. Voorkomt ook de
-- 429/403-limieten bij grote imports.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS zoek_cache (
    id             SERIAL PRIMARY KEY,
    bron           TEXT        NOT NULL,        -- youtube | itunes | playlist
    term           TEXT        NOT NULL,
    resultaat      JSONB       NOT NULL,        -- de gevonden items
    aantal         INTEGER     NOT NULL DEFAULT 0,
    opgehaald_op   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bron, term)
);

CREATE INDEX IF NOT EXISTS idx_zoekcache ON zoek_cache (bron, term);

-- Elke zoekpoging blijft als auditregel bestaan, ook als het antwoord uit de
-- cache kwam of leeg was. De unieke zoek_cache is de laatste bruikbare
-- momentopname; zoek_log is de volledige geschiedenis.
CREATE TABLE IF NOT EXISTS zoek_log (
    id               BIGSERIAL PRIMARY KEY,
    bron             TEXT NOT NULL,
    term             TEXT NOT NULL,
    limiet           INTEGER,
    uit_cache        BOOLEAN NOT NULL DEFAULT false,
    resultaat_aantal INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'ok',
    melding          TEXT,
    opgezocht_op     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoeklog_term
    ON zoek_log (bron, term, opgezocht_op DESC);

-- ---------------------------------------------------------------------
-- Playlist-status: welke playlists al ingelezen zijn en hoeveel items.
-- YouTube geeft ~100 items per keer; hiermee weet je wat al gehad is.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS playlist_status (
    playlist_id    TEXT        PRIMARY KEY,
    naam           TEXT,
    aantal_items   INTEGER     NOT NULL DEFAULT 0,
    gekoppeld      INTEGER     NOT NULL DEFAULT 0,
    laatst_gelezen TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Vragenbank: meerdere vragen per titel, zodat je bij dezelfde titel niet
-- steeds dezelfde vraag krijgt. Vragen worden vooraf gegenereerd en
-- opgeslagen, zodat er tijdens het spel niets opgehaald hoeft te worden.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vragen (
    id             SERIAL PRIMARY KEY,
    titel_id       INTEGER     NOT NULL REFERENCES titels (id) ON DELETE CASCADE,
    soort          TEXT        NOT NULL,        -- jaar | genre | type | land | regisseur | acteur | decennium
    vraag          TEXT        NOT NULL,
    opties         JSONB       NOT NULL,        -- ["a","b","c","d"]
    correct_index  SMALLINT    NOT NULL,
    keer_gebruikt  INTEGER     NOT NULL DEFAULT 0,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (titel_id, soort, vraag)
);

CREATE INDEX IF NOT EXISTS idx_vragen_titel ON vragen (titel_id, keer_gebruikt);

-- Bonusvragen die spelers zelf insturen. Ze worden nooit direct speelbaar:
-- de admin keurt ze eerst goed of wijst ze af.
CREATE TABLE IF NOT EXISTS vraag_suggesties (
    id             SERIAL PRIMARY KEY,
    titel_id       INTEGER NOT NULL REFERENCES titels (id) ON DELETE CASCADE,
    speler_naam    TEXT,
    vraag          TEXT NOT NULL,
    opties         JSONB NOT NULL,
    correct_index  SMALLINT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'open',
    toelichting    TEXT,
    beoordeeld_op  TIMESTAMPTZ,
    aangemaakt_op  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT vraag_suggesties_status_check
        CHECK (status IN ('open', 'goedgekeurd', 'afgewezen')),
    CONSTRAINT vraag_suggesties_correct_check
        CHECK (correct_index BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS idx_vraag_suggesties_status
    ON vraag_suggesties (status, aangemaakt_op DESC);

-- =====================================================================
-- Einde schema
-- =====================================================================
