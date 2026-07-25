# VenTune changelog

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
