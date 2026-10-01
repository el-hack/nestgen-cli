import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const tag = args.get('--tag');
const commit = args.get('--commit');
const output = args.get('--output');

function run(command, commandArgs) {
    return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8' }).trim();
}

if (!tag || !commit) throw new Error('Usage: release-verify.mjs --tag vX.Y.Z --commit <sha> [--output <file>]');
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw new Error(`Tag SemVer invalide : ${tag}`);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lockfile = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const version = packageJson.version;
assert.equal(tag, `v${version}`, 'Le tag doit correspondre exactement à package.json#version.');
assert.equal(lockfile.version, version, 'package-lock.json doit porter la même version.');
assert.equal(lockfile.packages[''].version, version, 'La racine de package-lock.json doit porter la même version.');
assert.match(
    fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
    new RegExp(`^## ${version.replaceAll('.', '\\.')}(?:\\s|-)`, 'm'),
    'CHANGELOG.md doit contenir une section pour la version publiée.',
);
const guide = fs.readFileSync(path.join(root, 'docs', 'versions', `${version}.md`), 'utf8');
assert.match(guide, new RegExp(`^# NestGen CLI ${version.replaceAll('.', '\\.')}$`, 'm'));
assert.equal(run('git', ['rev-parse', `${tag}^{commit}`]), commit, 'Le tag doit pointer sur le commit publié.');
assert.equal(run('git', ['rev-parse', 'HEAD']), commit, 'Le workflow doit publier le commit taggé.');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-release-'));
try {
    const packed = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory]));
    assert.equal(packed.length, 1, 'npm pack doit produire une archive unique.');
    const artifact = packed[0];
    assert.equal(artifact.name, packageJson.name, 'L’archive doit porter le nom npm attendu.');
    assert.equal(artifact.version, version, 'L’archive doit porter la version taggée.');
    assert.match(artifact.integrity, /^sha512-/, 'L’archive doit avoir une intégrité SHA-512.');
    const metadata = { name: packageJson.name, version, tag, commit, integrity: artifact.integrity };
    if (output) fs.writeFileSync(path.resolve(root, output), `${JSON.stringify(metadata, null, 4)}\n`);
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
