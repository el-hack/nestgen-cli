import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateResource } from '../dist/engine/resource-generator.js';
import { checkGeneratedFiles, loadGenerationManifest } from '../dist/engine/generation-manifest.js';

const cli = path.resolve('nestgen.js');
const appModule = "import { Module } from '@nestjs/common';\n@Module({ imports: [] }) export class AppModule {}\n";

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-check-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src/app.module.ts'), appModule);
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
            dependencies: { '@nestjs/common': '12', '@nestjs/core': '12', '@nestjs/typeorm': '12', typeorm: '0.3' },
        }),
    );
    return root;
}

function runCheck(root) {
    return spawnSync(process.execPath, [cli, 'check', '--json'], { cwd: root, encoding: 'utf8' });
}

function hash(content) {
    return createHash('sha256').update(content).digest('hex');
}

test('check handles shared files across generations and reports drift without writes', async (t) => {
    const root = fixture(t);
    for (const name of ['product', 'customer']) {
        await generateResource(root, {
            name,
            route: `${name}s`,
            table: `${name}s`,
            fields: [{ name: 'label', type: 'string', nullable: false, unique: false }],
        });
    }
    const manifest = loadGenerationManifest(root);
    const shared = 'src/app.module.ts';
    assert.equal(
        manifest.generations['resource:src/app/product'].files[shared],
        hash(fs.readFileSync(path.join(root, shared), 'utf8')),
    );
    assert.equal(
        manifest.generations['resource:src/app/customer'].files[shared],
        manifest.generations['resource:src/app/product'].files[shared],
    );

    const baseline = runCheck(root);
    assert.equal(baseline.status, 0, baseline.stderr);
    const baselineResult = JSON.parse(baseline.stdout);
    assert.equal(baselineResult.ok, true);
    assert.ok(baselineResult.result.checkedFiles > 0);

    const modified = 'src/app/product/product.module.ts';
    const missing = 'src/app/customer/customer.module.ts';
    fs.appendFileSync(path.join(root, modified), '// edited\n');
    fs.unlinkSync(path.join(root, missing));
    const before = fs.readFileSync(path.join(root, '.nestgen/generation-manifest.json'), 'utf8');
    const drift = runCheck(root);
    assert.equal(drift.status, 1);
    assert.deepEqual(JSON.parse(drift.stdout).result.modified, [modified]);
    assert.deepEqual(JSON.parse(drift.stdout).result.missing, [missing]);
    assert.equal(JSON.parse(drift.stdout).ok, false);
    assert.equal(fs.readFileSync(path.join(root, '.nestgen/generation-manifest.json'), 'utf8'), before);
    assert.equal(fs.readFileSync(path.join(root, modified), 'utf8').endsWith('// edited\n'), true);
    assert.equal(fs.existsSync(path.join(root, missing)), false);
});

test('check accepts historical shared fingerprints in older manifests', async (t) => {
    const root = fixture(t);
    const file = 'src/app.module.ts';
    const manifestPath = path.join(root, '.nestgen/generation-manifest.json');
    fs.mkdirSync(path.dirname(manifestPath));
    fs.writeFileSync(
        manifestPath,
        JSON.stringify({
            version: 1,
            generations: {
                'resource:src/app/old': { files: { [file]: hash('old content') } },
                'resource:src/app/new': { files: { [file]: hash(appModule) } },
            },
        }),
    );
    assert.deepEqual(checkGeneratedFiles(root), { checkedFiles: 1, missing: [], modified: [] });
    fs.appendFileSync(path.join(root, file), '// change\n');
    assert.deepEqual(checkGeneratedFiles(root).modified, [file]);
});

test('check rejects a project without a manifest', (t) => {
    const root = fixture(t);
    const result = runCheck(root);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error.message, /Manifeste de génération introuvable/);
});
