# Bugs

Openstaande problemen en regressies. Voeg altijd datum, reproduceerstappen,
verwacht gedrag en werkelijk gedrag toe.

| Prioriteit | Status | Datum | Onderwerp | Reproduceerstappen | Verwacht | Werkelijk |
|---|---|---|---|---|---|---|
| P0 | Opgelost | 2026-07-25 | GitHub-standaardbranch wees naar verouderde Spotify-fundering | Repo clonen zonder branch te kiezen | Actuele VenTune-versie wordt standaard uitgecheckt | Oude Claude-fundering werd uitgecheckt; standaardbranch is nu gesynchroniseerd met actuele VenTune-code |
| P1 | Opgelost | 2026-07-25 | Ronde kon zonder zichtbare vraag overslaan | Laat een ronde automatisch eindigen of laat bonusantwoord en bonustimer bijna tegelijk aflopen | Elke overgang start precies één volgende ronde met audio en `ronde:start` | Dubbele overgang naar scorebord/volgende ronde en recursieve trackverwijdering konden een ronde overslaan |
| P2 | Open | 2026-07-25 | YouTube kan tijdelijk 403/429 geven | Playlist-import meerdere keren snel draaien | Import hervat netjes | Afhankelijk van YouTube-rate-limit |
| P2 | Open | 2026-07-25 | iTunes-preview is maximaal ongeveer 30 seconden | Track lokaal cachen | Preview blijft korte clip | Volledig nummer is niet beschikbaar via deze bron |

## Afhandelregels

- Een gemeld verkeerd nummer wordt eerst uitgezet en daarna onderzocht.
- Geen track vervangen zonder een nieuwe, succesvolle validatie.
- Geen fout oplossen door een brede of onzekere fallback toe te voegen.
