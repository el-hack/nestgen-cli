import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { check } from 'prettier';
import { generateModule, registerModuleInAppModule } from '../dist/engine/module-generator.js';
import { generateResource } from '../dist/engine/resource-generator.js';
import { parseResourceFields } from '../dist/engine/resource-spec.js';

const appSource =
    "// keep my spacing\nimport { Module } from '@nestjs/common';\n@Module({ imports: [ /* keep this */ ] })\nexport class AppModule { }\n";
const options = { semi: false, singleQuote: false, tabWidth: 4, printWidth: 90, trailingComma: 'none' };
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-format-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'prisma'));
    fs.writeFileSync(path.join(root, 'src/app.module.ts'), appSource);
    fs.writeFileSync(path.join(root, 'src/user.ts'), 'export   const custom = 1;\n');
    fs.writeFileSync(path.join(root, 'prisma/schema.prisma'), '// existing schema\n');
    fs.writeFileSync(path.join(root, '.prettierrc.json'), JSON.stringify(options));
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
    return root;
}

const variants = [
    ['module TypeORM', (root) => generateModule(root, 'invoice', 'typeorm')],
    ['module Prisma', (root) => generateModule(root, 'invoice', 'prisma')],
    ...['simple', 'advanced'].map((profile) => [
        `resource ${profile}`,
        (root) =>
            generateResource(root, {
                name: 'invoice',
                route: 'invoices',
                table: 'invoices',
                profile,
                fields: parseResourceFields([
                    'total:number',
                    'label:string?',
                    'active:boolean',
                    'dueAt:date?',
                    'reference:uuid',
                ]),
            }),
    ]),
];
for (const [label, generate] of variants) {
    test(`${label}: follows project formatting only for new files`, async (t) => {
        const root = fixture(t);
        await generate(root);
        const entries = fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true });
        const generated = entries.filter(
            (entry) =>
                entry.isFile() && !['app.module.ts', 'user.ts'].includes(entry.name) && entry.name.endsWith('.ts'),
        );
        assert.ok(generated.length > 0);
        for (const entry of generated) {
            const source = fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8');
            assert.ok(await check(source, { ...options, parser: 'typescript' }), entry.name);
        }
        assert.equal(fs.readFileSync(path.join(root, 'src/user.ts'), 'utf8'), 'export   const custom = 1;\n');
        assert.equal(
            fs.readFileSync(path.join(root, 'src/app.module.ts'), 'utf8'),
            registerModuleInAppModule(appSource, 'InvoiceModule', './app/invoice/invoice.module.js'),
        );
    });
    test(`${label}: formatting failure cannot leave generated files`, async (t) => {
        const root = fixture(t);
        fs.writeFileSync(path.join(root, '.prettierrc.json'), '{ invalid json');
        await assert.rejects(() => generate(root), /JSON|json/);
        assert.equal(fs.existsSync(path.join(root, 'src/app')), false);
        assert.equal(fs.readFileSync(path.join(root, 'src/app.module.ts'), 'utf8'), appSource);
        assert.equal(fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8'), '// existing schema\n');
        assert.equal(fs.existsSync(path.join(root, '.nestgen-transaction')), false);
    });
}
