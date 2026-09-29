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
import { describeResource } from '../nestjs-generator/features/resource_name.mjs';

const cliPath = path.resolve('nestgen.js');
const addModuleScriptPath = path.resolve('nestjs-generator/features/add_module.sh');
const dockerScriptPath = path.resolve('nestjs-generator/features/docker.sh');
const injectModuleScriptPath = path.resolve('nestjs-generator/features/inject_module_to_app.sh');
const generateProjectScriptPath = path.resolve('nestjs-generator/generate_project.sh');

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

test('normalizes resource names consistently across supported separators', () => {
    assert.deepEqual(describeResource('user'), {
        name: 'user', pascal: 'User', camel: 'user', plural: 'users', route: 'users', table: 'users',
    });
    assert.deepEqual(describeResource('User'), {
        name: 'user', pascal: 'User', camel: 'user', plural: 'users', route: 'users', table: 'users',
    });
    assert.deepEqual(describeResource('order-item'), {
        name: 'order-item', pascal: 'OrderItem', camel: 'orderItem', plural: 'order-items', route: 'order-items', table: 'order_items',
    });
    assert.deepEqual(describeResource('order_item'), {
        name: 'order-item', pascal: 'OrderItem', camel: 'orderItem', plural: 'order-items', route: 'order-items', table: 'order_items',
    });
    assert.deepEqual(describeResource('category', { plural: 'categories', route: 'catalog', table: 'catalog_entries' }), {
        name: 'category', pascal: 'Category', camel: 'category', plural: 'categories', route: 'catalog', table: 'catalog_entries',
    });
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

test('binds repository ports through explicit Nest injection tokens', () => {
    for (const orm of ['typeorm', 'prisma']) {
        const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), `nestgen-repository-di-${orm}-`));
        const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
        fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
        fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n");

        const result = spawnSync('bash', [addModuleScriptPath, 'order', orm], {
            cwd: fixturePath,
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);

        const moduleRoot = path.join(fixturePath, 'src', 'app', 'order');
        const port = fs.readFileSync(path.join(moduleRoot, 'core', 'domain', 'ports', 'order.repository.ts'), 'utf8');
        const handler = fs.readFileSync(path.join(moduleRoot, 'core', 'application', 'commands', 'create-order.handler.ts'), 'utf8');
        const generatedModule = fs.readFileSync(path.join(moduleRoot, 'order.module.ts'), 'utf8');
        const token = port.match(/export const (\w+RepositoryToken) = Symbol\('([^']+RepositoryPort)'\);/);
        const repositoryClass = generatedModule.match(/useClass: (\w+Repository),/);

        assert.ok(token, 'the generated port must export a runtime DI token');
        assert.ok(repositoryClass, 'the generated module must bind a repository implementation');
        assert.match(handler, new RegExp(`@Inject\\(${token[1]}\\) private readonly repo: ${token[2]}`));
        assert.match(generatedModule, new RegExp(`provide: ${token[1]},`));
        assert.match(generatedModule, new RegExp(`useClass: ${repositoryClass[1]},`));
        assert.doesNotMatch(generatedModule, new RegExp(`\\n    ${repositoryClass[1]},`));
    }
});

test('uses portable resource names for generated classes, routes and tables', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-resource-name-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(appModulePath, "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n");

    const result = spawnSync('bash', [addModuleScriptPath, 'order_item', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
        env: {
            ...process.env,
            RESOURCE_ROUTE: 'purchase-orders',
            RESOURCE_TABLE: 'purchase_orders',
        },
    });
    assert.equal(result.status, 0, result.stderr);

    const moduleRoot = path.join(fixturePath, 'src', 'app', 'order-item');
    const entity = fs.readFileSync(path.join(moduleRoot, 'core', 'domain', 'entities', 'order-item.entity.ts'), 'utf8');
    const controller = fs.readFileSync(path.join(moduleRoot, 'interfaces', 'controllers', 'order-item.controller.ts'), 'utf8');
    const ormEntity = fs.readFileSync(path.join(moduleRoot, 'infrastructure', 'persistences', 'repositories', 'order-item.orm.ts'), 'utf8');
    assert.match(entity, /export class OrderItem/);
    assert.match(controller, /@Controller\('purchase-orders'\)/);
    assert.match(ormEntity, /@Entity\('purchase_orders'\)/);
});

function writeExecutable(filePath, content) {
    fs.writeFileSync(filePath, content, { mode: 0o755 });
}

function createExternalCommandFixture() {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-external-command-'));
    const binPath = path.join(fixturePath, 'bin');
    fs.mkdirSync(binPath);
    writeExecutable(path.join(binPath, 'nest'), `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_NEST:-}" == "1" ]]; then exit 41; fi
mkdir -p src
cat > src/app.module.ts <<'EOF'
import { Module } from '@nestjs/common';
@Module({ imports: [] })
export class AppModule {}
EOF
`);
    writeExecutable(path.join(binPath, 'npm'), `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_NPM:-}" == "1" ]]; then exit 42; fi
`);
    writeExecutable(path.join(binPath, 'git'), `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_GIT:-}" == "1" ]]; then exit 43; fi
`);
    return { fixturePath, binPath };
}

function runProjectGeneration(fixturePath, binPath, extraEnvironment = {}) {
    return spawnSync('bash', [generateProjectScriptPath], {
        cwd: fixturePath,
        encoding: 'utf8',
        env: {
            ...process.env,
            APP_NAME: 'sample',
            PROJECT_PATH: fixturePath,
            PM: 'npm',
            ORM: 'typeorm',
            WITH_DOCKER: 'n',
            WITH_SWAGGER: 'n',
            WITH_GIT: 'n',
            MODULES: '',
            ...extraEnvironment,
            PATH: `${binPath}:${process.env.PATH}`,
        },
    });
}

test('stops project generation on external command failures without success output', () => {
    const nestFailure = createExternalCommandFixture();
    const failedNest = runProjectGeneration(nestFailure.fixturePath, nestFailure.binPath, { NESTGEN_TEST_FAIL_NEST: '1' });
    assert.equal(failedNest.status, 41);
    assert.match(failedNest.stdout, /Création du projet NestJS a échoué/);
    assert.doesNotMatch(failedNest.stdout, /généré avec succès/);

    const npmFailure = createExternalCommandFixture();
    const failedNpm = runProjectGeneration(npmFailure.fixturePath, npmFailure.binPath, { NESTGEN_TEST_FAIL_NPM: '1' });
    assert.equal(failedNpm.status, 42);
    assert.match(failedNpm.stdout, /Installation des packages communs a échoué/);
    assert.doesNotMatch(failedNpm.stdout, /généré avec succès/);

    const gitFailure = createExternalCommandFixture();
    const failedGit = runProjectGeneration(gitFailure.fixturePath, gitFailure.binPath, {
        WITH_GIT: 'y',
        NESTGEN_TEST_FAIL_GIT: '1',
    });
    assert.equal(failedGit.status, 43);
    assert.match(failedGit.stdout, /Initialisation Git a échoué/);
    assert.doesNotMatch(failedGit.stdout, /généré avec succès/);
});

test('completes a zero-module project generation after every external step succeeds', () => {
    const { fixturePath, binPath } = createExternalCommandFixture();
    const result = runProjectGeneration(fixturePath, binPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Projet NestJS "sample" généré avec succès/);
    assert.equal(fs.existsSync(path.join(fixturePath, 'sample', 'src', 'app.module.ts')), true);
});
