# Todo

## Eerstvolgend

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
- [x] **P2** Trackgebruik (`keer_gespeeld`, `laatst_gespeeld`) gebruiken voor
      afwisseling en de teller in `/admin` tonen.
- [x] **P1** Admin kan hostaccounts aanmaken, bewerken, uitschakelen en
      wachtwoorden resetten; het admin-wachtwoord blijft in `.env`.
- [ ] **P2** Playlist-import periodiek uitvoeren vanuit admin met voortgang.
- [x] **P2** Lokale audio ook kunnen toevoegen via admin zonder handmatige
      databaseactie.
- [x] **P2** Downloadstatus en mislukte downloads zichtbaar maken in `/admin`.

## Daarna

- [ ] **P2** Profielpagina voor hostnaam, accountstatus en eigen presets.
- [ ] **P2** Userdatabase uitbreiden met optionele spelersprofielen en
      scorehistorie; gastspelers blijven ondersteund.
- [ ] **P2** Foutmeldingen groeperen per titel en track.
- [ ] **P2** Track opnieuw zoeken vanuit de melding in `/admin`.
- [ ] **P2** Bewaarde lokale audio controleren op hash en ontbrekende bestanden.
- [ ] **P2** Optionele automatische playlist-refresh met veilige rate-limit.
- [ ] **P2** Lokale bestanden controleren op hash en aanwezigheid.
- [ ] **P2** Bulk-cacheactie met voortgang, retry en foutreden bouwen.
- [ ] **P3** Afgekeurde tracks exporteren voor handmatige controle.

## Bewust niet automatisch

- [x] **P4** Geen willekeurige YouTube-downloads activeren zonder expliciete
      adminactie, bron- en rechtenkeuze.
