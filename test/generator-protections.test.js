import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateModule } from '../dist/engine/module-generator.js';
import { generateResource } from '../dist/engine/resource-generator.js';
import { applyFileChanges } from '../dist/engine/file-transaction.js';

const source = "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n";
function fixture(t) {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-protections-'));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    const root = path.join(base, 'project');
    fs.mkdirSync(path.join(root, 'src/app'), { recursive: true });
    fs.mkdirSync(path.join(root, 'prisma'));
    fs.mkdirSync(path.join(base, 'outside'));
    fs.writeFileSync(path.join(root, 'src/app.module.ts'), source);
    fs.writeFileSync(path.join(root, 'prisma/schema.prisma'), '// existing schema\n');
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
    return { base, root };
}

// Include external targets, dangling links and directory entries without ever following a symlink.
function snapshot(root) {
    const result = {};
    function walk(directory) {
        for (const name of fs.readdirSync(directory).sort()) {
            const file = path.join(directory, name);
            const stat = fs.lstatSync(file);
            result[path.relative(root, file)] = {
                mode: stat.mode,
                value: stat.isSymbolicLink()
                    ? fs.readlinkSync(file)
                    : stat.isDirectory()
                      ? 'directory'
                      : fs.readFileSync(file).toString('base64'),
            };
            if (stat.isDirectory()) walk(file);
        }
    }
    walk(root);
    return result;
}

const generators = [
    ['module TypeORM', (root, name = 'invoice') => generateModule(root, name, 'typeorm')],
    ['module Prisma', (root, name = 'invoice') => generateModule(root, name, 'prisma')],
    ...['simple', 'advanced'].map((profile) => [
        `resource ${profile}`,
        (root, name = 'invoice') =>
            generateResource(root, {
                name,
                profile,
                route: 'invoices',
                table: 'invoices',
                fields: [{ name: 'total', type: 'number', nullable: false, unique: false }],
            }),
    ]),
];

for (const [label, generate] of generators) {
    test(`${label}: rejects unsafe structures before any mutation`, async (t) => {
        const cases = [
            ['missing package', (root) => fs.unlinkSync(path.join(root, 'package.json')), /package.json introuvable/],
            ['invalid JSON', (root) => fs.writeFileSync(path.join(root, 'package.json'), '{'), /JSON invalide/],
            ['null JSON', (root) => fs.writeFileSync(path.join(root, 'package.json'), 'null'), /JSON invalide/],
            [
                'missing dependency',
                (root) => fs.writeFileSync(path.join(root, 'package.json'), '{}'),
                /dépendances manquantes/,
            ],
            [
                'monorepo',
                (root) => fs.writeFileSync(path.join(root, 'nest-cli.json'), '{"monorepo":true}'),
                /workspaces Nest/,
            ],
            [
                'custom sourceRoot',
                (root) => fs.writeFileSync(path.join(root, 'nest-cli.json'), '{"sourceRoot":"custom"}'),
                /sourceRoot personnalisé/,
            ],
            [
                'missing app module',
                (root) => fs.unlinkSync(path.join(root, 'src/app.module.ts')),
                /app.module.ts introuvable/,
            ],
            [
                'dynamic imports',
                (root) =>
                    fs.writeFileSync(
                        path.join(root, 'src/app.module.ts'),
                        source.replace('imports: []', 'imports: modules'),
                    ),
                /imports: \[\]/,
            ],
            [
                'spread metadata',
                (root) =>
                    fs.writeFileSync(
                        path.join(root, 'src/app.module.ts'),
                        source.replace('imports: []', 'imports: [], ...metadata'),
                    ),
                /spread/,
            ],
            [
                'duplicate imports',
                (root) =>
                    fs.writeFileSync(
                        path.join(root, 'src/app.module.ts'),
                        source.replace('imports: []', 'imports: [], imports: []'),
                    ),
                /dupliquée/,
            ],
            [
                'existing feature',
                (root) => {
                    fs.mkdirSync(path.join(root, 'src/app/invoice'));
                    fs.writeFileSync(path.join(root, 'src/app/invoice/custom.ts'), 'business logic');
                },
                /existe déjà/,
            ],
            [
                'file instead of parent',
                (root) => {
                    fs.rmdirSync(path.join(root, 'src/app'));
                    fs.writeFileSync(path.join(root, 'src/app'), 'keep');
                },
                /Répertoire attendu/,
            ],
        ];
        for (const [name, prepare, expected] of cases) {
            await t.test(name, (t) => {
                const { root, base } = fixture(t);
                prepare(root);
                const before = snapshot(base);
                const mkdir = t.mock.method(fs, 'mkdirSync', () => {
                    throw new Error('unexpected mutation');
                });
                assert.throws(() => generate(root), expected);
                assert.equal(mkdir.mock.callCount(), 0);
                assert.deepEqual(snapshot(base), before);
            });
        }
    });
    test(`${label}: preserves internal, external and dangling symlinks`, async (t) => {
        const paths = ['package.json', 'nest-cli.json', 'src', 'src/app.module.ts', 'src/app', 'src/app/invoice'];
        if (label === 'module Prisma')
            paths.push(
                'prisma',
                'prisma/schema.prisma',
                'src/prisma',
                'src/prisma/prisma.service.ts',
                'src/prisma/prisma.module.ts',
            );
        for (const relative of paths)
            for (const kind of ['external', 'internal', 'dangling']) {
                await t.test(`${relative}: ${kind}`, (t) => {
                    const { root, base } = fixture(t);
                    const link = path.join(root, relative);
                    const destination =
                        kind === 'internal' ? path.join(root, 'link-target') : path.join(base, 'outside/target');
                    fs.mkdirSync(path.dirname(link), { recursive: true });
                    if (fs.existsSync(link)) fs.renameSync(link, destination);
                    else fs.writeFileSync(destination, 'preserve external content');
                    if (kind === 'dangling') fs.rmSync(destination, { recursive: true });
                    fs.symlinkSync(destination, link);
                    const before = snapshot(base);
                    const mkdir = t.mock.method(fs, 'mkdirSync', () => {
                        throw new Error('unexpected mutation');
                    });
                    assert.throws(() => generate(root), /Lien symbolique non supporté/);
                    assert.equal(mkdir.mock.callCount(), 0);
                    assert.deepEqual(snapshot(base), before);
                });
            }
    });
    test(`${label}: rejects path traversal and malformed names`, (t) => {
        const { root, base } = fixture(t);
        const before = snapshot(base);
        for (const name of ['../outside', '/tmp/escape', 'a/../../outside', 'a\\..\\outside', 'a--b', 'a-'])
            assert.throws(() => generate(root, name), /Nom de .* invalide/);
        assert.deepEqual(snapshot(base), before);
    });
}

test('resource generation does not require unused CQRS dependencies', (t) => {
    const { root } = fixture(t);
    const file = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete manifest.dependencies['@nestjs/cqrs'];
    fs.writeFileSync(file, JSON.stringify(manifest));
    generators[2][1](root);
    assert.ok(fs.existsSync(path.join(root, 'src/app/invoice/invoice.module.ts')));
});

test('shared write boundary rejects out-of-root paths before writing anything', (t) => {
    const { root, base } = fixture(t);
    const before = snapshot(base);
    for (const target of ['../outside/escape', path.join(base, 'outside/escape'), '.']) {
        assert.throws(
            () =>
                applyFileChanges(root, [
                    { path: 'safe.ts', content: 'must not appear', operation: 'create' },
                    { path: target, content: 'escape', operation: 'create' },
                ]),
            /hors projet/,
        );
        assert.deepEqual(snapshot(base), before);
    }
});
