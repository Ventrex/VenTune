# Bestandskaart

| Pad | Verantwoordelijkheid |
|---|---|
| `server/lib/trackcheck.js` | Conservatieve controle titel, alias en jaar |
| `server/lib/title-match.js` | Koppeling van playlistvideotitels aan database-titels |
| `server/lib/ytzoek.js` | YouTube-zoeken, playlistlezen en kandidaten rangschikken |
| `server/lib/auth.js` | Hostregistratie, login en server-side sessies |
| `seed/import.js` | YouTube/iTunes-vragenbank vullen |
| `seed/playlist-import.js` | Betrouwbare playlisttracks importeren |
| `seed/download-track.js` | Handmatig toegestane iTunes-previews lokaal cachen |
| `seed/tmdb-import.js` | Titels en metadata importeren vanuit TMDB |
| `seed/vragen-import.js` | Bonusvragen genereren |
| `server/game/engine.js` | Trackselectie, rondes, scoring en host als deelnemer |
| `server/game/lobby.js` | Lobby's; hostaccount verplicht, spelers als gast |
| `server/db/schema.sql` | Tabellen en idempotente migraties |
| `server/routes/changelog.js` | Publieke changelog-API |
| `server/routes/admin.js` | Centrale import, YouTube-zoekactie, tracks, meldingen en downloads |
| `server/test/host-play.test.js` | Test dat de host meetelt als actieve speler |
| `client/src/pages/Changelog.jsx` | Changelog die spelers kunnen openen |
| `client/src/pages/HostAuth.jsx` | Hostaccount registreren en inloggen |
| `client/src/components/Brand.jsx` | Logo en VenTune-merkweergave |
| `CHANGELOG.md` | Publieke releasehistorie |
| `Bugs.md` | Bekende fouten en reproduceerstappen |
| `Todo.md` | Concrete openstaande werkzaamheden |
| `Ideeen.md` | Nog niet toegezegde ideeën |
| `Prioriteiten.md` | Centrale P0–P4-definities en werkvolgorde |
| `.github/workflows/ci.yml` | Server-, import- en PostgreSQL-tests in CI |
| `Docker-compose.md` | Deployment- en volume-uitleg |
| `ScriptUitleg.md` | CLI-scripts en veilige uitvoervolgorde |
| `Comments.md` | Technische beslissingen en waarschuwingen |
| `GevraagdeAI.md` | AI-opdrachten en gewenste uitkomst |
| `Stappenplan.md` | Werkvolgorde van ontwikkeling tot productie |
