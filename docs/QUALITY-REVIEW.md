# Trackkwaliteit

## Doel

Films en series worden pas als betrouwbare speltrack gebruikt nadat een volledig lokaal audiobestand bestaat. YouTube is alleen een zoek- en downloadbron.

## Beoordelingsvolgorde

1. verificatie_score van 95% naar 0%.
2. Willekeurig binnen hetzelfde zekerheidsniveau.
3. Alleen bron = lokaal, download_status = available en werkt = true.
4. Een admin of Beta Tester kiest Goed of Fout.
5. Fout: de huidige kandidaat wordt afgekeurd; VenTune zoekt een ander YouTube-video-ID, downloadt die lokaal en zet hem opnieuw open.
6. Na drie afgekeurde kandidaten krijgt de track review_status = handmatig.

## Statuswaarden

- open: wacht op luisteren.
- goedgekeurd: bewust beluisterd en vertrouwd.
- afgekeurd: deze kandidaat mag niet opnieuw worden gekozen.
- handmatig: drie kandidaten afgekeurd; beheerder moet zelf een bron koppelen of uploaden.

## Bekendheid

Per track worden YouTube-views, likes, rating en duur opgeslagen. Per titel worden de hoogste views en likes opgeslagen.

- Onbekend: minder dan 250.000 views.
- Bekend: vanaf 250.000 views.
- Heel bekend: vanaf 1.000.000 views.
- Iconisch: vanaf 5.000.000 views.

TMDB-populariteit en stemmen blijven als aanvullende signalen beschikbaar. De admin kan de titelvelden handmatig bijstellen.

## Admin

Ga naar Kwaliteit → Trackcontrole. De lijst is eerst Films & Series. Gebruik YouTube views/likes bijwerken voor ontbrekende of oudere statistieken. De dagelijkse planner doet dit daarna automatisch opnieuw na zeven dagen.

## Beta Tester

In een lobby met profiel Beta Tester verschijnen Nummer klopt en Nummer klopt niet. Een foute beoordeling gebruikt dezelfde vervangingsroute als de admin. Het gewone spelersprofiel blijft beperkt tot goedgekeurde tracks.
