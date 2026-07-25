# Adminhandleiding

Het adminportaal is de centrale plek om de vragenbank, audio en hostaccounts
te beheren. Het admin-wachtwoord blijft uitsluitend in `.env`; het portaal zet
dit wachtwoord nooit in de gebruikersdatabase.

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

## Lokale cache

Bij een bestaande YouTube- of iTunes-track staat een downloadknop. Die actie is
expliciet en handmatig: VenTune zoekt geen nieuwe video en downloadt niets bij
het starten van een spel. YouTube wordt met `yt-dlp` en `ffmpeg` als m4a-audio
opgeslagen in het persistente `./media`-volume.

De status is zichtbaar per track:

- `not_requested`: nog niet gecachet;
- `pending`: cacheactie loopt;
- `available`: lokale kopie is beschikbaar;
- `failed`: cacheactie mislukte; lees de foutmelding en probeer opnieuw.

Controleer voor YouTube-cache altijd of je de betreffende bron en audio mag
gebruiken. Een lokale cache beschermt tegen verwijderde video's, maar maakt een
bron niet automatisch rechtenvrij.

## Titels en hints

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
