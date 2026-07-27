# Jaartalcatalogus

De grote catalogus wordt bewust via de admin opgebouwd en niet als een
handgeschreven bestand in Git opgeslagen. Daardoor kan VenTune actuele TMDB-
resultaten dedupliceren, opnieuw uitvoeren en de toevoegreden bewaren.

## Omvang

De jaren worden inclusief geteld:

| Reeks | Per jaar | Aantal jaartallen t/m 2026 | Theoretisch maximum |
|---|---:|---:|---:|
| Populaire bioscoopfilms 1980–nu | max 50 | 47 | 2.350 |
| Populaire series 1980–nu | max 25, min 10 | 47 | 1.175 max |
| Populaire films 1950–nu in Nederland | top 10 | 77 | 770 |
| Populaire series 1950–nu in Nederland | top 10 | 77 | 770 |
| Cult Classics | gecureerde collectie | — | 24 starttitels |

Het werkelijke aantal kan lager zijn: een lopend jaar is nog niet compleet en
TMDB heeft niet voor elk oud jaartal 100 films of series met voldoende data.
Titels die in beide opdrachten voorkomen worden één keer opgeslagen en aan
meerdere collecties gekoppeld.

## Admin-volgorde

1. Open **Admin → Imports**.
2. Klik **Populaire films & series per jaar**.
3. Volg de taak in de taakmonitor. De import slaat alleen metadata op; nieuwe
   titels krijgen `curatie_status = te_beoordelen` en worden niet automatisch
   in het standaardspel gezet.
4. Klik daarna **YouTube zoeken voor titels zonder track**. YouTube blijft de
   leidende bron; onzekere, live- of verkeerde matches worden geweigerd en
   komen als melding terug.
5. Open **Downloads** en start de vooraf-download. Alleen volledig bevestigde
   tracks komen in `/media/downloads` en kunnen daarna zonder externe stream
   worden afgespeeld.

Deze catalogustaak vult uitsluitend films en series. Muziek-toplijsten vallen
hier nadrukkelijk buiten; muziek wordt alleen via de aparte YouTube/iTunes-
trackimport behandeld.

## Databasevelden

- `jaar`, `type`, `taal`, `land`, `genres`, `tmdb_id`: filter- en bonusdata;
- `toevoeg_reden`: waarom de titel is opgenomen, inclusief jaar en rang;
- `collecties`: `top100-per-jaar`, `top100-films`, `top100-series`,
  `top10-per-jaar-nl` en/of `cult-classics`;
- `curatie_status`: eerst `te_beoordelen`, daarna door de admin goedkeuren;
- `nl_tv_bekend`: bepaalt of de titel in de standaard gecureerde selectie zit.

De ranglijst gebruikt TMDB-score met populariteit als tweede ordening en valt
bij dunne jaartallen gecontroleerd terug naar een lagere stemdrempel. Films
gebruiken de Nederlandse release-regio en releasevormen; series krijgen de
Nederlandse regio-context mee zonder op productieland te filteren. Daardoor
kan een Duitse serie die in Nederland hoog eindigt blijven staan, terwijl
Duitse populariteitsresultaten zonder NL-context niet opnieuw worden gekoppeld.
Niet-Latijnse scripts, controle-tekens en verdachte metadata worden geweigerd.
Dit is een reproduceerbare catalogusselectie, geen belofte dat elke
automatische YouTube-match juist is.

## Veilige herbouw

Een nieuwe jaartalcatalogus verwijdert geen titels, tracks of MP3-bestanden.
Wel worden oude automatische cataloguskoppelingen losgemaakt en ongekeurde
oude entries tijdelijk uitgesloten. Titels die in de nieuwe Nederlandse
ranglijst terugkomen worden opnieuw gekoppeld en gaan terug naar
`te_beoordelen`.

**Cult Classics** is bewust een aparte collectie: films zoals *Idiocracy*,
*The Big Lebowski* en *Donnie Darko* hoeven niet in hun oorspronkelijke jaar
bij de populaire jaartalselectie te hebben gestaan om later alsnog herkenbare klassiekers te
worden.

Bekende vangnettels worden apart vastgehouden. **Sliders** wordt bijvoorbeeld
expliciet aan 1995 gekoppeld als de wisselende TMDB-populariteit hem niet in de
eerste discover-pagina zet.
