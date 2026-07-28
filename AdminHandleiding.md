# Adminhandleiding

Het adminportaal is de centrale plek om de vragenbank, audio en hostaccounts
te beheren. Het admin-wachtwoord blijft uitsluitend in `.env`; het portaal zet
dit wachtwoord nooit in de gebruikersdatabase.

## Tabs

Gebruik de tabs bovenaan: **Overzicht**, **Kwaliteit**, **Titels & muziek**, **Import &
downloads**, **Spelcollecties**, **Meldingen**, **Users**, **Database** en **Uiterlijk**. Zo staan
lopende imports, meldingen en gevaarlijke opschoonacties niet meer tussen de
dagelijkse titelbewerking.

De tab **Kwaliteit** toont hoeveel tracks gecontroleerd, onzeker, lokaal
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
