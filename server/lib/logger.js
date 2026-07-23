// =====================================================================
// Eenvoudige JSON-logger naar stdout.
// Zo blijft `docker logs` goed leesbaar en machineleesbaar.
// =====================================================================

function schrijf(niveau, bericht, extra) {
    const regel = {
        tijd: new Date().toISOString(),
        niveau,
        bericht,
        ...(extra && typeof extra === 'object' ? extra : {}),
    };
    // Eén JSON-object per regel.
    process.stdout.write(JSON.stringify(regel) + '\n');
}

module.exports = {
    info: (bericht, extra) => schrijf('info', bericht, extra),
    waarschuwing: (bericht, extra) => schrijf('waarschuwing', bericht, extra),
    fout: (bericht, extra) => schrijf('fout', bericht, extra),
    debug: (bericht, extra) => {
        if (process.env.NODE_ENV !== 'production') {
            schrijf('debug', bericht, extra);
        }
    },
};
