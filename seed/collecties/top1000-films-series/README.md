# Top 1000 bekende films en series in Nederland

Deze map is een aparte seed naast `seed/titels.json`. De twee CSV's bevatten
de eerste speelcollectie:

- `films.csv`: 1.000 films
- `series.csv`: 1.000 series en tv-programma's

Importeer eerst de titels en daarna — als YouTube beschikbaar is — de
bijbehorende intro/thema-track:

```sh
node /app/seed/import-collectie.js --titels-only
node /app/seed/import-collectie.js --limit 25
```

De importer schrijft de YouTube-bron naar `tracks.bron_url`, views naar
`tracks.youtube_views` en markeert tracks boven de ingestelde drempel
(`ICONISCH_MIN_VIEWS`, standaard 5 miljoen) met `tracks.yt_iconisch`.
Lokale downloads komen automatisch onder
`/media/collecties/top1000-films-series/Film` of
`/media/collecties/top1000-films-series/Serie` met de naam:

```text
<Titel> - <releasejaar> - <eerste genre> - <land-/taalcode>.m4a
```

Bij series is `releasejaar` het jaar waarin seizoen 1 uitkwam.

In `/admin` staat daarnaast een opschoonpreview voor de bestaande catalogus.
Die verplaatst/hernoemt bestaande lokale bestanden naar dezelfde Film/Serie-
structuur en wijzigt de databasepaden; bestanden worden daar niet verwijderd.

De collectie kan als geheel via het admin-endpoint worden verwijderd. Daarbij
worden de database-rijen en lokale bestanden van deze collectie verwijderd;
de oude catalogus blijft bestaan.
