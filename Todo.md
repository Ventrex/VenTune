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
- [ ] **P2** Playlist-import periodiek uitvoeren vanuit admin met voortgang.
- [ ] **P2** Lokale audio ook kunnen toevoegen via admin zonder handmatige
      databaseactie.
- [ ] **P2** Downloadstatus en mislukte downloads zichtbaar maken in `/admin`.

## Daarna

- [ ] **P2** Profielpagina voor hostnaam, accountstatus en eigen presets.
- [ ] **P2** Userdatabase uitbreiden met optionele spelersprofielen en
      scorehistorie; gastspelers blijven ondersteund.
- [ ] **P2** Foutmeldingen groeperen per titel en track.
- [ ] **P2** Track opnieuw zoeken vanuit de melding in `/admin`.
- [ ] **P2** Bewaarde lokale audio controleren op hash en ontbrekende bestanden.
- [ ] **P2** Optionele automatische playlist-refresh met veilige rate-limit.
- [ ] **P3** Afgekeurde tracks exporteren voor handmatige controle.

## Bewust niet automatisch

- [ ] **P4** Geen willekeurige YouTube-downloads activeren zonder expliciete
      bron- en rechtenkeuze.
