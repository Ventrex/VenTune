const assert = require('assert/strict');
const { hashWachtwoord, controleerWachtwoord } = require('../lib/auth');

async function main() {
    const wachtwoord = 'een-lang-test-wachtwoord';
    const hash = await hashWachtwoord(wachtwoord);
    assert.match(hash, /^scrypt\$[^$]+\$[^$]+$/);
    assert.equal(await controleerWachtwoord(wachtwoord, hash), true);
    assert.equal(await controleerWachtwoord('verkeerd-wachtwoord', hash), false);
    assert.equal(await controleerWachtwoord(wachtwoord, 'geen-geldige-hash'), false);
    console.log('auth: alle tests geslaagd');
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
