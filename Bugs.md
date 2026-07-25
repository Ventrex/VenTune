# Bugs

Openstaande problemen en regressies. Voeg altijd datum, reproduceerstappen,
verwacht gedrag en werkelijk gedrag toe.

| Prioriteit | Status | Datum | Onderwerp | Reproduceerstappen | Verwacht | Werkelijk |
|---|---|---|---|---|---|---|
| P0 | Opgelost | 2026-07-25 | GitHub-standaardbranch wees naar verouderde Spotify-fundering | Repo clonen zonder branch te kiezen | Actuele VenTune-versie wordt standaard uitgecheckt | Oude Claude-fundering werd uitgecheckt; standaardbranch is nu gesynchroniseerd met actuele VenTune-code |
| P1 | Opgelost | 2026-07-25 | Ronde kon zonder zichtbare vraag overslaan | Laat een ronde automatisch eindigen of laat bonusantwoord en bonustimer bijna tegelijk aflopen | Elke overgang start precies één volgende ronde met audio en `ronde:start` | Dubbele overgang naar scorebord/volgende ronde en recursieve trackverwijdering konden een ronde overslaan |
| P1 | Opgelost | 2026-07-25 | Hint was altijd het jaartal | Vraag meerdere hints bij een bekende titel | Hints geven cast, speelplek, kenmerken, letters en pas later het jaar | Elke eerste hint was hetzelfde jaartal; hoofdrollen komen nu uit TMDB als ze ontbreken |
| P1 | Opgelost | 2026-07-25 | Titel zonder track was niet zichtbaar als actie | Start een spel met filters waarin een titel geen bruikbare track heeft | Titel wordt overgeslagen zonder rondenummergat en verschijnt in `/admin` | Ontbrekende tracks bleven alleen impliciet in de telling |
| P1 | Opgelost | 2026-07-25 | YouTube-track kon verdwijnen | Cache een gecontroleerde track vanuit `/admin` | Lokale audio krijgt voorrang; uploaden van eigen/gelicentieerde audio is mogelijk | Spelen hing volledig af van de externe YouTube-URL |
| P1 | Opgelost | 2026-07-25 | Baantjer werd gekoppeld aan deel 2 of een live-uitvoering | Zoek/importeer `Baantjer` terwijl YouTube `Baantjer 2` of `Baantjer live` bovenaan zet | Alleen de officiële intro zonder extra deel/uitvoeringsmarkering wordt gekozen | `live` werd als ruis genegeerd en een los cijfer kon als onderdeel van de titel matchen |
| P2 | Open | 2026-07-25 | YouTube kan tijdelijk 403/429 geven | Playlist-import meerdere keren snel draaien | Import hervat netjes | Afhankelijk van YouTube-rate-limit |
| P2 | Open | 2026-07-25 | iTunes-preview is maximaal ongeveer 30 seconden | Track lokaal cachen | Preview blijft korte clip | Volledig nummer is niet beschikbaar via deze bron |
| P2 | Open | 2026-07-25 | Lokale media kan handmatig worden verwijderd | Verwijder een bestand uit `./media` | Admin ziet ontbrekend bestand en kan opnieuw cachen/uploaden | Database kan nog naar een niet-bestaand lokaal pad wijzen |

## Afhandelregels

- Een gemeld verkeerd nummer wordt eerst uitgezet en daarna onderzocht.
- Geen track vervangen zonder een nieuwe, succesvolle validatie.
- Geen fout oplossen door een brede of onzekere fallback toe te voegen.
- Een automatische YouTube-match is nooit een garantie; twijfel blijft zichtbaar
  als ontbrekende track totdat de admin controleert of uploadt.
