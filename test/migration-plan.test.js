import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planResourceMigration } from '../dist/engine/migration-plan.js';

function project(t, orm) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-migration-plan-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '.nestgen'));
    fs.writeFileSync(
        path.join(root, '.nestgen', 'generation-manifest.json'),
        JSON.stringify({
            version: 1,
            generations: {
                'resource:src/app/product': {
                    generator: { name: 'nestgen-cli', version: '0.1.0' },
                    definition: {
                        kind: 'resource',
                        name: 'product',
                        orm,
                        sourceRoot: 'src',
                        route: 'products',
                        table: 'products',
                        profile: 'simple',
                        fields: [
                            { name: 'sku', type: 'string', nullable: false, unique: false },
                            { name: 'legacy', type: 'string', nullable: true, unique: false },
                        ],
                        indexes: [],
                        relations: [
                            {
                                type: 'belongsTo',
                                target: 'category',
                                field: 'category',
                                nullable: false,
                                onDelete: 'RESTRICT',
                            },
                        ],
                        list: { cursor: false, filters: {}, search: [], sort: [] },
                    },
                    files: {},
                },
            },
        }),
    );
    return root;
}

test('plans TypeORM migrations and identifies destructive schema changes', (t) => {
    const plan = planResourceMigration(
        project(t, 'typeorm'),
        'src',
        'product',
        'typeorm',
        'reshape-product',
        [{ name: 'sku', type: 'number', nullable: false, unique: false }],
        [{ fields: ['sku'], unique: true }],
        [],
    );
    assert.equal(plan.appliesMigration, false);
    assert.match(plan.command, /typeorm-ts-node-commonjs migration:generate/);
    assert.match(plan.command, /--dataSource src\/database\/data-source\.ts/);
    assert.deepEqual(
        plan.risks.map((risk) => risk.id),
        ['FIELD_TYPE_CHANGED', 'COLUMN_REMOVED', 'UNIQUE_CONSTRAINT_ADDED', 'RELATION_REMOVED'],
    );
});

test('plans Prisma create-only migrations without applying them', (t) => {
    const plan = planResourceMigration(
        project(t, 'prisma'),
        'src',
        'product',
        'prisma',
        'add-price',
        [
            { name: 'sku', type: 'string', nullable: false, unique: false },
            { name: 'legacy', type: 'string', nullable: true, unique: false },
            { name: 'price', type: 'number', nullable: false, unique: false },
        ],
        [],
        [{ type: 'belongsTo', target: 'category', field: 'category', nullable: false, onDelete: 'RESTRICT' }],
    );
    assert.equal(plan.command, 'npx prisma migrate dev --create-only --name add-price');
    assert.equal(plan.appliesMigration, false);
    assert.deepEqual(plan.risks, []);
});
