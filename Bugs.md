# Bugs

Openstaande problemen en regressies. Voeg altijd datum, reproduceerstappen,
verwacht gedrag en werkelijk gedrag toe.

| Prioriteit | Status | Datum | Onderwerp | Reproduceerstappen | Verwacht | Werkelijk |
|---|---|---|---|---|---|---|
| P2 | Open | 2026-07-25 | YouTube kan tijdelijk 403/429 geven | Playlist-import meerdere keren snel draaien | Import hervat netjes | Afhankelijk van YouTube-rate-limit |
| P2 | Open | 2026-07-25 | iTunes-preview is maximaal ongeveer 30 seconden | Track lokaal cachen | Preview blijft korte clip | Volledig nummer is niet beschikbaar via deze bron |

## Afhandelregels

- Een gemeld verkeerd nummer wordt eerst uitgezet en daarna onderzocht.
- Geen track vervangen zonder een nieuwe, succesvolle validatie.
- Geen fout oplossen door een brede of onzekere fallback toe te voegen.
