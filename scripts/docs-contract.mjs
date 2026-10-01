import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = manifest.version;
const guidePath = path.join(root, 'docs', 'versions', `${version}.md`);
const guide = fs.readFileSync(guidePath, 'utf8');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

assert.match(guide, new RegExp(`^# NestGen CLI ${version.replaceAll('.', '\\.')}$`, 'm'));
assert.match(changelog, new RegExp(`^## ${version.replaceAll('.', '\\.')}(?:\\s|-)`, 'm'));
for (const command of ['init', 'module', 'resource', 'config', 'doctor'])
    assert.match(guide, new RegExp(`nestgen ${command}`));
for (const option of ['--operations', '--dry-run', '--json', '--update', '--migration-name', '--application'])
    assert.match(guide, new RegExp(option.replaceAll('-', '\\-')));
