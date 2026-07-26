# Todo

## Eerstvolgend

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
- [ ] **P2** Playlist-import periodiek uitvoeren vanuit admin met voortgang.
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

## Daarna

- [ ] **P2** Profielpagina voor hostnaam, accountstatus en eigen presets.
- [ ] **P2** Userdatabase uitbreiden met optionele spelersprofielen en
      scorehistorie; gastspelers blijven ondersteund.
- [ ] **P2** Foutmeldingen groeperen per titel en track.
- [ ] **P2** Track opnieuw zoeken vanuit de melding in `/admin`.
- [ ] **P2** Bewaarde lokale audio controleren op hash en ontbrekende bestanden.
- [ ] **P2** Optionele automatische playlist-refresh met veilige rate-limit.
- [ ] **P2** Lokale bestanden controleren op hash en aanwezigheid.
- [ ] **P2** Bulk-cacheactie met voortgang, retry en foutreden bouwen voor
      beheer buiten de automatische pregame-cache.
- [ ] **P3** Afgekeurde tracks exporteren voor handmatige controle.

## Bewust niet automatisch

- [x] **P4** Geen willekeurige zoekresultaten downloaden: alleen tracks die al
      door de matchcontrole zijn opgeslagen of door admin zijn toegevoegd mogen
      automatisch lokaal gecachet worden.
