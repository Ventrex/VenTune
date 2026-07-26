# Prioriteiten

Alle openstaande bugs, taken en ideeën krijgen een prioriteit. De prioriteit
gaat over volgorde en impact, niet over hoeveel code een item kost.

| Prioriteit | Betekenis | Richtlijn |
|---|---|---|
| **P0** | Blokkade of ernstig risico | Meteen oppakken: productie ligt stil, data kan beschadigen of veiligheid is in gevaar. |
| **P1** | Correctheid en betrouwbare speelbaarheid | Eerstvolgende werkpakket. Verkeerde muziek, onveilige vervanging en spelerkritieke fouten gaan voor. |
| **P2** | Beheer, diagnose en kwaliteitsverbetering | Oppakken na P1; maakt onderhoud en controle beter. |
| **P3** | Handige uitbreiding | Doen wanneer P0/P1/P2 leeg zijn of als het expliciet wordt gevraagd. |
| **P4** | Idee, onderzoek of bewuste keuze | Nog niet toezeggen; eerst haalbaarheid, rechten of ontwerp bepalen. |

## Werkafspraak

- Een nieuw open item krijgt altijd `P0`, `P1`, `P2`, `P3` of `P4`.
- Afgehandelde items houden hun prioriteit, zodat de geschiedenis begrijpelijk
  blijft.
- “Pak alle P1-punten op” betekent: werk alle open `P1`-regels in
  `Bugs.md`, `Todo.md` en `Stappenplan.md` af. Als een P1-idee in
  `Ideeen.md` eerst een besluit nodig heeft, zet dat eerst om naar een concrete
  Todo-regel.
- Na elke wijziging worden status, datum en eventueel de prioriteit bijgewerkt.

## Huidige volgorde

1. Open P0 — momenteel geen.
2. Open P1 — momenteel geen; verkeerde muziek, live/nummer-varianten,
   ronde-overgangen, lokale downloads, hostmeespelen en accounttoegang zijn
   afgedekt.
3. Open P2 — automatische leeftijdsclassificatie, YouTube-rate-limit-herstel,
   curatie-dashboard en periodieke controle van ontbrekende lokale bestanden.
4. Open P3/P4 — profielen, verdere spelvarianten en rechten-/onderzoekskeuzes.

## Door te geven aan Codex

Gebruik bijvoorbeeld: **“Pak alle open P1-punten op.”**

De volgende opdracht is dan P2: lokale bestanden periodiek controleren,
downloadfouten opnieuw proberen, het curatie-dashboard uitbreiden en
TMDB/importbeheer verder opschalen.
