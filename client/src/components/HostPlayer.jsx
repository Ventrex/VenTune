import React, {
    useEffect,
    useRef,
    useState,
    useCallback,
    forwardRef,
    useImperativeHandle,
} from 'react';
import Visualizer from './Visualizer.jsx';
import { audioBron } from '../lib/api.js';

function wacht(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function metTimeout(belofte, ms, melding) {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(melding)), ms);
    });
    return Promise.race([belofte, timeout]).finally(() => clearTimeout(timer));
}

function formatTijd(seconden) {
    if (!Number.isFinite(seconden) || seconden < 0) return '0:00';
    const totaal = Math.floor(seconden);
    const minuten = Math.floor(totaal / 60);
    const rest = String(totaal % 60).padStart(2, '0');
    return `${minuten}:${rest}`;
}

/** Wacht totdat de browser metadata heeft en start daarna pas de audio. */
async function laadEnSpeelAudio(element, url, startSeconde, isActief) {
    element.pause();
    element.src = audioBron(url);
    element.load();

    if (element.readyState < 1) {
        await new Promise((resolve, reject) => {
            let klaar = false;
            const timeout = setTimeout(() => fout(), 10000);
            const opruimen = () => {
                element.removeEventListener('loadedmetadata', metadata);
                element.removeEventListener('error', fout);
                clearTimeout(timeout);
            };
            const metadata = () => {
                if (klaar) return;
                klaar = true;
                opruimen();
                resolve();
            };
            const fout = () => {
                if (klaar) return;
                klaar = true;
                opruimen();
                reject(new Error('Audio kon niet worden geladen.'));
            };
            element.addEventListener('loadedmetadata', metadata);
            element.addEventListener('error', fout);
            if (element.readyState >= 1) metadata();
        });
    }
    if (!isActief()) return false;
    // Zorg dat er écht geluid komt: het element mag niet gedempt staan (bijv.
    // na de stille ontgrendel-play). Anders speelt het wel af, maar hoor je
    // niets. Het volume blijft ongemoeid — dat regelt de host met de schuif.
    element.muted = false;
    element.currentTime = Number(startSeconde) || 0;
    await metTimeout(
        element.play(),
        10000,
        'Audio starten duurt te lang.',
    );
    return true;
}

// Speelt uitsluitend een volledig lokaal audiobestand af op het host-scherm.
// YouTube is een admin-downloadbron en komt nooit in de spelspeler terecht.
//
// Browsers (vooral iOS Safari) staan geluid alleen toe direct na een tik.
// Daarom wordt de speler bij de "Start spel"-tik eenmalig ontgrendeld
// (ontgrendel()); daarna mag hij ook in latere rondes vanzelf spelen.
// Lukt het toch niet, dan verschijnt een grote "Tik om te starten"-knop.
const HostPlayer = forwardRef(function HostPlayer({
    audio,
    verborgen = false,
    onStatus,
    gepauzeerd = false,
    onPauze,
    onHervat,
    onHerhaal,
}, ref) {
    const audioRef = useRef(null);
    const ontgrendeldRef = useRef(false);
    const speelTokenRef = useRef(0);
    const [moetTikken, setMoetTikken] = useState(false);
    const [foutmelding, setFoutmelding] = useState('');
    const [speeltijd, setSpeeltijd] = useState(0);
    const [duur, setDuur] = useState(0);
    const [speelt, setSpeelt] = useState(false);
    const [volume, setVolume] = useState(1);

    // Wordt aangeroepen vanuit de tik op "Start spel": geeft de browser het
    // signaal dat afspelen door de gebruiker is gestart.
    const ontgrendel = useCallback(async () => {
        ontgrendeldRef.current = true;
        // Audio-element ontgrendelen met een korte stille play.
        const el = audioRef.current;
        if (el) {
            try {
                el.muted = true;
                // Let op de timeout: play() op een element zonder geladen
                // bron levert een promise die nóóit afrondt. Zonder deze
                // grens bleef het hostscherm eeuwig op "Spel voorbereiden"
                // staan, omdat de startopdracht hier bleef hangen.
                await metTimeout(el.play(), 1500, 'Ontgrendelen duurt te lang.');
                el.pause();
                el.currentTime = 0;
            } catch {
                /* Niet fataal: hooguit vraagt de browser later om een tik. */
            } finally {
                // Demping altijd terugzetten — ook als de stille play faalde of
                // een time-out gaf. Anders bleef het element gemuted en speelde
                // de host wel af, maar hoorde je niets.
                el.muted = false;
            }
        }
        // Geen dependencies: deze functie gebruikt alleen refs. Hier stond
        // nog haalYtSpeler uit de tijd dat de host YouTube afspeelde. Die
        // functie bestaat niet meer, en React leest de dependency-array bij
        // elke render — dus crashte het hele hostscherm op zwart.
    }, []);

    useImperativeHandle(ref, () => ({ ontgrendel }), [ontgrendel]);

    // Start (of herstart) het afspelen van de huidige opdracht.
    const start = useCallback(async (token = ++speelTokenRef.current) => {
        if (!audio) return;
        const isActief = () => speelTokenRef.current === token;
        const fout = (melding) => {
            if (!isActief()) return;
            setFoutmelding(melding);
            setMoetTikken(true);
            onStatus?.({ status: 'fout', fout: melding, bron: audio.bron });
        };
        setFoutmelding('');
        setSpeeltijd(0);
        setDuur(0);
        onStatus?.({ status: 'laden', bron: audio.bron });

        if (audio.bron !== 'lokaal') {
            fout('Deze ronde heeft geen lokaal audiobestand. Download de track eerst via Beheer.');
            return;
        }

        // De lokale download is de enige bron. Probeer alleen opnieuw wanneer
        // de browser de eerste lokale play-call te vroeg afwijst.
        const el = audioRef.current;
        if (!el) {
            fout('Audio-element ontbreekt op het hostscherm.');
            return;
        }
        let laatsteFout = null;
        for (let poging = 0; poging < 3; poging++) {
            try {
                await laadEnSpeelAudio(el, audio.url, audio.startSeconde, isActief);
                if (isActief()) {
                    setMoetTikken(false);
                    setFoutmelding('');
                    onStatus?.({ status: 'speelt', bron: audio.bron });
                }
                return;
            } catch (err) {
                laatsteFout = err;
                if (!isActief()) return;
                await wacht(250 * (poging + 1));
            }
        }
        if (isActief()) {
            // Alleen autoplay blokkade of een echte disk/netwerkfout mag de
            // handmatige startknop tonen; de korte retries zijn dan op.
            const melding = laatsteFout?.message || 'Lokaal audiobestand kon niet worden geladen.';
            console.warn('Lokale audio kon niet starten.', laatsteFout);
            fout(`Audio kon niet starten: ${melding}`);
        }
    }, [audio, onStatus]);

    const pauzeerOfHervat = useCallback(() => {
        if (!audio) return;
        if (gepauzeerd || audio.pauze) {
            onHervat?.();
            return;
        }
        if (speelt) {
            onPauze?.();
            return;
        }
        const el = audioRef.current;
        if (!el?.src) {
            start();
            return;
        }
        el.play().catch(() => {
            setMoetTikken(true);
            setFoutmelding('Tik op Afspelen om het lokale nummer te starten.');
        });
    }, [audio, gepauzeerd, onHervat, onPauze, speelt, start]);

    const beginOpnieuw = useCallback(() => {
        if (!audio) return;
        if (onHerhaal) {
            onHerhaal();
            return;
        }
        const el = audioRef.current;
        if (!el) return;
        el.currentTime = 0;
        el.play().catch(() => setMoetTikken(true));
    }, [audio, onHerhaal]);

    const verspringNaar = useCallback((event) => {
        const el = audioRef.current;
        if (!el) return;
        const waarde = Number(event.target.value);
        el.currentTime = waarde;
        setSpeeltijd(waarde);
    }, []);

    useEffect(() => {
        const token = ++speelTokenRef.current;
        if (!audio) {
            setMoetTikken(false);
            setFoutmelding('');
            setSpeeltijd(0);
            setDuur(0);
            setSpeelt(false);
            onStatus?.({ status: 'geen-audio' });
            if (audioRef.current) audioRef.current.pause();
            return;
        }

        // Host heeft gepauzeerd: alleen stilzetten, niet opnieuw laden.
        if (audio.pauze) {
            if (audioRef.current) audioRef.current.pause();
            return;
        }

        // Hervatten na pauze: doorgaan waar we waren.
        if (audio.hervat) {
            if (audioRef.current && audioRef.current.src) {
                audioRef.current.play().catch(() => setMoetTikken(true));
            }
            else start(token);
            return;
        }

        setMoetTikken(false);
        setFoutmelding('');
        start(token);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audio, start, onStatus]);

    return (
        <div className={'host-speler' + (verborgen ? ' host-speler-verborgen' : '')}>
            <div className="host-speler-visual">
                <Visualizer actief={!moetTikken} />
            </div>

            {moetTikken && (
                <div className="host-audio-fout">
                    <p>{foutmelding || 'De muziek wacht op een tik.'}</p>
                    <button
                        className="tik-start"
                        onClick={() => {
                        setMoetTikken(false);
                        setFoutmelding('');
                        ontgrendeldRef.current = true;
                        start();
                        }}
                    >
                        ▶ Opnieuw afspelen
                    </button>
                </div>
            )}

            {audio && (
                <div className="host-audio-bediening" aria-label="Muziekspeler">
                    <div className="host-audio-tijd">
                        <span>{formatTijd(speeltijd)}</span>
                        <input
                            type="range"
                            min="0"
                            max={duur || 0}
                            step="0.1"
                            value={Math.min(speeltijd, duur || 0)}
                            onChange={verspringNaar}
                            disabled={!duur}
                            aria-label="Voortgang van het nummer"
                        />
                        <span>{formatTijd(duur)}</span>
                    </div>
                    <div className="host-audio-knoppen">
                        <button
                            className="knop knop-stil"
                            type="button"
                            onClick={beginOpnieuw}
                            title="Het nummer opnieuw vanaf het begin"
                        >
                            ↻ Vanaf begin
                        </button>
                        <button
                            className="knop"
                            type="button"
                            onClick={pauzeerOfHervat}
                        >
                            {gepauzeerd || audio.pauze
                                ? '▶ Hervat'
                                : speelt
                                    ? '⏸ Pauze'
                                    : '▶ Afspelen'}
                        </button>
                        <label className="host-volume">
                            <span aria-hidden="true">🔊</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={volume}
                                onChange={(event) => {
                                    const waarde = Number(event.target.value);
                                    setVolume(waarde);
                                    if (audioRef.current) audioRef.current.volume = waarde;
                                }}
                                aria-label="Volume"
                            />
                        </label>
                    </div>
                </div>
            )}
            <audio
                ref={audioRef}
                preload="auto"
                playsInline
                onLoadedMetadata={(event) => setDuur(event.currentTarget.duration || 0)}
                onDurationChange={(event) => setDuur(event.currentTarget.duration || 0)}
                onTimeUpdate={(event) => setSpeeltijd(event.currentTarget.currentTime || 0)}
                onPlay={() => setSpeelt(true)}
                onPause={() => setSpeelt(false)}
                onEnded={() => setSpeelt(false)}
            />
        </div>
    );
});

export default HostPlayer;
