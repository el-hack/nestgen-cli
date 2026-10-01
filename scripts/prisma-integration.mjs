import { check } from 'prettier';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateResource } from '../dist/engine/resource-generator.js';
import { parseResourceFields } from '../dist/engine/resource-spec.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-prisma-e2e-'));
const npmCache = path.join(root, 'npm-cache');
const postgresContainer = `nestgen-prisma-e2e-${process.pid}-${Date.now()}`;

function run(command, args, cwd = root) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: npmCache, npm_config_update_notifier: 'false' },
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
    fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(
            {
                name: 'nestgen-prisma-integration',
                private: true,
                dependencies: {
                    '@nestjs/common': '12.0.0',
                    '@nestjs/core': '12.0.0',
                    '@nestjs/cqrs': '12.0.0',
                    '@nestjs/platform-express': '12.0.0',
                    '@prisma/client': '6.19.3',
                    'class-transformer': '0.5.1',
                    'class-validator': '0.14.0',
                    'reflect-metadata': '0.2.2',
                    rxjs: '7.8.1',
                },
                devDependencies: { prisma: '6.19.3', typescript: '5.9.3', '@types/node': '24.19.0' },
            },
            null,
            2,
        ),
    );
    fs.writeFileSync(
        path.join(root, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    fs.writeFileSync(
        path.join(root, 'prisma', 'schema.prisma'),
        'generator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n',
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
            },
            include: ['src/**/*.ts'],
        }),
    );

    run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund']);
    await generateResource(root, {
        name: 'product',
        route: 'products',
        table: 'products',
        orm: 'prisma',
        fields: parseResourceFields([
            'sku:string!',
            'price:number',
            'quantity:integer',
            'amount:decimal(12;2)',
            'status:enum(DRAFT|ACTIVE)',
            'published:boolean',
            'releasedAt:date?',
        ]),
    });
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
    fs.writeFileSync(
        path.join(root, '.env'),
        `DATABASE_URL="postgresql://nestgen:nestgen@127.0.0.1:${port}/nestgen?schema=public"\n`,
    );
    run('npx', ['prisma', 'generate']);
    run('npx', ['prisma', 'db', 'push', '--skip-generate']);
    run('npx', ['tsc', '--noEmit']);
    fs.writeFileSync(
        path.join(root, 'persist.mjs'),
        "import 'reflect-metadata';\nimport { ConflictException, NotFoundException } from '@nestjs/common';\nimport { NestFactory } from '@nestjs/core';\nimport { AppModule } from './build/app.module.js';\nimport { ProductRepository } from './build/app/product/persistence/product.repository.js';\nconst app = await NestFactory.createApplicationContext(AppModule, { logger: false });\ntry { const repository = app.get(ProductRepository); const created = await repository.create({ sku: 'integration-sku', price: 12.5, quantity: 7, amount: '1234567890.12', status: 'DRAFT', published: true }); const found = await repository.findOne(created.id); if (found.price !== 12.5 || found.quantity !== 7 || found.amount !== '1234567890.12' || found.status !== 'DRAFT') throw new Error('persisted rich resource was not found without precision loss'); const updated = await repository.update(created.id, { price: 20, quantity: 8, amount: '9876543210.98', status: 'ACTIVE' }); if (updated.price !== 20 || updated.quantity !== 8 || updated.amount !== '9876543210.98' || updated.status !== 'ACTIVE') throw new Error('persisted rich resource was not updated'); await repository.create({ sku: 'integration-sku', price: 1, quantity: 1, amount: '1.00', status: 'DRAFT', published: false }).then(() => { throw new Error('duplicate resource was created'); }, (error) => { if (!(error instanceof ConflictException)) throw error; }); await repository.remove(created.id); await repository.findOne(created.id).then(() => { throw new Error('deleted resource was found'); }, (error) => { if (!(error instanceof NotFoundException)) throw error; }); } finally { await app.close(); }\n",
    );
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
    run(process.execPath, ['persist.mjs']);
} finally {
    spawnSync('docker', ['rm', '--force', postgresContainer], { encoding: 'utf8' });
    if (process.env.NESTGEN_KEEP_PRISMA_E2E) console.error(`Prisma integration workspace: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
}
