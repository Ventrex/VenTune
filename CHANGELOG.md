# VenTune changelog

## [0.3.1] - 2026-07-26

### Beheer

- Imports en downloads zijn nu aparte admin-tabs. De lijst met ontbrekende
  tracks staat ingeklapt onder Downloads, zodat de actieknoppen direct zichtbaar
  zijn.
- Een losse MP3-download start nu als achtergrondtaak en toont voortgang en
  foutmeldingen; de browser lijkt niet meer stil te hangen tijdens `yt-dlp`.
- Tegels in het admin-overzicht zijn klikbaar en openen direct de pagina om het
  probleem te bekijken of te herstellen. Titels zijn filterbaar op ontbrekende,
  speelbare, afgekeurde en ontbrekende-vraag-status.
- YouTube blijft zichtbaar en krijgt voorrang boven iTunes, ook als een
  YouTube-track al lokaal is opgeslagen. Herkomst wordt als `youtube → lokaal`
  of `itunes → lokaal` getoond.

### Betrouwbaarheid

- Elke automatische YouTube-titel met het losse woord `live` wordt hard
  geweigerd, ook wanneer de video verder een sterke intro-match lijkt.

## [0.3.0] - 2026-07-26

### Voor spelers

- Spelsoort en spelcollectie zijn nu aparte filters. Een titel kan tegelijk
  film, Disney en Marvel zijn zonder dat de film/serie-identiteit verloren gaat.
- Nieuwe collecties zijn voorbereid voor **Disney**, **Pixar**, **Marvel**,
  **Streaming**, **Smartlappen** en **Rock**.
- Ook `muziek` is als apart inhoudstype toegevoegd; het standaardspel blijft
  bewust alleen films en series tonen.
- Frozen staat in Films + Disney; een titel kan meerdere collecties tegelijk
  hebben. De collectieselectie werkt met één of meerdere edities.

### Beheer

- Admin heeft aparte knoppen voor nieuwe films ophalen, nieuwe series ophalen,
  collectiecatalogi vullen en MP3's vooraf downloaden.
- Elke bulkdownload controleert eerst of de opgeslagen YouTube-/iTunes-URL nog
  bestaat. Daarna wordt de track als echte MP3 in `/media/downloads` gezet.
- Disney/Pixar vullen + downloaden kan vanuit één adminactie. Mislukte URLs
  blijven met reden zichtbaar en worden niet als speelbaar gemarkeerd.
- De tab **Spelcollecties** beheert bestaande edities en kan nieuwe collecties
  toevoegen zonder codewijziging. Titels kunnen vanuit het titelbeheer aan
  meerdere collecties worden gekoppeld.
- TMDB kan gericht nieuwe films of series ophalen in plaats van altijd beide.

## [0.2.6] - 2026-07-25

### Voor spelers

- Setup heeft nu een leeftijdsfilter, waaronder **Gezinsvriendelijk t/m 10**.
  Een opgegeven leeftijd van een speler kan de selectie automatisch verder
  begrenzen op de jongste deelnemer.
- De standaardcatalogus gebruikt alleen goedgekeurde titels die als bekend van
  Nederlandse tv zijn gemarkeerd. TMDB-imports blijven eerst op **te beoordelen**.
- De basislijst is uitgebreid met herkenbare Nederlandse kinderklassiekers en
  veel meer Amerikaanse films en series.

### Beheer

- `/admin` heeft tabs voor overzicht, titels/muziek, imports/downloads,
  meldingen, users, database en uiterlijk.
- Elke titel bewaart nu een toevoegreden, curatiestatus, Nederlandse-tv-status
  en leeftijdsgrens.
- Downloads zijn echte lokale mp3-bestanden in `./media/downloads`, met Docker-
  volume en nginx-toegang; uploads staan in `./media/uploads`.
- Uiterlijk, kleuren, teksten, lettertype en logo zijn vanuit de admin-tabs
  aanpasbaar. Het admin-wachtwoord blijft uitsluitend in `.env`.
- De databasetab kan exporteren en beperkte categorieën veilig opschonen.

## [0.2.5] - 2026-07-25

### Voor spelers

- Jaren 90 bevat nu veel meer seedtitels: van 52 naar 132 titels in
  `seed/titels.json`.
- "Heel nummer" is de standaard speeltijd. VenTune blijft maximaal 5 minuten
  per ronde gebruiken.
- Nieuwe antwoordmodus: **6 opties**. De host kan per spel kiezen tussen typen
  of zes meerkeuze-antwoorden.
- Nieuwe hulplijn bij meerkeuze: **verwijder 3 foute antwoorden**. Bij 10
  rondes krijgt elke speler 1 van deze hulplijn, bij 20 rondes 2, bij eindeloos
  3.
- Bonusvragen gebruiken voortaan ook zes opties; oude 4-optievragen worden bij
  opnieuw genereren opgewaardeerd.

### Betrouwbaarheid

- Bij spelstart probeert de server de geplande YouTube-tracks vooraf lokaal te
  cachen met `yt-dlp`/`ffmpeg`. Als dat lukt speelt de ronde vanaf `/media`
  in plaats van live via YouTube.
- YouTube-downloads worden begrensd op maximaal 5 minuten vanaf de ingestelde
  startpositie.
- Officiele genummerde titels zoals **Terminator 2** blijven toegestaan, terwijl
  extra deelcijfers zoals **Baantjer 2** geweigerd blijven.

## [0.2.4] - 2026-07-25

### Voor spelers

- De host-audio wacht nu op een geladen YouTube-/audio-element en probeert
  automatisch opnieuw wanneer de eerste ronde nog aan het bufferen is. Bij een
  echte afspeelfout verschijnt direct de knop **Tik om de muziek te starten**.
- Tracks worden niet meer telkens in dezelfde vaste databasevolgorde gekozen:
  `keer_gespeeld` en `laatst_gespeeld` bepalen nu de afwisseling binnen de
  veilige bronvolgorde. De teller is ook zichtbaar in het adminportaal.

### Betrouwbaarheid

- `live` en `livestream` zijn absolute uitsluitregels voor automatische
  matches, ook bij bestaande tracks die eerder al waren opgeslagen.
- Automatische YouTube-zoekresultaten moeten nu expliciet een intro/theme-
  signaal hebben. Vooral series zoals GTST worden daardoor niet meer aan een
  willekeurig nummer met alleen dezelfde titelwoorden gekoppeld.

## [0.2.3] - 2026-07-25

### Betrouwbaarheid

- YouTube- en playlistmatches weigeren nu harde verkeerde varianten zoals
  `Baantjer live`, `Baantjer deel 2`, `Baantjer episode 2` en extra
  deelcijfers. Een viercijferig releasejaar blijft toegestaan.
- Dezelfde controle draait vóór titelopschoning én vóór de uiteindelijke
  YouTube-keuze. Een twijfelgeval wordt dus niet meer door populariteit of
  weergaven gekozen; de titel blijft dan beschikbaar voor handmatige actie in
  `/admin`.

## [0.2.2] - 2026-07-25

### Voor spelers

- Hints zijn nu titelgericht: hoofdrollen, speelplek, genre/land en
  beginletters zoals `S.....s` voor **Sliders**. Het jaartal is een reservehint.
- Lokale audio wordt afgespeeld zodra de admin een track heeft gecachet of
  een eigen/gelicentieerd audiobestand heeft geüpload. Daardoor is spelen niet
  meer afhankelijk van het blijvend bestaan van één YouTube-video.

### Voor beheerders

- Titels zonder speelbare track komen automatisch in **Tracks nodig** en worden
  niet stil als een ronde gebruikt.
- De admin kan een gecontroleerde YouTube-track expliciet lokaal cachen met
  `yt-dlp`/`ffmpeg`, of een eigen/gelicentieerd audiobestand uploaden.
- Hostaccounts kunnen vanuit `/admin` worden aangemaakt, hernoemd,
  uitgeschakeld en van een nieuw wachtwoord worden voorzien.

### Veiligheid en betrouwbaarheid

- Er wordt nooit automatisch een willekeurige YouTube-video gedownload.
- Een onzekere track blijft geweigerd; de admin moet een match controleren of
  handmatig audio toevoegen.

## [0.2.1] - 2026-07-25

### Voor spelers

- Ronde-overgangen zijn stabieler: een nummer wordt niet meer stil
  overgeslagen en elke nieuwe ronde toont weer de normale vraag en audio.
- Het scorebord gaat automatisch door naar de volgende ronde; een dubbele
  overgang door een gelijktijdige timer of antwoord is afgevangen.

## [0.2.0] - 2026-07-25

### Voor spelers

- Hosts kunnen een eigen hostaccount registreren en inloggen; spelers hebben
  nog steeds geen account nodig.
- De host kan nu op het grote hostscherm zelf meespelen, antwoorden insturen,
  hints gebruiken en bonusvragen beantwoorden.
- Nieuw scherm **Wat is nieuw?** is vanaf het startscherm bereikbaar.
- De host kan een ronde pauzeren en opnieuw afspelen.
- Na een ronde worden titel, poster, jaar, land en genres duidelijk getoond.
- Spelers kunnen een verkeerd nummer of ontbrekend geluid melden.

### Betrouwbaarheid

- YouTube is nu de hoofdbron; iTunes wordt alleen als fallback gebruikt.
- Titels en aliassen worden nu gecontroleerd als volledige woordreeks.
- Een expliciet afwijkend jaartal wordt geweigerd.
- Onzekere YouTube- en iTunes-resultaten worden niet opgeslagen.
- Als een titel een TMDB-koppeling heeft, controleert VenTune naast de lokale
  aliasmatch ook de officiële TMDB-titel en het jaar.
- Playlisttracks worden atomair vervangen; een mislukte import wist geen goede track.
- Een expliciete melding **verkeerd nummer** schakelt die track direct uit.
- Imports zijn server-side vergrendeld, zodat twee adminvensters elkaar niet
  kunnen overschrijven.

### Beheer

- De admin kan per titel automatisch de beste YouTube-intro zoeken en opslaan.
- Trackverificatie krijgt een score en uitlegbare reden.
- De database is voorbereid op lokale audio in het `/media`-volume.
- Een handmatig gestart script kan toegestane iTunes-previews lokaal cachen.
- Admin kan hostaccounts deactiveren en een hostwachtwoord resetten; het
  admin-wachtwoord blijft uitsluitend in `.env`.
- CI test de Nederlandse matchfixtures en de echte PostgreSQL-trackkeuze.
- De host telt mee als actieve deelnemer voor ronde- en bonusafronding;
  offline spelers worden automatisch niet meegeteld.
