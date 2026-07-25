# Technische opmerkingen

- "Altijd het juiste nummer" kan extern nooit wiskundig worden gegarandeerd:
  YouTube en iTunes leveren veranderlijke zoekresultaten. VenTune kiest daarom
  liever geen nummer dan een onzekere match.
- De afspeelcontrole in `server/game/engine.js` is een laatste veiligheidsnet,
  niet de primaire importstrategie.
- Playlisttracks krijgen de hoogste betrouwbaarheid omdat de playlist zelf al
  bedoeld is voor intro's. Ze worden toch opnieuw gecontroleerd.
- YouTube is de bronvolgorde voor automatisch zoeken en spelen. iTunes komt pas
  na een mislukte YouTube-match; de admin toont die volgorde ook expliciet.
- Hostaccounts zijn bewust losgekoppeld van het admin-account. Het admin-
  wachtwoord blijft in `.env`; spelers krijgen alleen een tijdelijke gastsessie
  binnen een lobby.
- Een database-transactie beschermt de vorige goede track tijdens een import.
- Downloaden staat niet standaard aan. Alleen de expliciete iTunes-cacheflow
  is aanwezig als fallback; willekeurige YouTube-downloads worden geweigerd.
- `CHANGELOG.md` is spelerzichtbaar. Zet daar geen wachtwoorden, interne IP's,
  tokens of operationele details in.
