# Adminhandleiding

Het adminportaal is de centrale plek om de vragenbank, audio en hostaccounts
te beheren. Het admin-wachtwoord blijft uitsluitend in `.env`; het portaal zet
dit wachtwoord nooit in de gebruikersdatabase.

## Vragenbank en AI-curator (Beheer 2.0)

Het dagelijkse beheer staat op **/admin/bank**. De AI-curator (ChatGPT via de
Codex-login, geen API-key) draait 24/7 op de server en bepaalt én keurt alles:

| Stap | Wat de AI doet |
|---|---|
| Beoordelen | categorie (film, serie, anime, game, muziek, kerst, kinder), bekendheid (iconisch, algemeen bekend, bekend, onbekend, cult), bekend in Nederland ja/nee/twijfel, jaartal, franchise en andere namen, het herkenningsnummer en de YouTube-zoekterm |
| MP3 | zoekt ontbrekende MP3's op YouTube, kiest zelf de originele versie en slaat hem lokaal op; waarom iets mist staat erbij |
| Quiz | 3 hints en 3 bonusvragen per titel, ook voor games en muziek |
| Aanvullen | vult elke categorie aan tot het doelaantal (Overzicht → Doel of +100/+500), verdeeld over de bekendheidsniveaus |
| Verbeteren | handelt spelermeldingen af, sluit dubbelen uit, controleert bestaande MP3's, loopt steekproeven na en beoordeelt alles elke 60 dagen opnieuw |

Niet in Nederland bekend → automatisch uit het spel (terug te zetten via
NL-check). Iconisch gaat overal voor: de AI vult eerst alle categorieën met
iconische titels, daarna algemeen bekend, bekend, onbekend en cult.

De AI werkt in lijsten, één AI-vraag per lijst van één categorie: eerst een
lijst nieuwe namen (alleen naam, jaar en bekendheid), daarna beoordeelt hij
die lijst in één keer (bekendheid t.o.v. elkaar, NL-bekendheid, taal/land,
begin- en eindjaar van series, nummer), en daarna maakt hij voor een lijst
titels 3 hints + 3 vragen zonder raakvlakken. Met ★ Voorrang (Overzicht) gaat
een categorie bij alles voor, bv. eerst alle iconische videogames.

Overzicht → **▶ Alles starten & opnieuw zoeken**: alle titels opnieuw laten
beoordelen, alle ontbrekende MP3's (ook opgegeven) opnieuw zoeken en
ontbrekende hints/vragen maken. Bij de ChatGPT-limiet pauzeert de curator 30
minuten (zichtbaar in de statusbalk, met "Nu proberen"). Zolang er titels
zonder beoordeling zijn draait een inhaalslag: eerst de hele database
indelen, pas daarna nieuwe titels zoeken. Aanvragen van spelers (beginscherm
→ Aanvragen) gaan overal voor.

**Alleen de nummers keur je zelf goed**, in de tab **Swipen** (subtabs per
categorie, iconisch eerst). Een MP3 die de AI vindt, komt pas in het spel als
jij hem goedkeurt. Sleep naar rechts of tik ✓ = goed, links of ✕ = fout (de
AI zoekt een andere versie), ↓ = later. Een eigen YouTube-link is meteen
goedgekeurd.

Tabs: Overzicht · Swipen · Controles (Nummers, MP3, Hints, Vragen, Jaartal,
NL-check, Antwoorden — alles bekijken en direct bewerken) · Fixes (alleen wat
aandacht nodig heeft) · AI-log · Systeem (database, uiterlijk, teksten,
meldingen, logs, gebruikers). Alles op één pagina: /admin/bank.
Wat je zelf aanpast krijgt een 🔒: de AI blijft daarvan af. Tik op het slotje
om het weer aan de AI over te laten. Het AI-log toont alles wat de curator
deed.

Zolang de AI-curator aan staat, draaien de oude automatische vullers (TMDB-
catalogus per uur en de swipe-achtergrondwachtrij) niet meer. Zet
`VENTUNE_OUDE_AUTOMATISERING=true` om ze toch te laten draaien, of
`AI_CURATOR=false` om de curator helemaal uit te schakelen. Het tempo
(pauze tussen AI-vragen) stel je in onder Overzicht; bij de limiet van het
ChatGPT-abonnement pauzeert de curator zelf 30 minuten.

## Database als bron van waarheid

De tabel `titels` bepaalt welke films, series en andere spelitems bestaan. De
tabel `tracks` bewaart de gevonden audio en `download_status` bewaart of de
lokale kopie aanwezig is: `available` betekent aanwezig en gecontroleerd,
`failed` of `not_requested` betekent niet speelbaar. Een nieuwe import zoekt
alleen een titel zonder lokale audio én zonder opgeslagen YouTube-track. Een
bestaande YouTube-track wordt gedownload; hij wordt niet opnieuw gezocht.
Zoeken werkt in batches van maximaal 250 titels, omdat YouTube afknijpt bij te
veel verzoeken. **Downloaden** kent die grens niet: dat is puur je eigen
server, dus die stap pakt alles waarvoor al een kandidaat klaarstaat.

## De zoekwachtrij

Elke titel houdt bij wanneer er voor het laatst naar muziek is gezocht en hoe
vaak dat niets opleverde. Zonder die administratie pakte elke run weer dezelfde
kop van de lijst en kwam de vragenbank nooit verder.

| Kolom | Betekenis |
|---|---|
| `zoek_status` | `nieuw`, `gevonden`, `geen_kandidaat` of `opgegeven` |
| `zoek_pogingen` | hoe vaak er al gezocht is |
| `volgende_poging` | vóór dit moment wordt er niet opnieuw gezocht |
| `zoek_melding` | waarom de laatste poging niets opleverde |

De rij zet titels die nog nooit geprobeerd zijn vooraan, daarna wat het langst
wacht. Een mislukking wacht achtereenvolgens 6, 24, 72 en 168 uur. Daarna komt
de titel op `opgegeven` en blokkeert hij de rij niet meer.

Opgegeven titels haal je terug via **Muziek → Vastgelopen** (per titel) of de
knop op de pijplijn (allemaal tegelijk). Vanaf de opdrachtregel:

```bash
docker compose exec server node /app/seed/import.js --db --opnieuw
```

Een handmatige YouTube-link is een expliciete adminkeuze. VenTune controleert
dan niet of de videotitel op de film- of serienaam lijkt. Alleen de geldigheid
van de URL wordt nog gecontroleerd voordat `yt-dlp` de volledige audio opslaat.

Bij het starten van een spel wordt uitsluitend de database gebruikt: alleen
lokale tracks met `download_status=available` komen in de pool. Er wordt dan
geen YouTube-, TMDB- of bestandcontrole meer uitgevoerd.

## Indeling van het portaal

De tabs volgen de weg die een titel aflegt, van links naar rechts:

| Tab | Onderdelen | Waarvoor |
|---|---|---|
| **Overzicht** | Pijplijn, Alle cijfers | Wat is de stand en wat moet er nu gebeuren |
| **Catalogus** | Titels, Titels ophalen, Collecties | Welke films, series en muziek bestaan er |
| **Muziek** | Zoeken & downloaden, Vastgelopen | Van titel naar lokale MP3 |
| **Kwaliteit** | Meldingen, Controle, Bonusvragen | Klopt wat er in staat |
| **Systeem** | Hosts, Database, Automatisch, Uiterlijk | Beheer dat je zelden nodig hebt |

De **Pijplijn** is het startscherm. Die toont de vier stappen — titels,
zoeken, downloaden, speelbaar — met per stap hoeveel er nog te doen is en één
knop. Bovenaan staat in één zin wat de eerstvolgende zinnige handeling is.

De sectie **Controle** toont hoeveel tracks gecontroleerd, onzeker, lokaal
beschikbaar of mislukt zijn. Gebruik **Lokale bestanden controleren** om de
Docker-volume met de database te vergelijken. De controle berekent SHA-256,
maar downloadt niets vanzelf. Ontbrekende audio kun je daarna opnieuw
downloaden wanneer de oorspronkelijke bron nog als YouTube-track bestaat, of
via een eigen/licentie-upload herstellen.

## Ontbrekende tracks

Open `/admin` en kijk naar **Tracks nodig**. Een titel verschijnt daar wanneer
er geen actieve track met een afspeelbare URL is. De engine maakt hiervoor één
open melding en haalt de titel uit de speelpool; een spel krijgt daardoor geen
stille ronde of rondenummergat.

Klik op **Toevoegen** bij een titel. Kies daarna één van deze routes:

1. **YouTube zoeken**: controleer de voorgestelde video en sla hem alleen op
   wanneer het echt de intro/titelsong is.
2. **YouTube-track handmatig toevoegen**: gebruik het video-id en de volledige
   titel in de trackgegevens.
3. **Eigen audio uploaden**: upload alleen een eigen of gelicentieerd bestand.

Na toevoegen wordt de melding afgehandeld. De nieuwe track wordt opnieuw
gecontroleerd en lokale audio krijgt bij het spelen de hoogste voorkeur.

## Lokale downloads

Bij een bestaande YouTube-track staat een downloadknop. In
**Import & downloads** kun je daarnaast alle bestaande tracks vooraf laten
controleren en downloaden. In **Spelcollecties** kan dit per editie, inclusief
Disney/Pixar. VenTune zoekt tijdens deze downloadactie geen nieuwe video: alleen
een al opgeslagen en gecontroleerde track mag worden binnengehaald.
YouTube wordt met `yt-dlp` en `ffmpeg` als mp3-audio opgeslagen in
`./media/downloads`; eigen uploads staan in `./media/uploads`. Beide mappen
komen via Docker en nginx mee en blijven na een rebuild bestaan. Per YouTube-
track wordt het volledige nummer opgeslagen tot maximaal 5 minuten. Een
iTunes/Apple-preview wordt geweigerd omdat die bron alleen korte fragmenten
levert. Eigen `.m4a`-uploads zijn wel toegestaan.

De status is zichtbaar per track:

- `not_requested`: nog niet gedownload;
- `pending`: cacheactie loopt;
- `available`: lokaal bestand is echt aanwezig;
- `failed`: cacheactie mislukte; lees de foutmelding en probeer opnieuw.

Boven de admin-tabs staat **Admin-taken** zodra een import, download of
bestandscontrole draait. Daar zie je welke taak actief is, de huidige titel,
voortgang en eventuele fout. De status wordt automatisch elke paar seconden
ververst.

Met **Mislukte downloads opnieuw proberen** worden alleen tracks met een
mislukte download opnieuw gecontroleerd. Met **Alleen gecontroleerde YouTube-
tracks downloaden** cache je uitsluitend matches boven de veilige
verificatiescore.

In **Imports** staat een importpreview. Deze wijzigt niets en toont vooraf
welke seedtitels nieuw, bijgewerkt of behouden blijven. Daar kan ook een
periodieke playlist-refresh worden ingesteld. De refresh blijft standaard uit;
de dagelijkse lokale-bestandscontrole staat standaard aan en kan daar worden
uitgezet. Onder **Dagelijkse gegevensupdates** kun je TMDB, ontbrekende
YouTube-tracks en gecontroleerde downloads afzonderlijk plannen. Nieuwe TMDB-
titels blijven eerst `te_beoordelen` en onzekere YouTube-matches worden niet
automatisch opgeslagen.

Een URL-check met `yt-dlp` gebeurt vóór een YouTube-download. Een ontbrekende
of verwijderde video wordt dus als fout geregistreerd en nooit stil als geldig
nummer gebruikt.

## Spelcollecties

Een titel heeft altijd een inhoudstype: `film`, `serie` of `muziek`. Daarnaast
kan dezelfde titel aan meerdere collecties worden gekoppeld. Gebruik de tab
**Spelcollecties** om Disney, Pixar, Marvel, Streaming, Smartlappen en Rock te
vullen, te downloaden of uit te schakelen. In **Titels & muziek** kun je in het
veld `Spelcollecties` meerdere slugs invullen, bijvoorbeeld `disney, pixar`.

De knop **Nieuwe films ophalen** en **Nieuwe series ophalen** gebruikt TMDB
gericht. Nieuwe TMDB-titels blijven te beoordelen totdat je ze goedkeurt; de
collectiecatalogus van Disney/Pixar is bedoeld als beheerde, herkenbare basis.

Controleer voor YouTube-cache altijd of je de betreffende bron en audio mag
gebruiken. Een lokale cache beschermt tegen verwijderde video's, maar maakt een
bron niet automatisch rechtenvrij.

## Titels en hints

In **Uiterlijk** kun je kleuren, teksten, lettertype en logo wijzigen. In het
titelbeheer staat per titel waarom hij is toegevoegd, of hij als Nederlandse-tv
bekend is goedgekeurd, welke leeftijdsgrens geldt en of hij nog beoordeeld moet
worden. TMDB- en automatische playlist-imports krijgen standaard
`te_beoordelen`.

In **Database** kun je de veilige JSON-export maken en afzonderlijke categorieën
opschonen. Het admin-wachtwoord en wachtwoordhashes worden niet geëxporteerd.

Bij een titel kun je `Waar speelt het zich af?` en `Hoofdrollen` invullen. Met
een TMDB-koppeling vult VenTune hoofdrollen tijdens de eerste hint automatisch
aan wanneer ze nog ontbreken. De hintvolgorde is:

1. hoofdrollen;
2. speelplek;
3. genre en land van herkomst;
4. beginletters, bijvoorbeeld `S.....s`;
5. jaartal;
6. type film/serie.

Niet beschikbare metadata wordt overgeslagen. Het jaartal is dus niet meer
altijd de eerste hint.

In **Meldingen** worden problemen per titel gegroepeerd. De knop met het
vergrootglas zoekt een nieuwe YouTube-kandidaat, maar slaat die nooit zonder
admincontrole op. Zo blijft een verkeerde match zichtbaar in plaats van dat
een nieuwe fout automatisch wordt ingevoerd.

De tab **Kwaliteit** is bedoeld voor diagnose. Een matchscore is geen bewijs
van licentie of auteursrecht; gebruik alleen audio waarvoor je de bron mag
gebruiken. De export **Afgekeurde tracks** is een JSON-controlelijst voor
handmatige opvolging.

## Hostaccounts

Onder **Hostaccounts** kun je hosts aanmaken, zichtbare namen en
gebruikersnamen wijzigen, accounts uitschakelen en wachtwoorden resetten.
Een uitgeschakeld account kan geen nieuwe lobby starten; bestaande
hostsessies worden bij uitschakelen of hernoemen ongeldig gemaakt.

Spelers blijven zonder account meedoen. De host moet altijd een account hebben,
maar mag op hetzelfde hostscherm ook zelf raden.

## Prioriteiten

- **P0**: productieblokkade, dataverlies of veiligheidsrisico.
- **P1**: verkeerde muziek, ronde-overgang, accounttoegang of niet-speelbare
  titel.
- **P2**: beheer, diagnose, bulkacties en bestand-controle.
- **P3/P4**: gemak, ideeën en onderzoek.

Zie `Bugs.md`, `Todo.md`, `Ideeen.md` en `Prioriteiten.md`. Een afgerond punt
blijft als `[x]` staan zodat de geschiedenis controleerbaar blijft.

## Netwerkstoringen versus titels zonder muziek

`fetch failed` betekent dat YouTube niet bereikbaar was — het zegt niets over
de titel. Zulke fouten kosten daarom géén poging meer, en de titel blijft
gewoon vooraan in de wachtrij staan. Komen er vijf netwerkfouten op rij, dan
stopt de run met een duidelijke melding in plaats van de rest van de batch op
te branden.

Staan er nog titels in **Vastgelopen** van vóór deze wijziging, dan zijn die
onterecht afgekeurd. Herstellen kan met de knop **Storingen herstellen** in
die lijst, of vanaf de opdrachtregel:

```bash
# eerst kijken hoeveel en waarom (wijzigt niets)
docker compose exec server node /app/seed/herstel-netwerkfouten.js

# alleen de storingen terugzetten
docker compose exec server node /app/seed/herstel-netwerkfouten.js --ja

# alles terugzetten, ook waar echt niets te vinden was
docker compose exec server node /app/seed/herstel-netwerkfouten.js --ja --alles
```
