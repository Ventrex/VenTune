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
2. Open P1 — de bulkcontrole van alle nieuwe YouTube-matches en het handmatig
   beoordelen van de resterende meldingen. De code weigert onzekere matches,
   maar “altijd het juiste nummer” blijft alleen haalbaar met deze laatste
   admincontrole per titel.
3. Open P2 — automatische leeftijdsclassificatie, YouTube-rate-limit-herstel,
   curatie-dashboard, periodieke controle van ontbrekende lokale bestanden en
   het vullen van de volledige 1600+-catalogus met gevalideerde tracks.
4. Open P3/P4 — profielen, verdere spelvarianten en rechten-/onderzoekskeuzes.

## Afgerond in deze werkronde — 2026-07-26

- P1: categorie heet **Films & Series** en de standaardfilter kan nooit
  muziek bevatten; muziek blijft alleen een expliciete aparte keuze.
- P1: taalkeuze uitgebreid met **Amerikaans (geen NL)**; leeftijdskeuze heeft
  Alle leeftijden, 6+, 9+, 12+, 16+ en 18+.
- P1: zes meerkeuze-antwoorden gebruiken dezelfde genre-familie en geven
  geen willekeurige Moulin Rouge/Baantjer-afleiders bij Sciencefiction.
- P1: tracks worden binnen één spel niet opnieuw gekozen zolang er een andere
  geldige track bestaat; `keer_gespeeld` blijft de tweede afwisselingslaag.
- P1: teams, teamkeuze in de lobby en lobby-instellingen voor de host.
- P1: optionele leeftijdsbonus voor score: t/m 6 ×2, t/m 9 ×1,75,
  t/m 12 ×1,5, t/m 16 ×1,25 en t/m 18 ×1.
- P1: decenniumvragen vervangen door echte jaartalopties.
- P2: antwoord toont een directe film-/serielink, mobiele zes-keuze-layout,
  compacte adminweergave en instelbare spelerslettergrootte.
- P2: admin heeft genrekeuze voor TMDB-film/serie-import, voortgangsbalk en
  een veilige actie **YouTube zoeken voor titels zonder track**.

## Door te geven aan Codex

Gebruik bijvoorbeeld: **“Pak alle open P1-punten op.”**

De volgende opdracht is dan P2: lokale bestanden periodiek controleren,
downloadfouten opnieuw proberen, het curatie-dashboard uitbreiden en
TMDB/importbeheer verder opschalen.
