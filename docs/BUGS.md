# Bekende bugs en risico’s

## Open

- TMDB kan niet bewijzen dat een titel ooit op Nederlandse televisie is uitgezonden. De NL-cataloguscontrole gebruikt daarom Nederlandse release/watch-regio en gecureerde collecties; twijfelgevallen blijven te beoordelen.
- Een browser kan autoplay blokkeren. De host krijgt hiervoor een knop om lokaal audio opnieuw te starten.
- Een YouTube-video kan verdwijnen voordat hij gedownload is. De database bewaart de fout en de admin kan een nieuwe kandidaat zoeken.

## Opgelost

- Toekomstige bonusjaartallen bij recente titels.
- Landcodes zoals PH in plaats van Filipijnen.
- Typevragen terwijl de quiz al Films & Series is.
- Melding zonder reden.
- Downloaden en zoeken stoppen bij een standaardlimiet van 250.
- Logo blijft door browsercache zichtbaar na upload.


## Prioriteiten voor de nieuwe kwaliteitsworkflow

### P0 — blokkeert spelen

- Geen nieuwe P0-bug bekend in deze wijziging. Als een lokale track niet start, eerst Admin → Controle → Lokale MP3-bestanden controleren draaien.

### P1 — eerstvolgende controle

- Productiecheck: migratie uitvoeren en controleren dat review_status, YouTube-statistieken en titel-bekendheidsvelden bestaan.
- Een volledige Trackcontrole-run uitvoeren met minimaal één goede, één foute en één ontbrekende kandidaat.
- Controleren dat yt-dlp in de servercontainer staat; zonder yt-dlp kunnen statistieken en alternatieve downloads niet worden opgehaald.
- Controleren dat de dagelijkse taak zichtbaar is onder Running jobs en coöperatief kan worden gestopt.

### P2 — verbetering

- Admin-lijst pagineren voor catalogi groter dan 300 titels.
- Handmatige stapel uitbreiden met direct luisteren en een vaste koppeling/uploadknop.
- Statistieken ophalen via een aparte provider als YouTube tijdelijk rate-limited is.

### P3 — ideeën

- Historie per track tonen: wie keurde goed/af, welke video-ID's zijn geprobeerd en waarom.
- Een trailerclassificatiescore naast de harde trailerfilter.
- Een bulkactie voor de handmatige stapel per collectie.
