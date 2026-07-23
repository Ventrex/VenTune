# VenTune

Self-hosted, mobile-first multiplayer **muziekquiz over films en series**, in de
stijl van Hitster. Draait volledig in Docker op een homelab en wordt ontsloten
via een Cloudflare-tunnel op `ventune.ventrex.cc`.

> **Status:** in aanbouw. Deze eerste stap levert de fundering — Docker-stack,
> omgevingsbestand, databaseschema en migratie. De volgende stappen voegen
> Spotify-login, afspelen, lobby's, het spel zelf, TMDB-bonusvragen en de
> seed/admin toe.

---

## Techstack

| Laag       | Keuze                                   |
| ---------- | --------------------------------------- |
| Backend    | Node 20 + Express + Socket.IO           |
| Database   | PostgreSQL 16                           |
| Frontend   | React 18 + Vite (PWA)                   |
| Styling    | Tailwind + eigen theme-tokens (OLED)    |
| Auth       | Spotify OAuth 2.0 PKCE                   |
| Audio      | Spotify Web Playback SDK (Premium)      |
| Metadata   | TMDB API (server-side)                  |

---

## Snel starten (lokaal / homelab)

1. **Omgevingsbestand aanmaken**

   ```bash
   cp .env.example .env
   ```

   Vul in `.env` minimaal een `POSTGRES_PASSWORD`, `SESSION_SECRET` en
   `ADMIN_PASSWORD` in. De Spotify- en TMDB-sleutels heb je pas nodig vanaf de
   volgende stappen.

2. **Stack bouwen en starten**

   ```bash
   docker compose up -d --build
   ```

3. **Controleren of alles draait**

   ```bash
   # Server-healthcheck (moet {"status":"ok","db":"ok"} geven)
   curl http://localhost:8090/api/health

   # Frontend
   open http://localhost:8091
   ```

De server draait bij het opstarten automatisch de databasemigratie.

### Poorten

| Service  | Host-poort | In container | Toelichting                     |
| -------- | ---------- | ------------ | ------------------------------- |
| client   | `8091`     | `80`         | React-PWA via nginx (tunnel-doel) |
| server   | `8090`     | `3000`       | API + Socket.IO                 |
| db       | `5433`     | `5432`       | PostgreSQL (voor beheer/debug)  |

> Poortbindingen staan bewust **zonder** `127.0.0.1:`-prefix, zodat de
> Cloudflare-tunnel-container ze kan bereiken.

---

## Projectstructuur

```
ventune/
├── docker-compose.yml     # hele stack
├── .env.example           # voorbeeld-omgeving
├── server/                # backend (Express + Socket.IO)
│   ├── db/schema.sql       # databaseschema
│   ├── db/migrate.js       # migratie (draait bij start)
│   └── lib/                # logger, discord, (later) spotify/tmdb/match
└── client/                # frontend (React + Vite + nginx)
```

---

## Deploy achter de Cloudflare-tunnel

Volledige stap-voor-stap instructies (Pangolin / tunnel) volgen in de laatste
bouwstap. Kort: laat de tunnel wijzen naar `http://<host-ip>:8091` en zet in het
Spotify-dashboard de Redirect URI op `https://ventune.ventrex.cc/auth/callback`.
