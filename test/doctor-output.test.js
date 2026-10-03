import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDoctorOutput } from '../dist/cli/doctor-output.js';

const diagnostics = [
    { id: 'OK', severity: 'INFO', cause: 'Dépendance disponible.', action: 'Réinstalle.', detail: '12.0.0' },
    { id: 'BROKEN', severity: 'ERROR', cause: 'Version incompatible.', action: 'Mets à jour.', detail: '22.0.0' },
    {
        id: 'NESTGEN_CONFIG',
        severity: 'INFO',
        cause: 'Configuration absente.',
        action: 'Lance config init.',
        detail: '',
    },
];

test('doctor visually groups checks and only displays relevant advice', () => {
    const output = formatDoctorOutput(diagnostics);
    assert.match(output, /NestGen.*Doctor/);
    assert.ok(output.indexOf('Version incompatible.') < output.indexOf('Dépendance disponible.'));
    assert.match(output, /→ Mets à jour\./);
    assert.match(output, /→ Lance config init\./);
    assert.doesNotMatch(output, /Réinstalle\.|Code :|22\.0\.0/);
    assert.match(output, /1 erreur.*0 avertissement.*2 vérifications/);
});

test('quiet doctor retains problems and verbose reveals technical context', () => {
    const output = formatDoctorOutput(diagnostics, { quiet: true, verbose: true });
    assert.match(output, /Version incompatible\./);
    assert.match(output, /Code : BROKEN/);
    assert.match(output, /Détail : 22\.0\.0/);
    assert.doesNotMatch(output, /NestGen|Dépendance disponible|Configuration absente/);
    assert.equal(formatDoctorOutput([diagnostics[0]], { quiet: true }), '');
});
