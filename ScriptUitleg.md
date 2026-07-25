# Scriptuitleg

Alle seed-scripts draaien vanuit de servercontainer, zodat ze dezelfde
databaseconfiguratie en Node-versie gebruiken.

## Vragenbank

Dezelfde acties zijn ook beschikbaar via `/admin`: YouTube-first muziek
vernieuwen, playlists verversen, TMDB-titels importeren en bonusvragen
genereren. De CLI-commando's blijven handig voor herstel en automatisering.

    docker compose exec server node /app/seed/playlist-import.js --droog
    docker compose exec server node /app/seed/playlist-import.js
    docker compose exec server node /app/seed/import.js --db
    docker compose exec server node /app/seed/import.js --db --titel "Gooische Vrouwen"
    docker compose exec server node /app/seed/tmdb-import.js
    docker compose exec server node /app/seed/vragen-import.js

Begin bij voorkeur met `--droog`. Alleen duidelijke matches worden gekoppeld;
de rest blijft zichtbaar als overgeslagen. Als een titel een `tmdb_id` heeft en
`TMDB_API_KEY` is ingesteld, moet de kandidaat ook met de officiële TMDB-titel
en het jaar overeenkomen.

## Lokale preview-cache

De download start nooit vanzelf:

    docker compose exec server node /app/seed/download-track.js --track 42 --droog
    docker compose exec server node /app/seed/download-track.js --track 42
    docker compose exec server node /app/seed/download-track.js --all

Dit script accepteert alleen Apple/iTunes-preview-URL's die al bij een track
staan. Voor eigen volledige audiobestanden moet later een expliciete adminflow
worden toegevoegd met bron- en rechtenregistratie.

Een iTunes-fallback kan ook direct vanuit `/admin` met de downloadknop naast de
track naar het gedeelde `/media`-volume worden gecachet.

## Herstel bij verkeerde muziek

1. Laat tijdens het spel **Verkeerd nummer** melden.
2. Controleer de melding in `/admin`.
3. Zoek een correcte track opnieuw of voeg een eigen geautoriseerd bestand toe.
4. Draai de playlist-import of import met `--titel` opnieuw.

Een nieuwe track vervangt de oude alleen na succesvolle validatie.
