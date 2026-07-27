# VenTune changelog

## [0.5.1] - 2026-07-27

### Spelstart gebruikt alleen echte lokale MP3’s

- Start spel downloadt niets meer en probeert geen externe fallback meer.
- De rondepool wordt opgebouwd uit titels waarvan het lokale MP3-bestand echt
  op disk bestaat; titels met een stale databasepad worden overgeslagen.
- Als een titel zoals *The White Lotus* wel als `lokaal/available` in de
  database staat maar het bestand ontbreekt, wordt de track op `failed` gezet
  en komt de titel in Admin als herstelmelding.
- De voorbereidingstekst heet nu **Lokale MP3’s controleren…** zodat duidelijk
  is dat er niet tijdens de spelstart wordt gedownload.
- Alleen als er voor de gekozen filters niet genoeg echte lokale MP3’s zijn,
  stopt de start met een duidelijke melding hoeveel lokale nummers beschikbaar
  zijn.

## [0.5.0] - 2026-07-27

### Lokaal-eerst audio

- Een titel met een gezonde lokale MP3 wordt nergens opnieuw gezocht of URL-gecontroleerd.
- Het spel telt en gebruikt uitsluitend `bron=lokaal` met `download_status=available`.
- YouTube is alleen nog zoek-/downloadbron; iTunes is uit de automatische import,
  adminzoeker en spelerflow gehaald. Oude iTunes-rijen blijven alleen als historie staan.
- De admin kan vanuit de filter **Zonder lokale MP3** automatisch YouTube zoeken en
  daarna de MP3 downloaden. Downloads staan blijvend in `/media/downloads` en zijn
  maximaal vijf minuten lang.
- Een playlist-refresh overschrijft geen lokale track. De dagelijkse aanvulling en
  bulkdownload slaan lokale bestanden over.

### Admin en spelers

- Een verkeerd-nummer-melding kan vanuit dezelfde kaart een YouTube-kandidaat zoeken,
  koppelen en direct laten downloaden.
- Spelers kunnen na de onthulling een bonusvraag met zes opties insturen. De admin
  heeft een aparte tab om vragen goed te keuren of af te wijzen.
- Titels hebben nu een studio/producent, een adminactie om ontbrekende studio’s via
  TMDB aan te vullen en leeftijdsfilters vanaf alle leeftijden, 6+, 9+, 12+, 16+ en 18+.
- Overzicht, ontbrekende-tracklijst en kwaliteitsdashboard rekenen speelbaarheid nu
  op basis van lokale MP3’s, niet op basis van een externe URL.

## [0.4.0] - 2026-07-27

### Nederlandse catalogus en Cult Classics

- Jaartalcatalogus gebruikt nu de Nederlandse regio-context en populariteit:
  maximaal 50 bioscoopfilms en 25 series per jaar vanaf 1980, met minimaal 10
  bruikbare series in dunne jaren; top 10 films en series per jaar vanaf 1950.
- Duits productieland is geen blinde uitsluitingsregel: een titel mag blijven
  als hij in de Nederlandse selectie thuishoort. Oude automatische
  cataloguskoppelingen worden bij een nieuwe run veilig losgemaakt.
- Niet-Latijnse scripts, controle-tekens en verdachte muziekmetadata worden
  geweigerd. Admin heeft een herstelbare actie **Onveilige tekens uitsluiten**.
- Nieuwe collectie **Cult Classics**, met onder meer *Idiocracy*, voor films
  die pas later een cultstatus kregen.
- Populaire selectie heeft nu een expliciet vangnet voor iconische series;
  *Sliders* wordt aan 1995 gekoppeld als TMDB hem niet hoog genoeg rangschikt.

### Audio starten

- De host wacht bij **Start spel** niet meer op een trage YouTube-iframe als de
  ronde lokaal opgeslagen audio gebruikt.
- De host meldt nu zichtbaar: audio wordt geladen, speelt, of kon niet starten.
  Bij een fout staat er direct een knop **Opnieuw afspelen** in plaats van een
  stille visualizer.
- Ronde 1 toont ook wanneer de audio-opdracht nog wordt klaargezet. Daarmee is
  het onderscheid tussen “nog laden” en “geen geluid” zichtbaar.

### Admin: catalogus en meldingen

- Titels & muziek toont per film/serie direct de actuele bron: **MP3 lokaal**,
  **YT**, **iTunes** en open meldingen. De filters voor films, series, lokaal,
  nog extern en meldingen zijn klikbaar.
- Een melding kan vanuit Admin opnieuw op YouTube zoeken, de kandidaat koppelen
  en direct goedkeuren. Een bestaande gemelde track kan ook apart worden
  goedgekeurd; daarna doet de titel weer mee.
- De melding toont nu type, jaar, trackstatus, downloadstatus en toelichting.
- Overzicht bevat aparte aantallen voor films en series en lege meldingenlijsten
  leggen uit wat de volgende actie is.

## [0.3.9] - 2026-07-27

### Voor spelers en hosts

- De knop **Start spel** geeft direct feedback, ook als lokale voorbereiding
  of een databaseactie nog bezig is. Serverfouten worden concreet getoond.
- Een kleine filterselectie blokkeert het spel niet meer bij minder dan 15
  titels. Met één volledig lokaal beschikbaar nummer kan een spel starten; het
  aantal rondes wordt automatisch begrensd op de selectie.

### Catalogus en beheer

- Nieuwe admin-taak **Populaire films & series per jaar**. De aparte
  Nederlandse top 10 bevat eveneens alleen films en series; muziek wordt niet
  door deze catalogustaak gevuld.
- 1980–nu: maximaal 50 films en 25 series per jaartal; de werkelijke lijst mag
  kleiner zijn. 1950–nu: maximaal 10 films en 10 series per jaartal in de
  Nederlandse regio-context.
- Elke geïmporteerde titel bewaart TMDB-metadata, jaar, rang, collectie en
  toevoegreden. De titels komen eerst op `te_beoordelen`; YouTube zoeken en
  MP3-downloads zijn aparte, zichtbare admin-taken.
- De admin-taakmonitor toont ook de voortgang van deze grote catalogusimport.

## [0.3.8] - 2026-07-26

### Betrouwbaarder spelen

- Een spel start pas nadat alle geplande nummers volledig naar de persistente
  lokale mediamap zijn gedownload en gecontroleerd. Een mislukte download mag
  niet meer terugvallen op live YouTube tijdens de ronde.
- De host ziet tijdens het voorbereiden per nummer de voortgang. Lokale audio
  gebruikt nu automatisch voorladen en korte retries bij het starten.
- Een ontbrekend lokaal bestand stopt de overgang met een herstelmelding in
  plaats van stil een ronde over te slaan.

### Spelregels

- Normale titelpunten lopen van 100 naar 0 in 10 seconden.
- Een solo-speler mag een tweede titelgok doen; die tweede gok telt voor 50%.
- Bonusjaartallen worden gecontroleerd tegen de gekozen periode en het lokale
  titeljaar.
- Nieuwe kindvriendelijke editie: alleen familie/animatie/fantasy/musical of
  kindercollecties tot en met 12+, 200 punten en 20 seconden leestijd.

### Topscores

- Het startscherm toont aparte lijsten voor beste gemiddelde per spel, meeste
  gespeelde spellen en gemiddelde punten per ronde. Daardoor worden spellen
  met 10 vragen en eindeloze spellen eerlijker vergeleken.

## [0.3.7] - 2026-07-26

### Lokale muziek en imports

- Iedere YouTube-, iTunes- en playlistzoekactie wordt gelogd in `zoek_log`,
  inclusief cache-hit, lege uitkomst en foutreden.
- Werkende gecontroleerde tracks worden zeven dagen niet opnieuw opgezocht.
- Een gezonde lokale download is voortaan de bron van waarheid; de externe URL
  wordt dan niet meer gecontroleerd.
- Geplande tracks worden vóór de eerste ronde lokaal voorbereid. YouTube wordt
  gedownload als MP3 met een maximum van vijf minuten en Docker bewaart dit in
  de persistente map `./media/downloads`.
- Het admin-overzicht toont nu ook het aantal zoeklogregels en geeft een
  concrete foutmelding als een telling niet kan worden gelezen. De zoeklog zit
  in de database-export.

### Bonusvragen en antwoorden

- Een verkeerde bonusoptie wordt voor alle spelers verwijderd en rood getoond.
  Alleen de speler die fout zat krijgt vijf seconden cooldown.
- Bonusvragen hebben geen automatische eindtijd meer: goed antwoord, opgeven of
  de host bepaalt het einde. Sneller goed antwoorden levert meer punten op.
- Meerdere spelers hebben één titelgok; een solo-speler mag maximaal twee keer
  gokken, waarbij de tweede goede gok voor 50% telt. Antwoordtiles kleuren fout
  donkerrood en goed groen.

### Beheer

- Afgehandelde meldingen kunnen na bevestiging definitief worden verwijderd.

## [0.3.6] - 2026-07-26

### Kritiek opgelost

- Setup telt Films & Series weer correct; de PostgreSQL-enumvergelijking is
  typeveilig gemaakt.
- Leeftijd jongste en oudste deelnemer kunnen nu normaal worden gewist en
  opnieuw ingevoerd, met begrenzing pas na invoer.
- Een tellingfout blijft niet meer verborgen achter oneindig laden; Setup toont
  een foutmelding met knop **Opnieuw proberen**.

## [0.3.5] - 2026-07-26

### Voor spelers

- YouTube-first muziek vernieuwen start weer correct vanuit het admin-portaal.

### Beheer

- Lopende admin-taken tonen naam, status, huidige titel en voortgang.
- Dagelijkse updates zijn per onderdeel instelbaar: playlists, TMDB,
  ontbrekende YouTube-tracks, gecontroleerde downloads en lokale media.
- Herstarten van een verwijderde lokale kopie gebruikt de bewaarde originele
  YouTube- of iTunes-bron.

## [0.3.4] - 2026-07-26

### Voor spelers

- Nieuwe spelmodus **Alleen gecontroleerde nummers** voor quizavonden waarop
  alleen betrouwbare tracks mogen worden gebruikt.
- Hosts hebben een profielpagina met eigen presets, accountstatus en recente
  spel-/scorehistorie; de host blijft aangemeld tijdens het spelen.
- De changelog maakt nu onderscheid tussen spelers-, host- en adminnieuws.

### Betrouwbaarheid

- YouTube 403/429-fouten gebruiken een gedeelde backoff met oplopende wachttijd
  en willekeurige spreiding, zodat grote imports minder snel vastlopen.
- Lokale audio wordt met bestandsgrootte en SHA-256 gecontroleerd. Ontbrekende
  of gewijzigde bestanden worden als fout gemarkeerd en niet stil afgespeeld.
- Mislukte MP3-downloads kunnen vanuit Admin opnieuw worden geprobeerd.

### Beheer

- Nieuw kwaliteitsdashboard met verificatie-, download- en meldingscijfers.
- Meldingen kunnen per titel worden gegroepeerd; vanuit een melding kan de
  admin opnieuw een YouTube-kandidaat zoeken zonder automatisch op te slaan.
- Importpreview toont vooraf nieuwe, bijgewerkte en behouden seedtitels.
- Automatische playlist-refresh is vanuit Admin instelbaar met veilige limiet;
  een dagelijkse lokale-bestandscontrole kan worden aan- of uitgezet.
- Gecontroleerde YouTube-tracks kunnen in één bulkactie vooraf worden gedownload.
- Afgekeurde tracks kunnen als JSON-controlelijst worden geëxporteerd.
- TMDB-import geeft nieuwe titels een voorzichtige automatische leeftijdsgrens;
  de admin kan deze altijd handmatig corrigeren.

## [0.3.3] - 2026-07-26

### Filters en catalogus

- De categorie heet nu **Films & Series**; muziek wordt niet meer onbedoeld
  meegenomen. Films, series en muziek blijven als aparte inhoudstypen filterbaar.
- Taal uitgebreid met **Amerikaans (geen NL)**.
- Leeftijdskeuze uitgebreid naar Alle leeftijden, 6+, 9+, 12+, 16+ en 18+.
- Setup toont voortaan afzonderlijk hoeveel titels in de catalogus staan en
  hoeveel daarvan een speelbare, gecontroleerde track hebben. De standaard-
  bekendheidsdrempel blokkeert de gecureerde catalogus niet meer onnodig.
- Odd Squad en Henry Danger toegevoegd aan de gecureerde jeugdseries; bestaande
  klassiekers zoals A-Team, Bassie en Adriaan, Swiebertje, Heidi en Vrouwtje
  Theelepel blijven apart met hun toevoegreden geregistreerd.

### Spel

- Zes antwoordopties zijn genregericht en geven geen willekeurige afleiders.
- Een track wordt binnen één spel niet opnieuw gekozen als een andere geldige
  track beschikbaar is.
- Teams kunnen in de lobby worden aangemaakt; spelers en de host kiezen daar
  zelf hun team.
- De host kan lobby-instellingen nog aanpassen voordat het spel start.
- Optionele leeftijdsbonus voor punten toegevoegd.
- Decenniumvragen zijn vervangen door echte jaartallen.
- Het onthulde antwoord bevat een directe TMDB-link naar de film of serie.
- De meerkeuze-layout is op mobiel compacter; de status “Wachten…” heet nu
  **Afspelen… wachten op de anderen**.

### Admin

- TMDB-imports kunnen per genre voor films of series worden gestart.
- Imports tonen voortgang of een zichtbare onbepaalde voortgang zolang TMDB geen
  betrouwbare totaaltelling geeft.
- Nieuwe actie: **YouTube zoeken voor titels zonder track**. Deze vult de grote
  catalogus aan zonder bestaande, gecontroleerde tracks blind te vervangen.
- Admin is compacter gemaakt en spelers kunnen via Uiterlijk een kleinere of
  grotere tekstschaal instellen.

## [0.3.2] - 2026-07-26

### Betrouwbaarheid

- De server kan de actuele ronde, bonusvraag of het scorebord opnieuw naar een
  (opnieuw) verbonden browser sturen. Een refresh verliest daardoor niet meer
  automatisch de spelpositie zolang de sessie-token nog bestaat.
- Als een overgang naar de volgende ronde faalt, verschijnt er een actie om
  de overgang opnieuw te plannen zonder de lobby te verlaten. De retry bewaakt
  het rondenummer zodat ronde 4 niet stil naar ronde 6 springt.
- Host-audio blijft niet onbeperkt wachten op metadata, `play()` of de
  YouTube-player. Na een timeout verschijnt een duidelijke knop om opnieuw te
  verbinden of de audio opnieuw te starten.

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
- De import-tab heeft een aparte actie **YouTube voor hele database opnieuw
  zoeken**. Die vervangt alleen wanneer een gecontroleerde YouTube-match wordt
  gevonden en laat bestaande iTunes-fallbacks anders ongemoeid.

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
