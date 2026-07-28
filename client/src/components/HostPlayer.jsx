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
const HostPlayer = forwardRef(function HostPlayer({ audio, verborgen = false, onStatus }, ref) {
    const audioRef = useRef(null);
    const ontgrendeldRef = useRef(false);
    const speelTokenRef = useRef(0);
    const [moetTikken, setMoetTikken] = useState(false);
    const [foutmelding, setFoutmelding] = useState('');

    // Wordt aangeroepen vanuit de tik op "Start spel": geeft de browser het
    // signaal dat afspelen door de gebruiker is gestart.
    const ontgrendel = useCallback(async () => {
        ontgrendeldRef.current = true;
        // Audio-element ontgrendelen met een korte stille play.
        const el = audioRef.current;
        if (el) {
            try {
                el.muted = true;
                await el.play();
                el.pause();
                el.currentTime = 0;
                el.muted = false;
            } catch {
                /* niet fataal */
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

    useEffect(() => {
        const token = ++speelTokenRef.current;
        if (!audio) {
            setMoetTikken(false);
            setFoutmelding('');
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

            <audio ref={audioRef} preload="auto" playsInline />
        </div>
    );
});

export default HostPlayer;
