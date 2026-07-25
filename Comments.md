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
- Uitvoerings- en deelmarkeringen zijn extra streng: `live`, `livestream`,
  `deel/part`, `aflevering/episode`, seizoenmarkeringen en losse extra cijfers
  worden niet automatisch gekoppeld. Alleen cijfers die werkelijk in de
  officiële titel/alias staan of een viercijferig releasejaar zijn toegestaan.
- `live` en `livestream` zijn absolute blokkades. Een bestaande track met die
  woorden wordt bij de laatste speelcontrole afgekeurd en verschijnt daarna
  als actiepunt voor de admin.
- Bij een beschikbare TMDB-koppeling voert VenTune na de lokale match een tweede
  controle uit op de officiële titel en het jaar. Zonder TMDB-sleutel blijft de
  lokale controle actief; een onzekere lokale match wordt nog steeds geweigerd.
- Hostaccounts zijn bewust losgekoppeld van het admin-account. Het admin-
  wachtwoord blijft in `.env`; spelers krijgen alleen een tijdelijke gastsessie
  binnen een lobby.
- De host is ook een normale speler: dezelfde hostsocket speelt audio af én
  kan gokken, hints gebruiken en bonusvragen beantwoorden. Bij het bepalen of
  iedereen klaar is telt de host mee zolang de host verbonden is.
- Ronde-overgangen hebben één serverlock en een overgangsversie. Daardoor kan
  een bonustimer, een goed antwoord of een oude hostactie niet twee keer naar
  het scorebord of een volgende ronde gaan. Een titel zonder geldige track
  wordt uit de resterende pool verwijderd zonder een rondenummer over te
  slaan.
- Een database-transactie beschermt de vorige goede track tijdens een import.
- Downloaden staat niet standaard aan. Alleen een bestaande, gecontroleerde
  track die de admin expliciet kiest wordt lokaal gecachet. YouTube wordt met
  `yt-dlp` naar browser-vriendelijke m4a-audio omgezet; de game downloadt nooit
  vanzelf.
- Lokale audio staat in het persistente `./media`-volume en wint bij selectie
  van YouTube en iTunes. Eigen uploads horen alleen eigen of gelicentieerde
  bestanden te zijn.
- Bij selectie blijft de bronvolgorde lokaal → YouTube → iTunes leidend. Binnen
  dezelfde bron krijgen tracks met minder `keer_gespeeld` voorrang; bij gelijke
  stand wordt ook op `laatst_gespeeld` en een lichte willekeurige tie-breaker
  gesorteerd.
- Een titel zonder speelbare track wordt niet geforceerd gekoppeld. De engine
  maakt één open `geen_track`-melding en de admin toont de titel in **Tracks
  nodig** totdat een track wordt toegevoegd.
- De hostspeler wacht bij een nieuwe opdracht op de YouTube-player of
  `loadedmetadata` en probeert meerdere keren opnieuw. Daardoor is **Opnieuw**
  een herstelactie, geen vereiste om normaal een ronde te starten.
- Hints zijn bewust oplopend: cast, speelplek, genre/land, beginletters, jaar
  en type. TMDB vult hoofdrollen alleen aan als die nog ontbreken; zonder TMDB
  blijft handmatig ingevulde metadata werken.
- `CHANGELOG.md` is spelerzichtbaar. Zet daar geen wachtwoorden, interne IP's,
  tokens of operationele details in.
