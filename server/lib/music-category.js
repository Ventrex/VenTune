// Eén gedeelde indeling voor import, AI-curatie en aanvragen.
// Kerst en Sinterklaas zijn aparte hoofdcategorieën én krijgen eigen genre.
const SINT = /\b(?:sinterklaas(?:je)?|sint[\s-]?nicolaas|sint[\s-]?nikolaas|sinterklaaslied(?:je)?s?|pakjesavond|stoomboot|pepernoten|piet(?:en)?lied|zwarte piet|zie ginds komt|hoor wie klopt|daar wordt aan de deur geklopt|hij komt, hij komt|schoentje zetten|de zak van sinterklaas|dag sinterklaasje|zie de maan schijnt door de bomen)\b/i;
const KERST = /\b(?:christmas|x[\s-]?mas|kerst(?:feest|lied|nummer|muziek|man|nacht)?|jingle bells?|last christmas|feliz navidad|silent night|stille nacht|o holy night|white christmas|winter wonderland|let it snow|all i want for christmas|santa claus|rudolph|no[eë]l)\b/i;
const KINDER = /^(?:children'?s music|kinder(?:lied|muziek)|nursery rhymes?)$/i;

function genreNaam(waarde) {
  const v = String(waarde || '').trim();
  const gen = {
    'hip-hop/rap':'Hiphop','hip hop/rap':'Hiphop','r&b/soul':'R&B',
    'electronic':'Dance','dance':'Dance','alternative':'Alternatief',
    'singer/songwriter':'Singer-songwriter','classical':'Klassiek',
    'hard rock':'Rock','holiday':'Kerst','christmas':'Kerst',
    "children's music":'Kinderlied','nederlandstalig':'Nederpop',
    'nederlandse muziek':'Nederpop', 'hip-hop':'Hiphop',
  };
  return gen[v.toLowerCase()] || v;
}

function categoriseerMuziek({ naam, artiest, categorie = 'muziek', genres = [] } = {}) {
  const label = String(naam || '').trim();
  const uitvoerder = String(artiest || '').trim();
  const aangegeven = (Array.isArray(genres) ? genres : []).map(genreNaam);
  const tekst = [label, uitvoerder].join(' ');
  const expliciet = String(categorie || 'muziek').toLowerCase();
  const sint = expliciet === 'sinterklaas' || SINT.test(tekst) ||
    aangegeven.some(g => /^sinterklaas$/i.test(g));
  const kerst = !sint && (expliciet === 'kerst' || KERST.test(label) ||
    aangegeven.some(g => /^kerst$/i.test(g)));
  const kinder = expliciet === 'kinder' ||
    aangegeven.some(g => KINDER.test(g) || g === 'Kinderlied');
  const soort = sint ? 'sinterklaas' : kerst ? 'kerst' : kinder ? 'kinder' : 'muziek';
  // Sla stijlen én het seizoenslabel op; niet alleen een generiek 'muziek'.
  const speciaal = soort === 'sinterklaas' ? 'Sinterklaas'
    : soort === 'kerst' ? 'Kerst' : soort === 'kinder' ? 'Kinderlied' : null;
  const allowed = ['Pop','Rock','Metal','Punk','Alternatief','Indie','Hiphop','R&B','Soul','Funk',
    'Disco','Dance','Reggae','Latin','Country','Blues','Jazz','Klassiek','Schlager','Levenslied',
    'Nederpop','Singer-songwriter','Soundtrack','Kinderlied','Kerst','Sinterklaas'];
  const lijst = [...new Set([speciaal, ...aangegeven]
    .filter(g => allowed.includes(g) && (soort === 'kerst' || g !== 'Kerst') &&
      (soort === 'sinterklaas' || g !== 'Sinterklaas')))].slice(0, 3);
  return { categorie: soort, genres: lijst, collectie: soort === 'kerst' || soort === 'sinterklaas' ? soort : null };
}
module.exports = { categoriseerMuziek, genreNaam };
