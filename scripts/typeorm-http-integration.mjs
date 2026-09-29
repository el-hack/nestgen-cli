import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
        fields: parseResourceFields(['sku:string!', 'price:number', 'published:boolean']),
        profile: 'advanced',
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
        `import 'reflect-metadata';\nimport { ValidationPipe } from '@nestjs/common';\nimport { NestFactory } from '@nestjs/core';\nimport request from 'supertest';\nimport { AppModule } from './build/app.module.js';\n\nlet step = 'initialisation de NestJS';\nconst app = await NestFactory.create(AppModule, { logger: false });\napp.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));\nawait app.init();\ntry {\n    const api = request(app.getHttpServer());\n    step = 'création de la ressource';\n    const created = await api.post('/catalog/products').send({ sku: 'sku-1', price: 12.5, published: true }).expect(201);\n    if (!created.body.id || created.body.price !== 12.5) throw new Error('La création TypeORM ne retourne pas la ressource persistée.');\n    step = 'validation HTTP 400';\n    await api.post('/catalog/products').send({ sku: 'sku-2', price: 'invalid', published: true }).expect(400);\n    step = 'conflit HTTP 409';\n    await api.post('/catalog/products').send({ sku: 'sku-1', price: 15, published: false }).expect(409);\n    step = 'borne de pagination';\n    await api.get('/catalog/products?limit=101').expect(400);\n    step = 'lecture paginée';\n    const listed = await api.get('/catalog/products?page=1&limit=1').expect(200);\n    if (listed.body.data.length !== 1 || listed.body.limit !== 1) throw new Error('La pagination ne renvoie pas le contrat attendu.');\n    step = 'mise à jour';\n    await api.patch('/catalog/products/' + created.body.id).send({ price: 20 }).expect(200);\n    step = 'lecture après mise à jour';\n    const found = await api.get('/catalog/products/' + created.body.id).expect(200);\n    if (found.body.price !== 20) throw new Error('La mise à jour TypeORM n’est pas persistée.');\n    step = 'suppression';\n    await api.delete('/catalog/products/' + created.body.id).expect(204);\n    step = 'vérification HTTP 404';\n    await api.get('/catalog/products/' + created.body.id).expect(404);\n} catch (error) {\n    console.error('TypeORM HTTP integration failed during ' + step + ':', error);\n    throw error;\n} finally {\n    await app.close();\n}\n`,
    );
    run(process.execPath, ['exercise.mjs'], root, { DATABASE_HOST: '127.0.0.1', DATABASE_PORT: port });
} finally {
    spawnSync('docker', ['rm', '--force', postgresContainer], { encoding: 'utf8' });
    if (process.env.NESTGEN_KEEP_TYPEORM_E2E) console.error(`TypeORM integration workspace: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
}
