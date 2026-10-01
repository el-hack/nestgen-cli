import { check } from 'prettier';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { generateModule } from '../dist/engine/module-generator.js';
import { generateResource } from '../dist/engine/resource-generator.js';
import { parseResourceFields, parseResourceRelations } from '../dist/engine/resource-spec.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-typeorm-e2e-'));
const npmCache = path.join(root, 'npm-cache');
const postgresContainer = `nestgen-typeorm-e2e-${process.pid}-${Date.now()}`;

function run(command, args, cwd = root, environment = {}) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...environment, npm_config_cache: npmCache, npm_config_update_notifier: 'false' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result;
}

function waitForPostgres() {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        if (
            spawnSync('docker', ['exec', postgresContainer, 'pg_isready', '-U', 'nestgen'], { encoding: 'utf8' })
                .status === 0
        )
            return;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    throw new Error('PostgreSQL n’est pas prêt après 30 secondes.');
}

try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(
            {
                name: 'nestgen-typeorm-http-integration',
                private: true,
                type: 'module',
                scripts: {
                    test: 'node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand',
                    'test:e2e':
                        'node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand --config ./test/jest-e2e.json',
                },
                jest: {
                    moduleFileExtensions: ['js', 'json', 'ts'],
                    rootDir: 'src',
                    testRegex: '.*\\.spec\\.ts$',
                    extensionsToTreatAsEsm: ['.ts'],
                    transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
                    moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
                    testEnvironment: 'node',
                },
                dependencies: {
                    '@nestjs/common': '12.0.0',
                    '@nestjs/core': '12.0.0',
                    '@nestjs/cqrs': '12.0.0',
                    '@nestjs/platform-express': '12.0.0',
                    '@nestjs/swagger': '12.0.2',
                    '@nestjs/typeorm': '12.0.0',
                    'class-transformer': '0.5.1',
                    'class-validator': '0.14.0',
                    dotenv: '16.6.1',
                    pg: '8.16.3',
                    'reflect-metadata': '0.2.2',
                    rxjs: '7.8.1',
                    supertest: '7.1.4',
                    'swagger-ui-express': '5.0.1',
                    typeorm: '0.3.27',
                },
                devDependencies: {
                    '@types/jest': '29.5.14',
                    '@types/node': '24.19.0',
                    '@types/supertest': '6.0.3',
                    '@nestjs/testing': '12.0.0',
                    jest: '29.7.0',
                    'ts-jest': '29.2.6',
                    typescript: '5.9.3',
                },
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(
        path.join(root, 'src', 'app.module.ts'),
        `import { Module } from '@nestjs/common';\nimport { TypeOrmModule } from '@nestjs/typeorm';\n\n@Module({\n    imports: [\n        TypeOrmModule.forRoot({\n            type: 'postgres',\n            host: process.env.DATABASE_HOST,\n            port: Number(process.env.DATABASE_PORT),\n            username: 'nestgen',\n            password: 'nestgen',\n            database: 'nestgen',\n            autoLoadEntities: true,\n            synchronize: true,\n        }) as never,\n    ],\n})\nexport class AppModule {}\n`,
    );
    fs.writeFileSync(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                outDir: 'build',
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
                strict: true,
                noUnusedLocals: true,
                noUnusedParameters: true,
                skipLibCheck: true,
                types: ['node', 'jest'],
            },
            include: ['src/**/*.ts'],
        }),
    );
    fs.mkdirSync(path.join(root, 'test'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'test', 'jest-e2e.json'),
        JSON.stringify({
            moduleFileExtensions: ['js', 'json', 'ts'],
            rootDir: '..',
            testRegex: 'test/.*\\.e2e-spec\\.ts$',
            extensionsToTreatAsEsm: ['.ts'],
            transform: { '^.+\\.ts$': ['ts-jest', { useESM: true }] },
            moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
            testEnvironment: 'node',
        }),
    );
    run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund']);
    await generateResource(root, {
        name: 'product',
        route: 'catalog/products',
        table: 'catalog_products',
        fields: parseResourceFields([
            'sku:string{length=64;index}!',
            'price:number',
            'published:boolean',
            'releasedAt:date?',
            'note:string?',
            'quantity:integer?',
            'amount:decimal(12;2)',
            'status:enum(DRAFT|ACTIVE)',
            'stock:integer{min=0;max=100;default=0}',
            'category:string{length=32;index;default=general}',
            'enabled:boolean?',
            'reference:uuid?',
        ]),
        indexes: [{ fields: ['sku', 'status'] }],
        profile: 'advanced',
    });
    await generateResource(root, {
        name: 'simpleproduct',
        route: 'simple-products',
        table: 'simple_products',
        fields: parseResourceFields([
            'sku:string{length=64;index}!',
            'price:number',
            'published:boolean',
            'releasedAt:date?',
            'note:string?',
            'quantity:integer?',
            'amount:decimal(12;2)',
            'status:enum(DRAFT|ACTIVE)',
            'stock:integer{min=0;max=100;default=0}',
            'category:string{length=32;index;default=general}',
            'enabled:boolean?',
            'reference:uuid?',
        ]),
        indexes: [{ fields: ['sku', 'status'] }],
        profile: 'simple',
        list: {
            filters: { sku: ['eq', 'contains'], price: ['gte', 'lt'] },
            search: ['sku'],
            sort: ['sku', 'price'],
        },
    });
    await generateResource(root, {
        name: 'customer',
        route: 'customers',
        table: 'customers',
        fields: parseResourceFields(['email:string!']),
    });
    await generateResource(root, {
        name: 'role',
        route: 'roles',
        table: 'roles',
        fields: parseResourceFields(['name:string!']),
    });
    await generateResource(root, {
        name: 'user',
        route: 'users',
        table: 'users',
        fields: parseResourceFields(['email:string!']),
        relations: parseResourceRelations([{ type: 'manyToMany', target: 'role' }]),
    });
    await generateResource(root, {
        name: 'membership',
        route: 'memberships',
        table: 'memberships',
        fields: parseResourceFields(['scope:string']),
        indexes: [{ fields: ['userId', 'roleId'], unique: true }],
        relations: parseResourceRelations([
            { type: 'belongsTo', target: 'user' },
            { type: 'belongsTo', target: 'role' },
        ]),
    });
    await generateResource(root, {
        name: 'order',
        route: 'orders',
        table: 'orders',
        fields: parseResourceFields(['reference:string!']),
        relations: parseResourceRelations([{ type: 'belongsTo', target: 'customer', onDelete: 'RESTRICT' }]),
    });
    await generateModule(root, 'audit-entry', 'typeorm');
    run('npm', ['test', '--', '--runInBand']);
    run('docker', [
        'run',
        '--detach',
        '--rm',
        '--name',
        postgresContainer,
        '-e',
        'POSTGRES_DB=nestgen',
        '-e',
        'POSTGRES_USER=nestgen',
        '-e',
        'POSTGRES_PASSWORD=nestgen',
        '-p',
        '127.0.0.1::5432',
        'postgres:16-alpine',
    ]);
    const port = run('docker', ['port', postgresContainer, '5432/tcp']).stdout.trim().split(':').at(-1);
    if (!port) throw new Error('Port PostgreSQL introuvable.');
    waitForPostgres();
    run('npm', ['run', 'test:e2e', '--', 'product.e2e-spec.ts'], root, {
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: port,
        DATABASE_USER: 'nestgen',
        DATABASE_PASSWORD: 'nestgen',
        DATABASE_TEST_NAME: 'nestgen',
    });
    run('npm', ['run', 'test:e2e', '--', 'order.e2e-spec.ts'], root, {
        DATABASE_HOST: '127.0.0.1',
        DATABASE_PORT: port,
        DATABASE_USER: 'nestgen',
        DATABASE_PASSWORD: 'nestgen',
        DATABASE_TEST_NAME: 'nestgen',
    });
    for (const entry of fs.readdirSync(path.join(root, 'src'), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name === 'app.module.ts') continue;
        const file = path.join(entry.parentPath, entry.name);
        if (
            !(await check(fs.readFileSync(file, 'utf8'), {
                parser: 'typescript',
                singleQuote: true,
                trailingComma: 'all',
            }))
        )
            throw new Error(`Generated file does not pass Prettier: ${file}`);
    }
    run('npx', ['tsc']);
    fs.writeFileSync(
        path.join(root, 'exercise.mjs'),
        fs.readFileSync(new URL('./fixtures/typeorm-http-exercise.mjs', import.meta.url), 'utf8'),
    );
    run(process.execPath, ['exercise.mjs'], root, { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: port });
} finally {
    spawnSync('docker', ['rm', '--force', postgresContainer], { encoding: 'utf8' });
    if (process.env.NESTGEN_KEEP_TYPEORM_E2E) console.error(`TypeORM integration workspace: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
}
