import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyFileChanges } from '../dist/engine/file-transaction.js';
import { generateModule } from '../dist/engine/module-generator.js';
import { generateResource } from '../dist/engine/resource-generator.js';

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-transaction-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'prisma'));
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
            dependencies: {
                '@nestjs/common': '12',
                '@nestjs/core': '12',
                '@nestjs/cqrs': '12',
                '@nestjs/typeorm': '12',
                typeorm: '0.3',
                '@prisma/client': '6',
            },
        }),
    );
    fs.writeFileSync(
        path.join(root, 'src/app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
        { mode: 0o640 },
    );
    fs.writeFileSync(path.join(root, 'prisma/schema.prisma'), '// existing schema\n', { mode: 0o600 });
    return root;
}

function snapshot(root) {
    const result = {};
    function walk(directory) {
        for (const name of fs.readdirSync(directory).sort()) {
            const target = path.join(directory, name);
            const stat = fs.statSync(target);
            result[path.relative(root, target)] = stat.isDirectory()
                ? { directory: true, mode: stat.mode & 0o777 }
                : { content: fs.readFileSync(target).toString('base64'), mode: stat.mode & 0o777 };
            if (stat.isDirectory()) walk(target);
        }
    }
    walk(root);
    return result;
}

const generators = {
    'module TypeORM': (root) => generateModule(root, 'invoice', 'typeorm'),
    'module Prisma': (root) => generateModule(root, 'invoice', 'prisma'),
    'resource simple': (root) =>
        generateResource(root, {
            name: 'invoice',
            route: 'invoices',
            table: 'invoices',
            fields: [{ name: 'total', type: 'number', nullable: false, unique: false }],
        }),
    'resource advanced': (root) =>
        generateResource(root, {
            name: 'invoice',
            route: 'invoices',
            table: 'invoices',
            profile: 'advanced',
            fields: [{ name: 'total', type: 'number', nullable: false, unique: false }],
        }),
};

for (const [name, generate] of Object.entries(generators)) {
    test(`${name}: restores bytes, modes and directories on every write failure`, async (t) => {
        const methods = ['mkdirSync', 'writeFileSync', 'chmodSync', 'renameSync'];
        const root = fixture(t);
        const counts = Object.fromEntries(methods.map((method) => [method, 0]));
        for (const method of methods) {
            const original = fs[method];
            t.mock.method(fs, method, (...args) => {
                counts[method]++;
                return original(...args);
            });
        }
        try {
            await generate(root);
        } finally {
            t.mock.restoreAll();
        }
        assert.ok(fs.existsSync(path.join(root, 'src/app/invoice/invoice.module.ts')));
        assert.equal(fs.statSync(path.join(root, 'src/app.module.ts')).mode & 0o777, 0o640);
        assert.ok(!fs.existsSync(path.join(root, '.nestgen-transaction')));
        for (const method of methods) {
            for (let failAt = 1; failAt <= counts[method]; failAt++) {
                const target = fixture(t);
                const before = snapshot(target);
                const original = fs[method];
                let count = 0;
                t.mock.method(fs, method, (...args) => {
                    if (++count === failAt) {
                        // Model a partial disk write before an I/O error. Only staging files may be touched.
                        if (method === 'writeFileSync') original(args[0], 'partial');
                        throw new Error(`injected ${method} #${failAt}`);
                    }
                    return original(...args);
                });
                try {
                    await assert.rejects(() => generate(target), /injected/);
                } finally {
                    t.mock.restoreAll();
                }
                assert.deepEqual(snapshot(target), before, `${name}: ${method} #${failAt}`);
                await generate(target); // A recovered invocation must not leave a stale lock blocking retries.
            }
        }
    });
}

test('validates all transformations and destinations before staging', async (t) => {
    const root = fixture(t);
    fs.appendFileSync(path.join(root, 'prisma/schema.prisma'), '\nmodel Invoice { id String @id }\n');
    const before = snapshot(root);
    const mkdir = t.mock.method(fs, 'mkdirSync', () => {
        throw new Error('unexpected write');
    });
    await assert.rejects(() => generateModule(root, 'invoice', 'prisma'), /existe déjà/);
    assert.throws(
        () =>
            applyFileChanges(root, [
                { path: 'new.ts', content: 'new', operation: 'create' },
                { path: 'src/app.module.ts', content: 'collision', operation: 'create' },
            ]),
        /existe déjà/,
    );
    assert.equal(mkdir.mock.callCount(), 0);
    assert.deepEqual(snapshot(root), before);
});

test('does not acquire or remove another invocation’s lock', async (t) => {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, '.nestgen-transaction'));
    fs.writeFileSync(path.join(root, '.nestgen-transaction/owner'), 'other process');
    const before = snapshot(root);
    await assert.rejects(() => generators['resource simple'](root), /EEXIST/);
    assert.deepEqual(snapshot(root), before);
});

test('retains backups and reports both failures if restoration itself fails', (t) => {
    const root = fixture(t);
    const originalApp = fs.readFileSync(path.join(root, 'src/app.module.ts'));
    const original = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => {
        if (to.endsWith('schema.prisma') || from.includes('old-')) throw new Error('persistent I/O failure');
        return original(from, to);
    });
    try {
        assert.throws(
            () =>
                applyFileChanges(root, [
                    { path: 'src/app.module.ts', content: 'replacement', operation: 'replace' },
                    { path: 'prisma/schema.prisma', content: 'replacement', operation: 'replace' },
                ]),
            (error) => error instanceof AggregateError && /Restauration incomplète/.test(error.message),
        );
    } finally {
        t.mock.restoreAll();
    }
    assert.deepEqual(fs.readFileSync(path.join(root, '.nestgen-transaction/old-0')), originalApp);
    assert.ok(fs.existsSync(path.join(root, '.nestgen-transaction/manifest.json')));
    assert.throws(() => applyFileChanges(root, [{ path: 'new.ts', content: 'new', operation: 'create' }]), /EEXIST/);
});
