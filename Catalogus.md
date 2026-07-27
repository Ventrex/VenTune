# Jaartalcatalogus

De grote catalogus wordt bewust via de admin opgebouwd en niet als een
handgeschreven bestand in Git opgeslagen. Daardoor kan VenTune actuele TMDB-
resultaten dedupliceren, opnieuw uitvoeren en de toevoegreden bewaren.

## Omvang

De jaren worden inclusief geteld:

| Reeks | Per jaar | Aantal jaartallen t/m 2026 | Theoretisch maximum |
|---|---:|---:|---:|
| Films 1980–nu | top 100 | 47 | 4.700 |
| Series 1980–nu | top 100 | 47 | 4.700 |
| Nederlandstalige films 1950–nu | top 10 | 77 | 770 |
| Nederlandstalige series 1950–nu | top 10 | 77 | 770 |

Het werkelijke aantal kan lager zijn: een lopend jaar is nog niet compleet en
TMDB heeft niet voor elk oud jaartal 100 films of series met voldoende data.
Titels die in beide opdrachten voorkomen worden één keer opgeslagen en aan
meerdere collecties gekoppeld.

## Admin-volgorde

1. Open **Admin → Imports**.
2. Klik **Films top 100 + series top 100 per jaar**.
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
- `collecties`: `top100-per-jaar`, `top100-films`, `top100-series` en/of
  `nederlandstalig-top10`;
- `curatie_status`: eerst `te_beoordelen`, daarna door de admin goedkeuren;
- `nl_tv_bekend`: bepaalt of de titel in de standaard gecureerde selectie zit.

De ranglijst gebruikt TMDB-score met populariteit als tweede ordening en valt
bij dunne jaartallen gecontroleerd terug naar een lagere stemdrempel. Dit is
een reproduceerbare catalogusselectie, geen belofte dat elke automatische
YouTube-match juist is.
