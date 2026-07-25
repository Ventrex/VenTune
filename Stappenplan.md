# Stappenplan

## Fase 1 — Correcte muziek

- [x] **P1** Titel- en aliasmatching aanscherpen.
- [x] **P1** Afwijkende expliciete jaartallen weigeren.
- [x] **P1** YouTube-kandidaten vóór opslag controleren.
- [x] **P1** iTunes-kandidaten vóór opslag controleren.
- [x] **P1** Verkeerde track tijdens een spel direct uitschakelen na expliciete
  melding.
- [x] **P1** Importvervanging transactioneel maken.
- [x] **P1** TMDB-metadata als tweede controlelaag gebruiken wanneer een
  `tmdb_id` en `TMDB_API_KEY` beschikbaar zijn.

## Fase 2 — Beheer en inzicht

- [x] **P1** Hostaccount verplicht maken voor het starten van een lobby.
- [x] **P1** Gastspelers zonder account behouden.
- [x] **P1** Host als volwaardige speler laten meedoen op het hostscherm.
- [x] **P1** Verificatiescore en reden in de database opslaan.
- [x] **P1** Verificatiescore, reden en bron zichtbaar maken in `/admin`.
- [x] **P1** Trackmeldingen blijven beschikbaar in `/admin`.
- [x] **P1** Admin-imports met één gedeelde lock uitvoeren.
- [x] **P1** Hostaccounts beheren en wachtwoorden resetten vanuit `/admin`.
- [x] **P2** Documentatiebestanden toevoegen.
- [x] **P2** Publieke changelog toevoegen.
- [ ] **P3** Admin-wizard voor importpreview en bevestiging.

## Fase 3 — Lokale audio

- [x] **P2** `/media`-volume voorbereiden.
- [x] **P2** Handmatige iTunes-previewcache toevoegen.
- [ ] **P3** Eigen legale audiobestanden uploaden via admin.
- [ ] **P2** Hash- en bestand-beschikbaarheidscontrole bij serverstart.
- [ ] **P3** Beleid en bron/licentie per lokaal bestand zichtbaar maken.

## Fase 4 — Kwaliteit en testen

- [x] **P1** Geautomatiseerde importfixtures voor Nederlandse titels toevoegen.
- [x] **P1** PostgreSQL-integratietest met een verkeerde-track-scenario toevoegen.
- [x] **P1** Ronde-overgangen beveiligen tegen dubbele timers, dubbele
      bonusafronding en een onbruikbare titel die de nummering laat springen.
- [ ] **P2** Periodieke kwaliteitsrapportage bouwen.
- [ ] **P2** YouTube-playlist-refresh met rate-limit en retry-dashboard toevoegen.
