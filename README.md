# VenTune

Self-hosted, mobile-first multiplayer **muziekquiz over films en series**, in de
stijl van Hitster. Draait volledig in Docker op een homelab en wordt ontsloten
via een tunnel op `ventune.ventrex.cc`.

De host speelt de muziek, spelers scannen een QR-code, kiezen een naam en raden
de titel op hun telefoon. **Geen account, geen login, geen Spotify** — de muziek
komt uit de gratis iTunes-previews.

---

## Inhoud

- [Hoe het werkt](#hoe-het-werkt)
- [Techstack](#techstack)
- [Snel starten](#snel-starten)
- [Vragenbank vullen (seed)](#vragenbank-vullen-seed)
- [Beheerportaal (/admin)](#beheerportaal-admin)
- [Poorten](#poorten)
- [Deploy achter een tunnel](#deploy-achter-een-tunnel)
- [Omgevingsvariabelen](#omgevingsvariabelen)
- [Projectstructuur](#projectstructuur)
- [Problemen oplossen](#problemen-oplossen)

---

## Hoe het werkt

1. **Host maakt een spel** en doorloopt het filtermenu (categorie, taal, periode,
   aantal rondes). Er verschijnt een 4-letterige code en een QR-code.
2. **Spelers joinen** door de QR te scannen (`/join/ABCD`) of de code te typen,
   en kiezen een naam.
3. **Ronde start.** De host speelt 30 seconden muziek. De spelers zien alleen
   een pulserende visualizer — geen titel, geen hoes.
4. **Raden.** Spelers typen de titel. Fuzzy matching vangt typefouten op. Sneller
   raden = meer punten.
5. **Hints.** Elke speler heeft 3 hints (+1 per 10 vragen). Een hint kost punten.
   Volgorde: (1) jaar, (2) genre + land, (3) beginletters van de titel.
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
| Audio    | iTunes Search API (gratis 30s-previews) |
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
cd /opt/VenTune && git pull && docker compose up -d --build
```

Je `.env` en de database (Docker-volume `pgdata`) blijven bij een update
behouden.

---

## Vragenbank vullen (seed)

Bij een verse installatie is de vragenbank leeg. Vullen kan op twee manieren:

**A. Via het beheerportaal (aanbevolen).** Ga naar `/admin`, log in en klik op
**"Startseed importeren (iTunes)"**. VenTune zet ~69 titels klaar (Nederlands en
internationaal) en zoekt per titel een clip op iTunes. Aan het eind zie je welke
titels geen clip kregen — die vul je handmatig aan.

**B. Via de command line** (in de servercontainer):

```bash
docker compose exec server node /app/seed/import.js
# opnieuw zoeken voor titels die al een track hebben:
docker compose exec server node /app/seed/import.js --force
```

De brondata staat in `seed/titels.json` en kun je uitbreiden.

> **Let op:** je kunt een spel pas starten als er minstens 15 titels met een
> track aan je filters voldoen. Onder die drempel toont het filtermenu een
> waarschuwing.

---

## Beheerportaal (/admin)

Bereikbaar op `https://ventune.ventrex.cc/admin` (of lokaal `:8091/admin`).
Inloggen met `ADMIN_PASSWORD` uit je `.env`. Je kunt er:

- de startseed importeren;
- titels zoeken, toevoegen, bewerken en verwijderen (naam, aliassen, type, taal,
  jaar, land, genres, TMDB-id);
- per titel tracks beheren: op iTunes zoeken, beluisteren en toevoegen, of
  verwijderen.

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

Muziek werkt **direct zonder sleutels** — iTunes is gratis en zonder account.

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
    └── titels.json          # startseed (69 titels)
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
soundtrack op iTunes. Gebruik in `/admin` de iTunes-zoeker om de **titelsong of
themamuziek** te vinden, of voeg via een `lokaal`-track je eigen clip toe.

**Tunnel bereikt de app niet.** Wijs de tunnel naar het **host-IP**
(`http://192.168.0.76:8091`), niet naar `127.0.0.1`. Zorg dat WebSockets
aanstaan (voor Socket.IO).

**Logs bekijken.** `docker compose logs -f server` — alles is JSON, dus goed
leesbaar en filterbaar.
