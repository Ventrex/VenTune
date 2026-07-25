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
- `./media:/media`: lokale audiobestanden; wordt niet naar Git gestuurd.
- `./media:/usr/share/nginx/html/media:ro`: dezelfde lokale audio voor de
  speler.

## Update

    git pull
    docker compose up -d --build

De migratie draait bij het starten van de server. Controleer daarna:

    docker compose ps
    curl http://127.0.0.1:8090/api/health

Gebruik voor internetpublicatie een tunnel of reverse proxy met HTTPS.
