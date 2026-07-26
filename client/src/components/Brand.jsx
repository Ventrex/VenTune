import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { ThemaContext } from '../lib/thema.js';

// Centrale merkweergave. Hetzelfde logo verschijnt op start-, host- en
// admin-schermen, terwijl de app verder bewust rustig en overzichtelijk blijft.
export default function Brand({ link = true, compact = false }) {
    const thema = useContext(ThemaContext);
    const inhoud = (
        <span className={'merk' + (compact ? ' merk-compact' : '')}>
            <img src={thema.logoPad || '/icon.svg'} alt="" className="merk-logo" />
            <span className="merk-naam">{thema.appNaam || 'VenTune'}</span>
        </span>
    );
    return link ? <Link className="merk-link" to="/">{inhoud}</Link> : inhoud;
}
