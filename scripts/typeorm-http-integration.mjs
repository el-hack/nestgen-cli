import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import { generateResource } from '../dist/engine/resource-generator.js';
import { parseResourceFields } from '../dist/engine/resource-spec.js';

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
                dependencies: {
                    '@nestjs/common': '12.0.0',
                    '@nestjs/core': '12.0.0',
                    '@nestjs/platform-express': '12.0.0',
                    '@nestjs/typeorm': '12.0.0',
                    'class-transformer': '0.5.1',
                    'class-validator': '0.14.0',
                    pg: '8.16.3',
                    'reflect-metadata': '0.2.2',
                    rxjs: '7.8.1',
                    supertest: '7.1.4',
                    typeorm: '0.3.27',
                },
                devDependencies: { typescript: '5.9.3', '@types/node': '24.19.0' },
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
                skipLibCheck: true,
            },
            include: ['src/**/*.ts'],
        }),
    );
    run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund']);
    generateResource(root, {
        name: 'product',
        route: 'catalog/products',
        table: 'catalog_products',
        fields: parseResourceFields([
            'sku:string!',
            'price:number',
            'published:boolean',
            'releasedAt:date?',
            'note:string?',
            'quantity:number?',
            'enabled:boolean?',
            'reference:uuid?',
        ]),
        profile: 'advanced',
    });
    generateResource(root, {
        name: 'simpleproduct',
        route: 'simple-products',
        table: 'simple_products',
        fields: parseResourceFields([
            'sku:string!',
            'price:number',
            'published:boolean',
            'releasedAt:date?',
            'note:string?',
            'quantity:number?',
            'enabled:boolean?',
            'reference:uuid?',
        ]),
        profile: 'simple',
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
