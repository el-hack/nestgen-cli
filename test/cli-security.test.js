import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    parseModuleArgs,
    resolveProjectPath,
    validateModuleName,
    validateOrm,
} from '../nestgen.js';

const cliPath = path.resolve('nestgen.js');
const addModuleScriptPath = path.resolve('nestjs-generator/features/add_module.sh');
const dockerScriptPath = path.resolve('nestjs-generator/features/docker.sh');
const injectModuleScriptPath = path.resolve('nestjs-generator/features/inject_module_to_app.sh');

test('validates module names and supported ORMs', () => {
    assert.equal(validateModuleName('Order-Item'), 'order-item');
    assert.equal(validateModuleName('order_item'), 'order_item');
    assert.equal(validateOrm('Prisma'), 'prisma');
    assert.deepEqual(parseModuleArgs(['module', 'user', '--orm=typeorm']), {
        moduleName: 'user',
        orm: 'typeorm',
    });

    for (const value of ['', '../user', 'user/name', 'user$(touch marker)', '--user']) {
        assert.throws(() => validateModuleName(value));
    }

    assert.throws(() => validateOrm('mongoose'));
});

test('accepts project paths containing spaces without shell interpolation', () => {
    const projectPath = path.join(os.tmpdir(), 'nestgen project with spaces');
    assert.equal(resolveProjectPath(projectPath), projectPath);
    assert.throws(() => resolveProjectPath('\0'));
});

test('rejects a malicious module name before running the generator script', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-cli-security-'));
    const generatorPath = path.join(fixturePath, 'generator');
    const featuresPath = path.join(generatorPath, 'features');
    const markerPath = path.join(fixturePath, 'marker');
    const outputPath = path.join(fixturePath, 'received-module-name');

    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.mkdirSync(featuresPath, { recursive: true });
    fs.writeFileSync(path.join(fixturePath, 'src', 'app.module.ts'), 'export class AppModule {}\n');
    fs.writeFileSync(
        path.join(featuresPath, 'add_module.sh'),
        '#!/usr/bin/env bash\nset -eu\nprintf "%s" "$1" > "$OUTPUT_FILE"\n',
        { mode: 0o755 },
    );

    const maliciousName = `user$(touch ${markerPath})`;
    const rejected = spawnSync(process.execPath, [cliPath, 'module', maliciousName], {
        cwd: fixturePath,
        encoding: 'utf8',
        env: {
            ...process.env,
            NESTGEN_ROOT: generatorPath,
            OUTPUT_FILE: outputPath,
        },
    });

    assert.equal(rejected.status, 1);
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(fs.existsSync(outputPath), false);

    const accepted = spawnSync(process.execPath, [cliPath, 'module', 'order-item', '--orm=prisma'], {
        cwd: fixturePath,
        encoding: 'utf8',
        env: {
            ...process.env,
            NESTGEN_ROOT: generatorPath,
            OUTPUT_FILE: outputPath,
        },
    });

    assert.equal(accepted.status, 0);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'order-item');
});

test('refuses to overwrite an existing generated module', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-module-collision-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');

    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n");

    const firstGeneration = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(firstGeneration.status, 0, firstGeneration.stderr);

    const entityPath = path.join(fixturePath, 'src', 'app', 'invoice', 'core', 'domain', 'entities', 'invoice.entity.ts');
    fs.appendFileSync(entityPath, '\n// user customization\n');

    const secondGeneration = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(secondGeneration.status, 1);
    assert.match(fs.readFileSync(entityPath, 'utf8'), /user customization/);

    const traversal = spawnSync('bash', [addModuleScriptPath, '../../outside', 'prisma'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(traversal.status, 1);
    assert.equal(fs.existsSync(path.join(fixturePath, 'outside')), false);
});

test('preserves an existing environment file when Docker is requested', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-env-collision-'));
    const environmentPath = path.join(fixturePath, '.env');
    fs.writeFileSync(environmentPath, 'CUSTOM_VALUE=preserve-me\n');

    const result = spawnSync('bash', [dockerScriptPath, 'my-app'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(environmentPath, 'utf8'), 'CUSTOM_VALUE=preserve-me\n');
});

test('refuses Docker file collisions and source symlinks without changing their targets', () => {
    const dockerFixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-docker-collision-'));
    const dockerfilePath = path.join(dockerFixturePath, 'Dockerfile');
    fs.writeFileSync(dockerfilePath, '# custom Dockerfile\n');

    const dockerCollision = spawnSync('bash', [dockerScriptPath, 'my-app'], {
        cwd: dockerFixturePath,
        encoding: 'utf8',
    });
    assert.equal(dockerCollision.status, 1);
    assert.equal(fs.readFileSync(dockerfilePath, 'utf8'), '# custom Dockerfile\n');

    const symlinkFixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-symlink-collision-'));
    const outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-outside-'));
    fs.mkdirSync(path.join(symlinkFixturePath, 'src'), { recursive: true });
    fs.symlinkSync(outsidePath, path.join(symlinkFixturePath, 'src', 'app'));

    const symlinkAttempt = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: symlinkFixturePath,
        encoding: 'utf8',
    });
    assert.equal(symlinkAttempt.status, 1);
    assert.equal(fs.readdirSync(outsidePath).length, 0);
});

function writeGeneratedModule(fixturePath, name, className) {
    const modulePath = path.join(fixturePath, 'src', 'app', name, `${name}.module.ts`);
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.writeFileSync(modulePath, `export class ${className} {}\n`);
}

function decoratorImports(appModule) {
    return appModule.match(/@Module\s*\(\s*\{[\s\S]*?imports\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
}

test('registers a generated module in AppModule exactly once', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-app-module-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [],\n})\nexport class AppModule {}\n");
    writeGeneratedModule(fixturePath, 'order', 'OrderModule');

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = spawnSync('bash', [injectModuleScriptPath, 'order', 'prisma'], {
            cwd: fixturePath,
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
    }

    const appModule = fs.readFileSync(appModulePath, 'utf8');
    const imports = decoratorImports(appModule);
    assert.match(appModule, /import \{ OrderModule \} from '\.\/app\/order\/order\.module';/);
    assert.equal((imports.match(/\bOrderModule\b/g) ?? []).length, 1);
    assert.equal((imports.match(/\bCqrsModule\b/g) ?? []).length, 1);
});

test('updates a multiline AppModule and leaves unsupported forms untouched', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-app-module-multiline-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [\n    ExistingModule,\n  ],\n})\nexport class AppModule {}\n");
    writeGeneratedModule(fixturePath, 'invoice', 'InvoiceModule');

    const supported = spawnSync('bash', [injectModuleScriptPath, 'invoice', 'prisma'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(supported.status, 0, supported.stderr);
    assert.match(decoratorImports(fs.readFileSync(appModulePath, 'utf8')), /ExistingModule,[\s\S]*CqrsModule,[\s\S]*InvoiceModule/);

    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n@Module({ controllers: [] })\nexport class AppModule {}\n");
    const before = fs.readFileSync(appModulePath, 'utf8');
    const unsupported = spawnSync('bash', [injectModuleScriptPath, 'invoice', 'prisma'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /tableau imports/);
    assert.equal(fs.readFileSync(appModulePath, 'utf8'), before);
});

test('keeps the TypeORM root configuration idempotent', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-app-module-typeorm-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n");
    writeGeneratedModule(fixturePath, 'customer', 'CustomerModule');

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = spawnSync('bash', [injectModuleScriptPath, 'customer', 'typeorm'], {
            cwd: fixturePath,
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
    }

    const appModule = fs.readFileSync(appModulePath, 'utf8');
    assert.equal((appModule.match(/TypeOrmModule\.forRoot/g) ?? []).length, 1);
    assert.equal((decoratorImports(appModule).match(/\bCustomerModule\b/g) ?? []).length, 1);
});
