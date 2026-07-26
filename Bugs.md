# Bugs

Openstaande problemen en regressies. Voeg altijd datum, reproduceerstappen,
verwacht gedrag en werkelijk gedrag toe.

| Prioriteit | Status | Datum | Onderwerp | Reproduceerstappen | Verwacht | Werkelijk |
|---|---|---|---|---|---|---|
| P1 | Opgelost | 2026-07-26 | Spel bleef vanaf ronde 5 laden en een refresh verloor de ronde | Speel meerdere rondes en laat een overgang of verbinding tijdelijk falen | De server herstelt de actuele fase; audio laden geeft na een timeout een herstelactie; sessie blijft behouden | De client bleef op het scorebord/laden staan zonder herstelknop en een refresh replayde de ronde niet |
| P1 | Opgelost | 2026-07-26 | Admin toonde eerst een lange lijst met ontbrekende titels | Open `/admin` en ga naar import | Importknoppen staan direct zichtbaar; herstelwachtrij is apart | 221 titels stonden vóór de knoppen in dezelfde sectie |
| P1 | Opgelost | 2026-07-26 | Losse MP3-download leek niets te doen | Open een titel, klik op ⇩ en wacht op yt-dlp | Direct feedback, voortgang en eindfout/succes | De HTTP-knop wachtte stil op de volledige download |
| P1 | Opgelost | 2026-07-26 | iTunes stond vóór YouTube in sommige trackkeuzes | Titel heeft een YouTube- en iTunes-track, eventueel lokaal gedownload | YouTube wint; lokale YouTube-audio blijft herkenbaar als YouTube | Bronrangschikking keek alleen naar `lokaal`, waardoor iTunes lokaal kon winnen |
| P1 | Opgelost | 2026-07-26 | Admin-overzicht was niet actiegericht | Klik op een telling zoals Tracks nodig of Open meldingen | Direct naar de juiste herstel-/inzagelijst | Tegels waren alleen tekst |
| P1 | Opgelost | 2026-07-26 | Bestaande iTunes-tracks kregen niet vanzelf een nieuwe YouTube-poging | Open Imports terwijl oude iTunes-fallbacks bestaan | Eén adminactie zoekt de hele database opnieuw op YouTube en bewaart fallbacktracks bij twijfel | De algemene seedactie dekte niet altijd alle TMDB/database-titels |
| P1 | Opgelost | 2026-07-26 | MP3 werd pas tijdens spelstart gedownload | Start een spel met een niet-lokale track | Admin kan vooraf controleren en downloaden | Er was alleen handmatige download of pregame-download |
| P1 | Opgelost | 2026-07-26 | Verwijderde YouTube-URL werd pas tijdens spelen ontdekt | Download een verwijderde of geblokkeerde video | Admin ziet vooraf dat de URL niet bestaat | De fout kwam pas bij afspelen/downloaden naar voren |
| P2 | Opgelost | 2026-07-26 | Eén titel kon niet in meerdere spelversies zitten | Kies Frozen voor Films en Disney | Dezelfde titel verschijnt in beide selecties | Er was alleen film/serie als enkelvoudig filtertype |
| P0 | Opgelost | 2026-07-25 | GitHub-standaardbranch wees naar verouderde Spotify-fundering | Repo clonen zonder branch te kiezen | Actuele VenTune-versie wordt standaard uitgecheckt | Oude Claude-fundering werd uitgecheckt; standaardbranch is nu gesynchroniseerd met actuele VenTune-code |
| P1 | Opgelost | 2026-07-25 | Ronde kon zonder zichtbare vraag overslaan | Laat een ronde automatisch eindigen of laat bonusantwoord en bonustimer bijna tegelijk aflopen | Elke overgang start precies één volgende ronde met audio en `ronde:start` | Dubbele overgang naar scorebord/volgende ronde en recursieve trackverwijdering konden een ronde overslaan |
| P1 | Opgelost | 2026-07-25 | Hint was altijd het jaartal | Vraag meerdere hints bij een bekende titel | Hints geven cast, speelplek, kenmerken, letters en pas later het jaar | Elke eerste hint was hetzelfde jaartal; hoofdrollen komen nu uit TMDB als ze ontbreken |
| P1 | Opgelost | 2026-07-25 | Titel zonder track was niet zichtbaar als actie | Start een spel met filters waarin een titel geen bruikbare track heeft | Titel wordt overgeslagen zonder rondenummergat en verschijnt in `/admin` | Ontbrekende tracks bleven alleen impliciet in de telling |
| P1 | Opgelost | 2026-07-25 | YouTube-track kon verdwijnen | Cache een gecontroleerde track vanuit `/admin` | Lokale audio krijgt voorrang; uploaden van eigen/gelicentieerde audio is mogelijk | Spelen hing volledig af van de externe YouTube-URL |
| P1 | Opgelost | 2026-07-25 | Baantjer werd gekoppeld aan deel 2 of een live-uitvoering | Zoek/importeer `Baantjer` terwijl YouTube `Baantjer 2` of `Baantjer live` bovenaan zet | Alleen de officiële intro zonder extra deel/uitvoeringsmarkering wordt gekozen | `live` werd als ruis genegeerd en een los cijfer kon als onderdeel van de titel matchen |
| P1 | Opgelost | 2026-07-25 | Host speelde soms geen nummer na een nieuwe ronde | Laat meerdere rondes automatisch starten en vergelijk dit met handmatig opnieuw kiezen | Iedere ronde probeert na laden/buffering opnieuw te starten en toont bij blokkade een duidelijke tikknop | De YouTube-/audio-speler kon nog niet klaar zijn toen `ronde:audio` binnenkwam; er was geen betrouwbare retry |
| P1 | Opgelost | 2026-07-25 | GTST/andere titels konden een willekeurig gelijknamig nummer krijgen | Zoek een serie met meerdere gelijknamige YouTube-resultaten | Alleen resultaten met een intro/theme-signaal worden automatisch gekozen; live blijft altijd uitgesloten | Een exacte titelmatch zonder muzieksignaal kon hoger eindigen dan een echte intro |
| P1 | Opgelost | 2026-07-25 | Korte rondes konden nog haperen door live YouTube-buffering | Start 30 seconden of 1 minuut met YouTube-tracks | Geplande tracks worden voor spelstart lokaal gecachet als `yt-dlp`/`ffmpeg` beschikbaar zijn | Ronde startte soms voordat YouTube stabiel kon spelen |
| P1 | Opgelost | 2026-07-25 | Genummerde reekstitels moesten niet allemaal worden geblokkeerd | Vergelijk `Baantjer 2` met `Terminator 2` | Extra cijfer bij een niet-genummerde titel wordt geweigerd; officieel cijfer in titel/alias blijft toegestaan | Baantjer-fix kon te breed lijken zonder regressietest voor officiele deel 2-titels |
| P2 | Opgelost | 2026-07-25 | Dezelfde track werd vaker gekozen terwijl alternatieven bestonden | Koppel meerdere geldige tracks aan één titel en speel meerdere spellen | Minst gebruikte track wint; `keer_gespeeld` en `laatst_gespeeld` worden bijgewerkt | De database had al gebruikstellers, maar de spelquery sorteerde er niet op |
| P2 | Opgelost | 2026-07-25 | Jaren-90 preset had te weinig seedtitels | Kies jaren 90 in setup | Seed bevat genoeg 90s titels om variatie te geven en TMDB-import kan verder opschalen | Handgeschreven seed had 52 jaren-90 titels |
| P2 | Open | 2026-07-25 | YouTube kan tijdelijk 403/429 geven | Playlist-import meerdere keren snel draaien | Import hervat netjes | Afhankelijk van YouTube-rate-limit |
| P2 | Open | 2026-07-25 | iTunes-preview is maximaal ongeveer 30 seconden | Track lokaal cachen | Preview blijft korte clip | Volledig nummer is niet beschikbaar via deze bron |
| P2 | Open | 2026-07-25 | Lokale media kan handmatig worden verwijderd | Verwijder een bestand uit `./media` | Admin ziet ontbrekend bestand en kan opnieuw cachen/uploaden | Database kan nog naar een niet-bestaand lokaal pad wijzen |
| P1 | Opgelost | 2026-07-25 | Download werd als algemene cache beschreven en stond niet in een vaste submap | Download een track en herstart Docker | Bestand staat blijvend in `./media/downloads` en is via nginx speelbaar | Bestandslocatie was alleen `/media` en documentatie noemde vooral cache |
| P1 | Opgelost | 2026-07-25 | Een kind van 10 kon niet gericht worden beschermd tegen volwassen titels | Start een spel met een 10-jarige deelnemer | Leeftijdsfilter gebruikt de jongste deelnemer en sluit hogere leeftijdsgrenzen uit | Er was geen leeftijd in de join/setup-flow |
| P2 | Opgelost | 2026-07-25 | TMDB-import kon onbekende titels direct speelbaar maken | Draai een grote TMDB-import | Nieuwe titels krijgen reden `TMDB`, status `te_beoordelen` en vallen uit de standaardselectie | Nieuwe titels werden niet van gecureerde tv-titels onderscheiden |

## Afhandelregels

- Een gemeld verkeerd nummer wordt eerst uitgezet en daarna onderzocht.
- Geen track vervangen zonder een nieuwe, succesvolle validatie.
- Geen fout oplossen door een brede of onzekere fallback toe te voegen.
- Een automatische YouTube-match is nooit een garantie; twijfel blijft zichtbaar
  als ontbrekende track totdat de admin controleert of uploadt.
