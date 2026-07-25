# Docker Compose

## Services

| Service | Poort | Functie |
|---|---:|---|
| `db` | 5433 | PostgreSQL 16 |
| `server` | 8090 | Express, Socket.IO, migraties en seed-scripts |
| `client` | 8091 | React-PWA via nginx |

## Volumes

- `pgdata`: databasegegevens; blijft bestaan na een rebuild.
- `./seed:/app/seed:ro`: seeddata en scripts.
- `./media:/media`: persistente lokale audio; echte downloads staan in
  `./media/downloads`, uploads in `./media/uploads`; audiobestanden worden niet
  naar Git gestuurd.
- `./media:/usr/share/nginx/html/media:ro`: dezelfde lokale audio voor de
  speler.

De serverimage bevat `yt-dlp`, Python en `ffmpeg`. Bij spelstart worden geplande
gecontroleerde tracks echt gedownload naar `./media/downloads`; de image
downloadt niets blind tijdens het opstarten. Lokale bestanden blijven in
`./media` staan.

## Update

    git pull --ff-only
    docker compose up -d --build

De migratie draait bij het starten van de server. Controleer daarna:

    docker compose ps
    curl http://127.0.0.1:8090/api/health

Gebruik voor internetpublicatie een tunnel of reverse proxy met HTTPS.

Gebruik bij een update geen `git checkout` en geen `docker compose down -v`.
De eerste wisselt de actieve branch en de tweede kan het databasevolume
verwijderen; beide zijn niet nodig voor een normale VenTune-update. De
host-sessie en spelerdata blijven behouden in PostgreSQL.
