import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { formatPlan, formatMigration, formatHelp } from '../dist/cli/output.js';

test('human preview includes conflicts, hides diffs by default and reveals them in verbose mode', () => {
    const plan = {
        operation: 'module',
        changes: [
            { path: 'new.ts', status: 'create', diff: '+ exported code' },
            { path: 'existing.ts', status: 'replace' },
            { path: 'conflict.ts', status: 'conflict', reason: 'Fichier modifié.' },
        ],
        conflicts: [
            { path: 'conflict.ts', reason: 'Fichier modifié.' },
            { path: '', reason: 'Module existant.' },
        ],
    };
    const output = formatPlan(plan);
    assert.match(output, /Créer.*new.ts/);
    assert.match(output, /Modifier.*existing.ts/);
    assert.match(output, /Fichier modifié\./);
    assert.match(output, /Module existant\./);
    assert.match(output, /3 fichiers · 2 conflits/);
    assert.doesNotMatch(output, /exported code/);
    assert.match(formatPlan(plan, true), /exported code/);
});

test('migration output retains its command and every risk', () => {
    const output = formatMigration({
        command: 'npx prisma migrate dev',
        risks: [{ severity: 'danger', message: 'Colonne supprimée.' }],
    });
    assert.match(output, /npx prisma migrate dev/);
    assert.match(output, /Colonne supprimée\./);
    assert.match(output, /aucune migration appliquée/);
});

test('help aligns descriptions', () => {
    const output = formatHelp('Options:\n  --quiet  Silence\n  --no-interactive  Prompts');
    assert.equal(
        output.indexOf('Silence') - output.lastIndexOf('\n', output.indexOf('Silence')),
        output.indexOf('Prompts') - output.lastIndexOf('\n', output.indexOf('Prompts')),
    );
});

test('configuration, help and errors render cleanly without color while JSON stays structured', () => {
    const cli = new URL('../nestgen.js', import.meta.url);
    const run = (...args) => spawnSync(process.execPath, [cli.pathname, ...args], { encoding: 'utf8' });
    const config = run('config', 'show', '--no-color');
    assert.equal(config.status, 0, config.stderr);
    assert.match(config.stdout, /◆ NestGen Configuration/);
    assert.match(config.stdout, /ORM\s+typeorm/);
    assert.equal(config.stdout.includes('\u001b'), false);
    assert.doesNotMatch(config.stdout, /"version"/);
    assert.equal(JSON.parse(run('config', 'show', '--json').stdout).result.version, 1);
    const error = run('unknown', '--no-color');
    assert.equal(error.status, 1);
    assert.match(error.stderr, /NestGen Erreur/);
    assert.equal(error.stderr.includes('\u001b'), false);
});

test('shell logger prints literal messages without ANSI escapes in redirected output', () => {
    const logger = new URL('../nestjs-generator/features/logger.sh', import.meta.url);
    const result = spawnSync(
        'bash',
        ['-c', 'source "$1"; log_info "a\\nb"; log_error "Erreur"', 'bash', logger.pathname],
        { encoding: 'utf8' },
    );
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '  › a\\nb\n');
    assert.equal(result.stderr, '  ✖ Erreur\n');
});
