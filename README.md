# VenTune

Self-hosted, mobile-first multiplayer **muziekquiz over films en series**, in de
stijl van Hitster. Draait volledig in Docker op een homelab en wordt ontsloten
via een tunnel op `ventune.ventrex.cc`.

De host speelt de muziek en kan tegelijk zelf raden; spelers scannen een QR-code,
kiezen een naam en raden de titel op hun telefoon. Spelers hebben geen account
nodig; een host logt wel in met een hostaccount. **Geen Spotify** — de muziek komt primair van YouTube,
met iTunes-previews en eigen clips als fallback.

---

## Inhoud

- [Hoe het werkt](#hoe-het-werkt)
- [Techstack](#techstack)
- [Snel starten](#snel-starten)
- [Hostaccount](#hostaccount)
- [Vragenbank vullen (seed)](#vragenbank-vullen-seed)
- [Beheerportaal (/admin)](#beheerportaal-admin)
- [Betrouwbaarheid van muziek](#betrouwbaarheid-van-muziek)
- [Documentatie](#documentatie)
- [Poorten](#poorten)
- [Deploy achter een tunnel](#deploy-achter-een-tunnel)
- [Omgevingsvariabelen](#omgevingsvariabelen)
- [Projectstructuur](#projectstructuur)
- [Problemen oplossen](#problemen-oplossen)

---

## Hoe het werkt

1. **Host maakt een spel** en doorloopt het filtermenu (categorie, taal, periode,
   aantal rondes). Er verschijnt een 4-letterige code en een QR-code. De host
   speelt standaard ook zelf mee vanaf het hostscherm.
2. **Spelers joinen** door de QR te scannen (`/join/ABCD`) of de code te typen,
   en kiezen een naam.
3. **Ronde start.** De host speelt de muziek (30 sec tot het hele nummer,
   instelbaar). De spelers zien alleen een pulserende visualizer — geen titel,
   geen hoes.
4. **Raden.** Spelers typen de titel. Fuzzy matching vangt typefouten op. Sneller
   raden = meer punten.
5. **Hints.** Elke speler heeft 3 hints (+1 per 10 vragen). Een hint kost punten.
   Waar beschikbaar: hoofdrollen, speelplek, genre/land, beginletters, jaar en
   type. Het jaartal is niet meer standaard de eerste hint.
6. **Bonusvraag.** Na de gokfase een meerkeuzevraag over dezelfde titel
   (regisseur, hoofdrolspeler, jaar of genre) uit TMDB. Optioneel — zonder
   TMDB-key wordt de bonus overgeslagen.
7. **Scorebord** tussen de rondes, **eindstand** na de laatste ronde.

**Puntentelling:** titel goed = 100 − 2 per verstreken seconde (minimaal 20);
per hint −25; bonus goed +50 (halveert naar 25 bij de tweede poging).

Sluit je de app en kom je terug, dan val je met je sessie terug in de lobby
zonder punten te verliezen.

---

## Techstack

| Laag     | Keuze                                   |
| -------- | --------------------------------------- |
| Backend  | Node 20 + Express + Socket.IO           |
| Database | PostgreSQL 16                           |
| Frontend | React 18 + Vite (PWA)                   |
| Styling  | Eigen theme-tokens (OLED zwart/rood)    |
| Audio    | YouTube (primair) + iTunes-previews + lokale clips |
| Metadata | TMDB API (server-side, optioneel)       |

Alles draait in Docker via één `docker-compose.yml`. Geen betaalde API's,
geen externe login.

---

## Snel starten

Op je Docker-host (bijv. de VM/LXC op `192.168.0.76`):

```bash
# 1. Clonen — direct op de main-branch
cd /opt
git clone -b main https://github.com/Ventrex/VenTune.git
cd VenTune

# 2. Omgeving instellen
cp .env.example .env
nano .env        # zie 'Omgevingsvariabelen' hieronder

# 3. Bouwen en starten
docker compose up -d --build
```

**Controleren:**

```bash
docker compose ps                          # 3 containers 'up'
curl http://192.168.0.76:8090/api/health   # {"status":"ok","db":"ok"}
```

Open daarna **http://192.168.0.76:8091** in de browser.

**Updaten** na een nieuwe versie (nooit een branch wisselen):

```bash
cd /opt/VenTune
git pull --ff-only
docker compose up -d --build
```

Je `.env` en de database (Docker-volume `pgdata`) blijven bij een update
behouden. Wissel hiervoor niet van branch en gebruik geen `docker compose down
-v`; zo blijft de aangemelde host-sessie beschikbaar.

---

## Hostaccount

Een speler kan zonder account meedoen via QR-code en lobbycode. Een host moet
wel altijd een account hebben voordat een lobby kan worden aangemaakt. Kies op
het startscherm **Nieuw spel**, maak een hostaccount aan of log in, en ga daarna
door naar de filters.

Hostaccounts worden in PostgreSQL opgeslagen met een scrypt-wachtwoordhash en
een server-side sessiecookie. Het adminportaal blijft hiervan gescheiden: het
admin-wachtwoord staat uitsluitend in `.env`.

## Vragenbank vullen (seed)

Bij een verse installatie is de vragenbank leeg. Vullen kan op twee manieren:

**A. Via het beheerportaal (aanbevolen).** Ga naar `/admin`, log in en klik op
**"Startseed importeren (YouTube eerst)"**. VenTune zet ~290 titels klaar
(Nederlands en internationaal) en zoekt per titel eerst een betrouwbare
YouTube-intro. Alleen bij een mislukte YouTube-match wordt iTunes als fallback
geprobeerd.

**A2. Duizenden titels via TMDB (aanbevolen).** De handgeschreven lijst van
~290 titels is klein. Met een gratis TMDB-key haal je er automatisch duizenden
bij (films én series, Nederlands en internationaal, vanaf 1950):

```bash
# 1. Titels ophalen (duurt enkele minuten)
docker compose exec server node /app/seed/tmdb-import.js

# 2. Muziek erbij zoeken voor alle titels zonder track
docker compose exec server node /app/seed/import.js --db
```

Dit kan ook met één klik in `/admin` via **TMDB-titels importeren** en daarna
**YouTube-first muziek vernieuwen**. Bonusvragen kun je daar ook genereren.

Stap 2 kan lang duren (YouTube knijpt af bij te veel verzoeken). Het script is
hervatbaar: draai het gerust nogmaals, het pakt alleen de titels op die nog geen
muziek hebben.

**A3. Intro's uit YouTube-playlists (beste kwaliteit).** Playlists als
"Nederlandse tv-series intro's" bevatten per definitie de échte intro's — geen
soundtrackalbums of misgrepen. De playlists staan in `seed/playlists.json`:

```bash
# Eerst kijken wat er gekoppeld zou worden (slaat niets op)
docker compose exec server node /app/seed/playlist-import.js --droog

# Koppelen aan bestaande titels
docker compose exec server node /app/seed/playlist-import.js

# Ook onbekende titels uit de playlists aanmaken
docker compose exec server node /app/seed/playlist-import.js --nieuw
```

Playlist-tracks krijgen herkenbaarheid 5 en vervangen een eerder gevonden
track, omdat ze betrouwbaarder zijn. Je kunt eigen playlists toevoegen aan
`seed/playlists.json`.

**B. Via de command line** (in de servercontainer):

```bash
docker compose exec server node /app/seed/import.js
# alles schoon opnieuw opbouwen (verwijdert bestaande tracks per titel):
docker compose exec server node /app/seed/import.js --force
```

De knop **YouTube-first muziek vernieuwen** in `/admin` gebruikt bewust de
veilige force-migratie. Een oude iTunes-track wordt alleen vervangen nadat een
nieuwe gecontroleerde YouTube-track (of pas daarna een iTunes-fallback) is
gevonden.

De import zoekt **eerst op YouTube** naar de intro/titelsong (daar staat vrijwel
elke film- en seriemuziek, ook de Nederlandse) en valt terug op iTunes als daar
niets bruikbaars staat. Per titel wordt de meest waarschijnlijke intro gekozen:
reaction-video's, trailers en hele afleveringen worden weggefilterd.

Als een titel een `tmdb_id` heeft en `TMDB_API_KEY` is ingesteld, controleert
VenTune daarnaast de officiële TMDB-titel en het jaar. Zonder TMDB-configuratie
blijft de lokale conservatieve titel-/aliascontrole actief.

> Optioneel: zet `YOUTUBE_API_KEY` in `.env` om de officiële YouTube Data API te
> gebruiken in plaats van de publieke zoekpagina. Werkt zonder key ook.

De brondata staat in `seed/titels.json` en kun je uitbreiden.

> **Let op:** je kunt een spel pas starten als er minstens 15 titels met een
> track aan je filters voldoen. Onder die drempel toont het filtermenu een
> waarschuwing.

### Betrouwbaarheid van muziek

VenTune probeert niet koste wat kost een nummer te vinden. Een resultaat wordt
alleen opgeslagen als de volledige titel of een alias overtuigend in de
tracknaam of het album voorkomt. Een expliciet ander jaartal
wordt geweigerd. Tijdens het spel controleert de engine de track nogmaals; een
verkeerde track wordt dan uitgeschakeld.

Dat betekent bewust: bij twijfel liever geen ronde dan muziek van een andere
film of serie onder de verkeerde naam. Zoekresultaten van YouTube en iTunes
kunnen immers veranderen.

### Lokale audio en YouTube-cache

De compose-stack bevat een persistent `./media`-volume. Vanuit `/admin` kun je
een bestaande, gecontroleerde YouTube- of iTunes-track expliciet lokaal cachen,
of een eigen/gelicentieerd audiobestand uploaden:

    docker compose exec server node /app/seed/download-track.js --track 42 --droog
    docker compose exec server node /app/seed/download-track.js --track 42
    docker compose exec server node /app/seed/download-track.js --all

YouTube wordt met `yt-dlp` en `ffmpeg` als mp3-audio opgeslagen in
`./media/downloads`. Lokale audio krijgt voorrang bij het spelen, zodat een
later verwijderde YouTube-video geen probleem meer is. Bij spelstart worden
alleen al bekende/gecontroleerde tracks vooraf gedownload; de game zoekt of
downloadt geen willekeurige video's. Gebruik alleen bronnen/bestanden die je
mag gebruiken.

---

## Beheerportaal (/admin)

Bereikbaar op `https://ventune.ventrex.cc/admin` (of lokaal `:8091/admin`).
Inloggen met `ADMIN_PASSWORD` uit je `.env`. Je kunt er:

- de startseed importeren;
- titels zoeken, toevoegen, bewerken en verwijderen (naam, aliassen, type, taal,
  jaar, land, genres, TMDB-id);
- per titel eerst de beste YouTube-intro automatisch zoeken en toevoegen;
- handmatig een **YouTube-link** plakken (met optionele startseconde);
- iTunes pas als fallback zoeken, beluisteren en toevoegen;
- tracks verwijderen, goedkeuren, afkeuren, controleren en lokaal cachen;
- titels in **Tracks nodig** openen als er geen speelbare track gekoppeld is;
- eigen/gelicentieerde audio uploaden en direct koppelen;
- hostaccounts aanmaken, bewerken, uitschakelen en voorzien van een nieuw wachtwoord;
- importstatus, open meldingen en aantallen per audiobron bekijken.

**YouTube als hoofdbron.** De host speelt een YouTube-video af met de visualizer
eroverheen, zodat de
titel verborgen blijft. Let op: een ingesloten YouTube-speler erft je Premium
niet altijd, dus er kan af en toe een advertentie verschijnen. iTunes wordt
alleen gebruikt als YouTube geen veilige match oplevert.

Vul een **TMDB-id** in bij een titel om er bonusvragen voor mogelijk te maken.

---

## Poorten

| Service | Host-poort | In container | Toelichting                       |
| ------- | ---------- | ------------ | --------------------------------- |
| client  | `8091`     | `80`         | React-PWA via nginx (tunnel-doel) |
| server  | `8090`     | `3000`       | API + Socket.IO                   |
| db      | `5433`     | `5432`       | PostgreSQL (voor beheer/debug)    |

De client (nginx) proxyt `/api`, `/auth` en `/socket.io` door naar de server,
zodat alles vanaf **één origin** werkt — precies wat een tunnel nodig heeft.

> Poortbindingen staan bewust **zonder** `127.0.0.1:`-prefix, zodat een
> tunnel-container in een ander Docker-netwerk ze kan bereiken.

---

## Deploy achter een tunnel

Doel: `https://ventune.ventrex.cc` laten wijzen naar `http://192.168.0.76:8091`
(de client-poort). Kies je tunnel-oplossing.

### Optie 1 — Cloudflare Tunnel (cloudflared)

1. Zorg dat het domein `ventrex.cc` in je Cloudflare-account staat.
2. Maak een tunnel:

   ```bash
   cloudflared tunnel login
   cloudflared tunnel create ventune
   ```

3. Koppel een hostname aan de lokale service. In `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: <tunnel-id>
   credentials-file: /root/.cloudflared/<tunnel-id>.json

   ingress:
     - hostname: ventune.ventrex.cc
       service: http://192.168.0.76:8091
     - service: http_status:404
   ```

4. Zet de DNS-route en start de tunnel:

   ```bash
   cloudflared tunnel route dns ventune ventune.ventrex.cc
   cloudflared tunnel run ventune
   ```

   (Of draai `cloudflared` als extra service in je compose/Proxmox.)

> Draait cloudflared in een **eigen container**? Dan kan die de loopback van de
> host niet bereiken — daarom bindt VenTune op `0.0.0.0` (zonder `127.0.0.1:`).
> Wijs de tunnel naar het host-IP `http://192.168.0.76:8091`.

### Optie 2 — Pangolin

[Pangolin](https://github.com/fosrl/pangolin) is een self-hosted tunnel/reverse
proxy. Nadat Pangolin draait:

1. Maak in Pangolin een **site** aan voor je homelab (installeer de Newt-agent op
   de Docker-host, zodat Pangolin bij de lokale services kan).
2. Maak een **resource** aan:
   - Domein/subdomein: `ventune.ventrex.cc`
   - Doel: `http://192.168.0.76:8091` (HTTP)
   - WebSockets: **inschakelen** (nodig voor Socket.IO).
3. Zet authenticatie op de resource naar wens (publiek voor de spelers, of
   achter Pangolin-login).

Zowel Cloudflare als Pangolin sturen al het verkeer naar dezelfde ene poort
(`8091`); de nginx in de client-container regelt de rest.

---

## Omgevingsvariabelen

Kopieer `.env.example` naar `.env` en vul in. Het minimum om te starten:

| Variabele          | Verplicht | Uitleg                                            |
| ------------------ | --------- | ------------------------------------------------- |
| `POSTGRES_PASSWORD`| ja        | Wachtwoord voor de database                       |
| `DATABASE_URL`     | ja        | Bevat hetzelfde wachtwoord                        |
| `SESSION_SECRET`   | ja        | Lange willekeurige reeks (`openssl rand -hex 32`) |
| `ADMIN_PASSWORD`   | ja        | Toegang tot `/admin`                              |
| `APP_URL`          | ja        | `https://ventune.ventrex.cc`                      |
| `ITUNES_LAND`      | nee       | Store voor de muziekzoekopdracht (standaard `NL`) |
| `TMDB_API_KEY`     | nee       | Gratis key; alleen nodig voor bonusvragen         |
| `DISCORD_WEBHOOK_URL` | nee    | Meldingen (crash, DB-fout, nieuwe lobby)          |

YouTube werkt zonder sleutel via de zoekpagina. Een optionele
`YOUTUBE_API_KEY` maakt de zoekresultaten stabieler. iTunes is alleen de gratis
fallback en vereist geen account. `MEDIA_DIR` is optioneel en staat standaard op
`/media` in de servercontainer.

---

## Projectstructuur

```
VenTune/
├── docker-compose.yml       # hele stack
├── .env.example
├── server/                  # backend (Express + Socket.IO)
│   ├── db/{schema.sql,migrate.js,pool.js}
│   ├── lib/{itunes,tmdb,match,discord,logger,cookies}.js
│   ├── game/{engine,lobby,filters,scoring,bonus}.js
│   ├── routes/{muziek,lobby,setup,admin}.js
│   ├── socket.js
│   └── index.js
├── client/                  # frontend (React + Vite + nginx)
│   └── src/
│       ├── pages/{Home,Setup,Join,Host,Play,Admin,MuziekTest}.jsx
│       ├── components/{Visualizer,Timer}.jsx
│       ├── lib/{api,socket,sessie,useSpel}.js
│       └── styles/theme.css
└── seed/
    ├── import.js            # iTunes-import
    └── titels.json          # startseed (~290 titels, NL + internationaal)
```

---

## Problemen oplossen

**`/api/health` geeft geen `ok`.** Draait de db-container? `docker compose logs db`.
Controleer of `DATABASE_URL` hetzelfde wachtwoord heeft als `POSTGRES_PASSWORD`.

**Spel wil niet starten / "te weinig titels".** De vragenbank is (te) leeg —
importeer de seed via `/admin` of de CLI. Je hebt minstens 15 passende titels
nodig.

**Geen geluid.** Alleen de **host** speelt audio (in de kamer). Tik op het
host-scherm één keer als de browser autoplay blokkeert. Spelers horen bewust
niets op hun telefoon.

**Nederlandse titels zonder clip.** Niet elke Nederlandse titel heeft een
bruikbare online match. Gebruik in `/admin` eerst de YouTube-zoeker voor de
**titelsong of themamuziek**; iTunes blijft de fallback. Voeg alleen met bron-
en rechtenregistratie een eigen `lokaal`-track toe.

**Tunnel bereikt de app niet.** Wijs de tunnel naar het **host-IP**
(`http://192.168.0.76:8091`), niet naar `127.0.0.1`. Zorg dat WebSockets
aanstaan (voor Socket.IO).

**Logs bekijken.** `docker compose logs -f server` — alles is JSON, dus goed
leesbaar en filterbaar.

---

## Documentatie

- [CHANGELOG.md](CHANGELOG.md) — publieke wijzigingen; spelers zien dit ook via **Wat is nieuw?**
- [Bugs.md](Bugs.md) — bekende fouten en reproduceerstappen.
- [Todo.md](Todo.md) — concrete openstaande werkzaamheden.
- [Ideeen.md](Ideeen.md) — ideeën die nog niet zijn toegezegd.
- [Prioriteiten.md](Prioriteiten.md) — P0–P4-prioriteiten; “pak alle P1-punten op” begint hier.
- [Files.md](Files.md) — kaart van de belangrijkste bestanden.
- [ScriptUitleg.md](ScriptUitleg.md) — seed-, diagnose- en downloadscripts.
- [Docker-compose.md](Docker-compose.md) — services, volumes en updateflow.
- [Comments.md](Comments.md) — technische keuzes en grenzen.
- [GevraagdeAI.md](GevraagdeAI.md) — instructies voor vervolgwerk.
- [Stappenplan.md](Stappenplan.md) — voortgang per fase.
- [AdminHandleiding.md](AdminHandleiding.md) — ontbrekende tracks, lokale audio,
  hints en hostaccounts.
- [LICENSES.md](LICENSES.md) — bron- en licentiebeleid.
