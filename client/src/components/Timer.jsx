import React, { useEffect, useState } from 'react';

// Afteltimer die lokaal terugrekent vanaf de rondestart. De server blijft
// de bron van waarheid (die beëindigt de ronde); dit is puur weergave.
export default function Timer({ startTs, durationMs }) {
    const bereken = () =>
        Math.max(0, Math.ceil((startTs + durationMs - Date.now()) / 1000));
    const [rest, setRest] = useState(bereken);

    useEffect(() => {
        setRest(bereken());
        const id = setInterval(() => setRest(bereken()), 250);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [startTs, durationMs]);

    return <span className="timer-cijfer">{rest}</span>;
}
