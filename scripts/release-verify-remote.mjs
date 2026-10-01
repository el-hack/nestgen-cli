import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const metadataPath = process.argv[2];
if (!metadataPath) throw new Error('Usage: release-verify-remote.mjs <release-metadata.json>');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const spec = `${metadata.name}@${metadata.version}`;
const view = JSON.parse(
    execFileSync('npm', ['view', spec, 'version', 'dist.integrity', 'dist-tags.latest', '--json'], {
        encoding: 'utf8',
    }),
);
assert.equal(view.version, metadata.version, 'La version distante diffère de la version taggée.');
assert.equal(
    view['dist.integrity'],
    metadata.integrity,
    'L’intégrité distante diffère de l’archive vérifiée avant publication.',
);
assert.equal(view['dist-tags.latest'], metadata.version, 'Le tag npm latest doit viser la version publiée.');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-release-install-'));
try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, name: 'nestgen-release-check' }));
    execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', spec], {
        cwd: root,
        stdio: 'inherit',
    });
    const binary = process.platform === 'win32' ? 'nestgen.cmd' : 'nestgen';
    const result = execFileSync(path.join(root, 'node_modules', '.bin', binary), ['--version'], {
        cwd: root,
        encoding: 'utf8',
    }).trim();
    assert.equal(result, metadata.version, 'Le binaire installé ne retourne pas la version publiée.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
