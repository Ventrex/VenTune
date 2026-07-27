# Todo

## Eerstvolgend

- [x] **P0** Start spel altijd directe voortgang/foutfeedback geven en een
      achtergebleven server-spelstate opruimen.
- [x] **P1** Filtertelling niet langer op minimaal 15 titels blokkeren; één
      lokale titel is geldig en het spel meldt wanneer er minder rondes dan
      gevraagd beschikbaar zijn.
- [x] **P1/P2** Herhaalbare populaire film- en seriecatalogus toevoegen:
      maximaal 50 bioscoopfilms en 25 series per jaar vanaf 1980, met minimaal
      10 bruikbare series in een dun jaar, plus top 10 films en series in
      Nederland vanaf 1950. Muziek valt buiten deze taak. Metadata, rang,
      collectie en toevoegreden worden opgeslagen.
- [x] **P1** Nederlandse regiocontext gebruiken; productieland is geen
      automatische uitsluitingsregel.
- [x] **P1** Oude automatische cataloguskoppelingen veilig losmaken bij een
      nieuwe run; titels, tracks en downloads blijven herstelbaar.
- [x] **P1** Cyrillisch, Arabisch, CJK, controle-tekens en vergelijkbare
      vervuilde titel-/audiometadata weigeren.
- [x] **P2** Aparte collectie **Cult Classics** met uitlegbare startselectie,
      waaronder *Idiocracy*.
- [x] **P1** Iconische vangnettels buiten de momentopname van TMDB-populariteit
      vastleggen, te beginnen met *Sliders* (1995).
- [x] **P2** Jaartalcatalogus als zichtbare admin-taak met voortgang aanbieden;
      YouTube zoeken en lokale MP3-downloads bewust als aparte vervolgstappen
      laten draaien.
- [ ] **P1** Na de catalogusimport de resterende meldingen zonder betrouwbare
      YouTube-match nalopen en handmatig goedkeuren of eigen/licentie-audio
      uploaden.

- [x] **P1** Spelstart blokkeren totdat alle geplande tracks 100% lokaal zijn
      opgeslagen en na een diskfout niet stil naar YouTube terugvallen.
- [x] **P1** Bonusvragen controleren tegen het geselecteerde periodefilter en
      het titeljaar als bron van waarheid gebruiken.
- [x] **P1** Solo-speler een tweede titelgok geven tegen 50% van de normale
      titelpunten; bij meerdere spelers blijft één gok de regel.
- [x] **P1** Kindvriendelijke editie toevoegen met kindcatalogusfilter,
      200-puntenbasis en 20 seconden leestijd.
- [x] **P2** Topscores splitsen in beste gemiddelde per spel, meeste spellen en
      gemiddelde punten per ronde; de laatste maakt eindeloze spellen eerlijk
      vergelijkbaar met spellen van 10 vragen.

- [x] **P1** Zoekgeschiedenis opslaan voor iedere YouTube-, iTunes- en
      playlistactie; lege en foutresultaten tellen ook mee.
- [x] **P1** Werkende gecontroleerde tracks minimaal zeven dagen overslaan;
      een expliciete titelactie mag gericht opnieuw zoeken.
- [x] **P1** Lokale beschikbare audio als bron van waarheid gebruiken en de
      oorspronkelijke URL niet meer controleren zolang het bestand gezond is.
- [x] **P1** Geplande tracks vóór de eerste ronde lokaal voorbereiden met een
      YouTube-fragment van maximaal vijf minuten.
- [x] **P1** Bonusopties globaal verwijderen na een fout, speler-cooldown van
      vijf seconden, geen bonus-timeout en sneller antwoord beloont meer.
- [x] **P1** Titelantwoord per speler begrenzen; meerdere spelers één gok en
      solo maximaal twee; fout/groen-rood feedback blijft zichtbaar.
- [x] **P2** Admin-overzicht vullen met nulwaarden/foutdiagnose, zoeklog-tegel
      en zoeklog in de JSON-export.
- [x] **P2** Opgeloste meldingen definitief verwijderbaar maken.

- [x] **P1** Categorie **Films & Series** expliciet tonen en muziek uit de
      standaardkeuze houden; meerdere inhoudstypen blijven via één keuze
      mogelijk.
- [x] **P1** Taalkeuze uitbreiden met **Amerikaans (geen NL)** en de
      leeftijdskeuzes Alle leeftijden, 6+, 9+, 12+, 16+ en 18+.
- [x] **P1** Meerkeuze-afleiders beperken tot dezelfde genre-familie en bij
      voorkeur hetzelfde inhoudstype.
- [x] **P1** Dezelfde track binnen één spel voorkomen wanneer een alternatief
      bestaat; de gebruiksteller blijft als extra spreidingslaag actief.
- [x] **P1** Teams maken in de lobby, spelers zelf laten kiezen en de host
      lobby-instellingen laten opslaan.
- [x] **P1** Optionele leeftijdsweging voor punten instelbaar maken.
- [x] **P1** Decennium-bonusvragen vervangen door echte jaartallen.
- [x] **P2** TMDB-link tonen op het onthulde antwoord, meerkeuze mobiel compacter
      maken en spelerslettergrootte vanuit Uiterlijk instelbaar maken.
- [x] **P2** Admin-imports per genre en een zichtbare voortgangsbalk toevoegen.
- [x] **P1** Adminactie toevoegen die alleen titels zonder bruikbare track op
      YouTube zoekt; bestaande tracks worden daarbij niet overschreven.
- [ ] **P1** De ontbrekende-tracklijst na de bulkactie handmatig nalopen en
      twijfelgevallen goedkeuren of een eigen/licentie-audio uploaden.

- [x] **P1** Echte lokale downloads onderbrengen in persistente Docker-mappen
      `/media/downloads` en `/media/uploads`; een cache-entry zonder bestand
      mag niet als lokale track worden afgespeeld.
- [x] **P1** Film/serie en officiële genummerde filmtitels gescheiden houden:
      `Baantjer 2`/`deel 2` blijft geen automatische seriematch, terwijl een
      officiële film zoals `Terminator 2` wel mag.
- [x] **P1** Leeftijdsfilter toevoegen en de jongste opgegeven spelerleeftijd
      gebruiken als veilige bovengrens voor het spel.
- [x] **P2** Titelcuratie vastleggen met toevoegreden, Nederlandse-tv-vlag,
      status en leeftijdsgrens; TMDB/playlist-import komt standaard op
      `te_beoordelen`.
- [x] **P2** Admin-portaal opdelen in tabs voor overzicht, titels, imports,
      meldingen, users, database en uiterlijk.
- [x] **P2** Admin-uiterlijk uitbreiden met kleuren, teksten, lettertype en
      logo-upload; instellingen worden publiek toegepast maar bevatten geen
      admingeheimen.
- [x] **P2** Database-tab toevoegen met export en beperkte, bevestigde
      opschoonacties.
- [x] **P2** Catalogus uitbreiden met Nederlandse jeugdklassiekers en een
      brede set Amerikaanse tv-series en films.

- [x] **P1** Host kan meespelen vanaf hetzelfde scherm waarop de muziek wordt
      afgespeeld; hostscore en bonusantwoorden tellen mee.
- [x] **P1** Admin-accountbeheer toegevoegd: host deactiveren en wachtwoord
      resetten zonder het admin-wachtwoord uit `.env` te vervangen.
- [x] **P1** Admin laat verificatiescore, volledige reden en audiobron zien.
- [x] **P1** PostgreSQL-integratietest/CI toegevoegd met een
      verkeerde-track-scenario.
- [x] **P1** TMDB-controlelaag toegevoegd voor officiële titel en jaar naast
      de lokale titel-/aliascontrole.
- [x] **P1** Ronde-overgangen idempotent gemaakt: timers, bonusafronding en
      hostacties kunnen geen ronde dubbel starten of stil overslaan.
- [x] **P1** Variabele hints toegevoegd: hoofdrollen, speelplek, genre/land,
      beginletters en het jaar als reservehint.
- [x] **P1** Titels zonder bruikbare track melden en in een admin-wachtrij tonen.
- [x] **P1** Admin kan een betrouwbare YouTube-track lokaal cachen; lokale audio
      krijgt voorrang bij het spelen.
- [x] **P1** Admin kan een eigen of gelicentieerd audiobestand uploaden en koppelen.
- [x] **P1** YouTube-/playlistmatches weigeren `live`, deel/aflevering-markeringen
      en extra deelcijfers; Baantjer is als regressie vastgelegd.
- [x] **P1** Host-audio robuuster starten: wachten op metadata/player-ready en
      automatisch opnieuw proberen bij een late ronde-overgang.
- [x] **P1** Automatische seriesearch alleen accepteren met een intro/theme-
      signaal; `live` en `livestream` altijd blokkeren.
- [x] **P1** Nieuwe spellen proberen geplande YouTube-tracks vooraf lokaal te
      cachen; rondes spelen daarna direct vanaf `/media` wanneer dat lukt.
- [x] **P1** "Heel nummer" standaard maken met een harde grens van 5 minuten.
- [x] **P1** Meerkeuzemodus met 6 antwoordopties toevoegen.
- [x] **P1** Hulplijn "verwijder 3 foute antwoorden" toevoegen met voorraad:
      10 rondes = 1, 20 rondes = 2, eindeloos = 3.
- [x] **P1** Officiele genummerde titels zoals Terminator 2 toestaan zonder
      Baantjer 2/deel 2 opnieuw toe te laten.
- [x] **P2** Trackgebruik (`keer_gespeeld`, `laatst_gespeeld`) gebruiken voor
      afwisseling en de teller in `/admin` tonen.
- [x] **P2** Jaren-90 seed uitbreiden van 52 naar 132 titels.
- [x] **P1** Admin kan hostaccounts aanmaken, bewerken, uitschakelen en
      wachtwoorden resetten; het admin-wachtwoord blijft in `.env`.
- [x] **P2** Playlist-import periodiek uitvoeren vanuit admin met voortgang.
- [x] **P2** Lokale audio ook kunnen toevoegen via admin zonder handmatige
      databaseactie.
- [x] **P2** Downloadstatus en mislukte downloads zichtbaar maken in `/admin`.
- [x] **P1** Admin-actie toegevoegd om alle bestaande bron-URLs vooraf te
      controleren en MP3's te downloaden; de game hoeft daarvoor niet gestart.
- [x] **P1** URL-check vóór elke directe of bulkdownload toegevoegd; foutreden
      wordt per track bewaard.
- [x] **P2** Spelcollecties toegevoegd als many-to-many-labels: Disney, Pixar,
      Marvel, Streaming, Smartlappen en Rock.
- [x] **P2** Film/serie/muziek als inhoudstype gescheiden van collecties, zodat
      Frozen film + Disney is en een rocknummer als muziek + Rock kan bestaan.
- [x] **P2** Adminknoppen toegevoegd voor nieuwe films, nieuwe series,
      collectiecatalogi en vooraf downloaden.
- [x] **P2** Admin kan nieuwe collecties aanmaken en titels aan meerdere
      collecties koppelen.
- [x] **P1** Imports en downloads als aparte admin-tabs tonen; de lijst met
      ontbrekende tracks staat ingeklapt onder Downloads.
- [x] **P1** Losse MP3-downloads als achtergrondtaak uitvoeren met status,
      voortgang en foutmelding in de admininterface.
- [x] **P1** Admin-overzichtstegels klikbaar maken met herstelgerichte filters.
- [x] **P1** YouTube als bronprioriteit behouden na lokale download; iTunes
      blijft een herkenbare fallback.
- [x] **P1** Adminactie toegevoegd om bestaande database-titels opnieuw op
      YouTube te controleren zonder een bestaande iTunes-fallback te wissen
      wanneer YouTube geen zekere match vindt.
- [x] **P1** Spelherstel toegevoegd: actuele ronde/fase wordt na reconnect of
      browser-refresh opnieuw naar de socket gestuurd; een vastgelopen
      overgang kan zonder de lobby te verlaten opnieuw worden gepland.
- [x] **P1** Host-audio krijgt een harde laad-/starttimeout en toont een
      herstelknop in plaats van onbeperkt te blijven laden.
- [x] **P1** Admin-seed starten via een expliciete callback; browser-events
      mogen nooit in de JSON-payload terechtkomen.
- [x] **P2** Actieve admin-taken zichtbaar maken met naam, status en voortgang.
- [x] **P0** Films & Series veilig vergelijken met het PostgreSQL-enum in de
      telling, zodat Setup niet op oneindig laden blijft staan.
- [x] **P0** Leeftijdsvelden voor jongste en oudste deelnemer leeg kunnen maken
      en pas bij blur/start begrenzen op 4–120.

## Daarna

- [x] **P2** Profielpagina voor hostnaam, accountstatus en eigen presets.
- [x] **P2** Userdatabase uitbreiden met optionele spelersprofielen en
      scorehistorie; gastspelers blijven ondersteund.
- [x] **P2** Foutmeldingen groeperen per titel en track.
- [x] **P2** Track opnieuw zoeken vanuit de melding in `/admin`.
- [x] **P2** Bewaarde lokale audio controleren op hash en ontbrekende bestanden.
- [x] **P2** Optionele automatische playlist-refresh met veilige rate-limit.
- [x] **P2** Periodieke imports dedupliceren op de oorspronkelijke bron-URL;
      dezelfde YouTube-video wordt niet telkens opnieuw als track opgeslagen.
- [x] **P2** Lokale bestanden controleren op hash en aanwezigheid.
- [x] **P2** Verwijderde lokale kopieën via de bewaarde oorspronkelijke
      YouTube/iTunes-URL opnieuw kunnen downloaden.
- [x] **P2** Bulk-cacheactie met voortgang en foutreden bouwen voor beheer buiten
      de automatische pregame-download.
- [x] **P2** Kwaliteitsdashboard en modus “alleen gecontroleerde nummers” toevoegen.
- [x] **P2** Automatische leeftijdsclassificatie uit TMDB-genres toevoegen; admin
      kan de veilige voorselectie altijd corrigeren.
- [x] **P3** Afgekeurde tracks exporteren voor handmatige controle.
- [x] **P3** Importpreview tonen vóór lokale seedwijzigingen.
- [x] **P3** Changelogsecties voorzien van spelers-, host- en admin-doelgroep.
- [x] **P3** Meerdere betrouwbare tracks per titel bewaren en afwisselen;
      imports verwijderen oudere fallbacks niet meer.
- [x] **P2** Dagelijkse beheerupdates instelbaar maken voor playlists, TMDB,
      ontbrekende YouTube-tracks, downloads en lokale bestandscontrole.

## Bewust niet automatisch

- [x] **P4** Geen willekeurige zoekresultaten downloaden: alleen tracks die al
      door de matchcontrole zijn opgeslagen of door admin zijn toegevoegd mogen
      automatisch lokaal gecachet worden.
