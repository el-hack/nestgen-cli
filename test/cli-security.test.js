import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    parseModuleArgs,
    parseCliArgs,
    createModulePlan,
    resolveProjectPath,
    validateModuleName,
    validateOrm,
} from '../nestgen.js';
import { describeResource } from '../nestjs-generator/features/resource_name.mjs';
import { inspectProject } from '../nestjs-generator/features/preflight.mjs';
import { generateModule } from '../dist/engine/module-generator.js';
import { parseResourceFields, prismaType, typescriptType } from '../dist/engine/resource-spec.js';
import { generateResource } from '../dist/engine/resource-generator.js';

const cliPath = path.resolve('nestgen.js');
const addModuleScriptPath = path.resolve('nestjs-generator/features/add_module.sh');
const dockerScriptPath = path.resolve('nestjs-generator/features/docker.sh');
const typeormScriptPath = path.resolve('nestjs-generator/features/typeorm.sh');
const configureBootstrapPath = path.resolve('nestjs-generator/features/configure_bootstrap.mjs');
const injectModuleScriptPath = path.resolve('nestjs-generator/features/inject_module_to_app.sh');
const generateProjectScriptPath = path.resolve('nestjs-generator/generate_project.sh');
const packageManagerHelpersPath = path.resolve('nestjs-generator/features/utils.sh');
const packageVersion = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version;

function writeNestManifest(fixturePath) {
    fs.writeFileSync(
        path.join(fixturePath, 'package.json'),
        JSON.stringify({
            dependencies: {
                '@nestjs/common': '12.0.0',
                '@nestjs/core': '12.0.0',
                '@nestjs/cqrs': '12.0.0',
                '@nestjs/typeorm': '12.0.0',
                typeorm: '0.3.0',
                '@prisma/client': '6.0.0',
            },
        }),
    );
}

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

function assertOrmOutput(root, orm) {
    const forbidden = orm === 'typeorm' ? /prisma/i : /typeorm/i;
    const files = fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    assert.ok(files.length > 0);
    for (const entry of files) {
        const file = path.join(entry.parentPath, entry.name);
        assert.doesNotMatch(path.relative(root, file), forbidden);
        assert.doesNotMatch(fs.readFileSync(file, 'utf8'), forbidden, `Unexpected ORM reference in ${file}`);
    }
}

test('parses a reusable resource field contract', () => {
    const fields = parseResourceFields(['sku:string!', 'price:number', 'available:boolean', 'expiresAt:date?']);
    assert.deepEqual(
        fields.map((field) => field.name),
        ['sku', 'price', 'available', 'expiresAt'],
    );
    assert.equal(typescriptType(fields[1]), 'number');
    assert.equal(prismaType(fields[0]), 'String @unique');
    assert.equal(prismaType(fields[3]), 'DateTime?');
    assert.throws(() => parseResourceFields(['id:uuid']));
    assert.throws(() => parseResourceFields(['price:number', 'price:string']));
});

test('generates a product resource from its business fields', async () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-resource-'));
    writeNestManifest(fixturePath);
    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    const fields = parseResourceFields(['sku:string!', 'price:number', 'published:boolean', 'releasedAt:date?']);
    await generateResource(fixturePath, {
        name: 'product',
        route: 'catalog/products',
        table: 'catalog_products',
        fields,
    });
    const root = path.join(fixturePath, 'src', 'app', 'product');
    assert.match(fs.readFileSync(path.join(root, 'domain', 'product.ts'), 'utf8'), /price!?: number/);
    assertOrmOutput(root, 'typeorm');
    assert.match(fs.readFileSync(path.join(root, 'persistence', 'product.entity.ts'), 'utf8'), /catalog_products/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'resource.json'), 'utf8')).orm, 'typeorm');
    assert.match(fs.readFileSync(path.join(root, 'resource.json'), 'utf8'), /catalog\/products/);
    assert.match(fs.readFileSync(path.join(root, 'product.module.ts'), 'utf8'), /TypeOrmModule\.forFeature/);
    assert.match(fs.readFileSync(path.join(fixturePath, 'src', 'app.module.ts'), 'utf8'), /ProductModule/);
});

test('parses scriptable CLI options and returns errors for invalid usage', () => {
    assert.deepEqual(parseCliArgs(['module', 'order', '--orm', 'prisma', '--no-interactive', '--quiet']), {
        command: 'module',
        positionals: ['order'],
        options: {
            orm: 'prisma',
            profile: undefined,
            packageManager: undefined,
            noInteractive: true,
            quiet: true,
            verbose: false,
            color: true,
            help: false,
            version: false,
            dryRun: false,
        },
    });
    assert.equal(parseModuleArgs(['module', 'order', '--orm=prisma']).orm, 'prisma');
    assert.throws(() => parseCliArgs(['module', 'order', '--orm']), /requiert une valeur/);
    assert.throws(() => parseCliArgs(['module', 'order', '--unknown']), /Option inconnue/);
});

test('applies the advanced resource profile and versioned project configuration', async () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-profile-'));
    writeNestManifest(fixturePath);
    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    const init = spawnSync(process.execPath, [cliPath, 'config', 'init', '--profile=advanced'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(init.status, 0, init.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(fixturePath, 'nestgen.config.json'), 'utf8'));
    assert.equal(config.profile, 'advanced');
    await generateResource(fixturePath, {
        name: 'order',
        route: 'orders',
        table: 'orders',
        fields: parseResourceFields(['reference:string!']),
        profile: config.profile,
    });
    const root = path.join(fixturePath, 'src', 'app', 'order');
    assertOrmOutput(root, 'typeorm');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'resource.json'), 'utf8')).orm, 'typeorm');
    assert.equal(fs.existsSync(path.join(root, 'domain', 'order.repository.port.ts')), false);
    assert.match(fs.readFileSync(path.join(root, 'order.controller.ts'), 'utf8'), /OrderService/);
    assert.match(fs.readFileSync(path.join(root, 'order.module.ts'), 'utf8'), /OrderRepositoryToken/);
    const port = fs.readFileSync(path.join(root, 'application', 'ports', 'order.repository.port.ts'), 'utf8');
    const contract = fs.readFileSync(path.join(root, 'application', 'order.contract.ts'), 'utf8');
    const service = fs.readFileSync(path.join(root, 'application', 'order.service.ts'), 'utf8');
    const repository = fs.readFileSync(path.join(root, 'persistence', 'order.repository.ts'), 'utf8');
    const controller = fs.readFileSync(path.join(root, 'order.controller.ts'), 'utf8');
    assert.doesNotMatch(port, /dto|typeorm|@nestjs/i);
    assert.doesNotMatch(contract, /dto|typeorm|@nestjs/i);
    assert.doesNotMatch(service, /dto|typeorm|@nestjs/i);
    assert.match(contract, /CreateOrderInput/);
    assert.match(contract, /OrderOutput/);
    assert.match(repository, /OrderNotFoundError/);
    assert.match(repository, /OrderConflictError/);
    assert.match(controller, /NotFoundException/);
    assert.match(controller, /ConflictException/);
});

test('creates a deterministic module dry-run plan', () => {
    const first = createModulePlan('/project', 'order-item', 'typeorm');
    const second = createModulePlan('/project', 'order-item', 'typeorm');
    assert.deepEqual(first, second);
    assert.equal(first.files.includes('src/app/order-item/order-item.module.ts'), true);
    assert.match(first.mutations.join('\n'), /TypeORM racine/);
});

test('exposes stable help, version and error exit codes', () => {
    const help = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: nestgen/);

    const version = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), packageVersion);

    const unknown = spawnSync(process.execPath, [cliPath, 'unknown'], { encoding: 'utf8' });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Commande inconnue/);

    const nonInteractive = spawnSync(process.execPath, [cliPath, 'module', '--no-interactive'], { encoding: 'utf8' });
    assert.equal(nonInteractive.status, 1);
    assert.match(nonInteractive.stderr, /requiert un nom de module/);
});

test('normalizes resource names consistently across supported separators', () => {
    assert.deepEqual(describeResource('user'), {
        name: 'user',
        pascal: 'User',
        camel: 'user',
        plural: 'users',
        route: 'users',
        table: 'users',
    });
    assert.deepEqual(describeResource('User'), {
        name: 'user',
        pascal: 'User',
        camel: 'user',
        plural: 'users',
        route: 'users',
        table: 'users',
    });
    assert.deepEqual(describeResource('order-item'), {
        name: 'order-item',
        pascal: 'OrderItem',
        camel: 'orderItem',
        plural: 'order-items',
        route: 'order-items',
        table: 'order_items',
    });
    assert.deepEqual(describeResource('order_item'), {
        name: 'order-item',
        pascal: 'OrderItem',
        camel: 'orderItem',
        plural: 'order-items',
        route: 'order-items',
        table: 'order_items',
    });
    assert.deepEqual(
        describeResource('category', { plural: 'categories', route: 'catalog', table: 'catalog_entries' }),
        {
            name: 'category',
            pascal: 'Category',
            camel: 'category',
            plural: 'categories',
            route: 'catalog',
            table: 'catalog_entries',
        },
    );
});

test('reports unsupported Nest project structures before generation', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-preflight-'));
    assert.throws(() => inspectProject(fixturePath, 'typeorm'), /package\.json introuvable/);

    writeNestManifest(fixturePath);
    assert.throws(() => inspectProject(fixturePath, 'typeorm'), /src\/app\.module\.ts introuvable/);

    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] }) export class AppModule {}\n",
    );
    fs.writeFileSync(path.join(fixturePath, 'nest-cli.json'), JSON.stringify({ monorepo: true }));
    assert.throws(() => inspectProject(fixturePath, 'typeorm'), /workspaces Nest/);
});

test('does not create a module directory when preflight fails', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-preflight-no-write-'));
    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] }) export class AppModule {}\n",
    );

    const result = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(fs.existsSync(path.join(fixturePath, 'src', 'app', 'invoice')), false);
});

test('generates a module through the TypeScript engine and structurally registers it', async () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-typescript-engine-'));
    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    writeNestManifest(fixturePath);
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );

    await generateModule(fixturePath, 'invoice-item', 'typeorm');
    assertOrmOutput(path.join(fixturePath, 'src'), 'typeorm');

    assert.equal(fs.existsSync(path.join(fixturePath, 'src', 'app', 'invoice-item', 'invoice-item.module.ts')), true);
    assert.match(fs.readFileSync(path.join(fixturePath, 'src', 'app.module.ts'), 'utf8'), /InvoiceItemModule/);
    assert.equal(fs.existsSync(path.join(fixturePath, '.nestgen-transaction.json')), false);
});

test('generates a Prisma model and uses the generated Prisma runtime without aliases', async () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-prisma-engine-'));
    fs.mkdirSync(path.join(fixturePath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(fixturePath, 'prisma'), { recursive: true });
    writeNestManifest(fixturePath);
    fs.writeFileSync(
        path.join(fixturePath, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    fs.writeFileSync(
        path.join(fixturePath, 'prisma', 'schema.prisma'),
        'generator client { provider = "prisma-client-js" }\n\ndatasource db { provider = "postgresql" url = env("DATABASE_URL") }\n',
    );

    await generateModule(fixturePath, 'invoice', 'prisma');
    assertOrmOutput(path.join(fixturePath, 'src'), 'prisma');

    const schema = fs.readFileSync(path.join(fixturePath, 'prisma', 'schema.prisma'), 'utf8');
    const repository = fs.readFileSync(
        path.join(
            fixturePath,
            'src',
            'app',
            'invoice',
            'infrastructure',
            'persistences',
            'repositories',
            'invoice.prisma.repository.ts',
        ),
        'utf8',
    );
    assert.match(schema, /model Invoice/);
    assert.match(schema, /@@map\("invoices"\)/);
    assert.match(repository, /\.\.\/\.\.\/\.\.\/\.\.\/prisma\/prisma\.service/);
    assert.doesNotMatch(repository, /@\/prisma/);
});

test('maps package manager operations without a global Nest CLI', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-package-manager-'));
    const binPath = path.join(fixturePath, 'bin');
    const commandLog = path.join(fixturePath, 'commands.log');
    fs.mkdirSync(binPath);

    for (const command of ['npm', 'pnpm', 'yarn', 'npx']) {
        writeExecutable(
            path.join(binPath, command),
            `#!/usr/bin/env bash
printf '%s\\n' "$(basename \"$0\") $*" >> "$COMMAND_LOG"
`,
        );
    }

    for (const packageManager of ['npm', 'pnpm', 'yarn']) {
        const result = spawnSync(
            'bash',
            [
                '-c',
                'source "$1"; pm_add "$2" example@1; nest_new "$2" .',
                'bash',
                packageManagerHelpersPath,
                packageManager,
            ],
            {
                cwd: fixturePath,
                encoding: 'utf8',
                env: { ...process.env, PATH: `${binPath}:${process.env.PATH}`, COMMAND_LOG: commandLog },
            },
        );
        assert.equal(result.status, 0, result.stderr);
    }

    const commands = fs.readFileSync(commandLog, 'utf8');
    assert.match(commands, /npm install example@1/);
    assert.match(commands, /npx --yes @nestjs\/cli@12\.0\.0 new \. --package-manager npm --skip-git/);
    assert.match(commands, /pnpm add example@1/);
    assert.match(commands, /pnpm dlx @nestjs\/cli@12\.0\.0 new \. --package-manager pnpm --skip-git/);
    assert.match(commands, /yarn add example@1/);
    assert.match(commands, /yarn dlx @nestjs\/cli@12\.0\.0 new \. --package-manager yarn --skip-git/);
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
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    writeNestManifest(fixturePath);

    const firstGeneration = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(firstGeneration.status, 0, firstGeneration.stderr);

    const entityPath = path.join(
        fixturePath,
        'src',
        'app',
        'invoice',
        'core',
        'domain',
        'entities',
        'invoice.entity.ts',
    );
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
    assert.match(fs.readFileSync(path.join(fixturePath, 'Dockerfile'), 'utf8'), /FROM node:24-alpine AS production/);
    assert.match(fs.readFileSync(path.join(fixturePath, 'Dockerfile'), 'utf8'), /npm ci --omit=dev/);
    assert.match(fs.readFileSync(path.join(fixturePath, 'compose.yaml'), 'utf8'), /condition: service_healthy/);
    assert.equal(fs.existsSync(path.join(fixturePath, '.dockerignore')), true);
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
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [],\n})\nexport class AppModule {}\n",
    );
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
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n\n@Module({\n  imports: [\n    ExistingModule,\n  ],\n})\nexport class AppModule {}\n",
    );
    writeGeneratedModule(fixturePath, 'invoice', 'InvoiceModule');

    const supported = spawnSync('bash', [injectModuleScriptPath, 'invoice', 'prisma'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(supported.status, 0, supported.stderr);
    assert.match(
        decoratorImports(fs.readFileSync(appModulePath, 'utf8')),
        /ExistingModule,[\s\S]*CqrsModule,[\s\S]*InvoiceModule/,
    );

    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n@Module({ controllers: [] })\nexport class AppModule {}\n",
    );
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
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
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
    assert.match(appModule, /TypeOrmModule\.forRootAsync\(\{ useFactory: typeOrmOptions \}\)/);
    assert.doesNotMatch(appModule, /synchronize:\s*true/);
    assert.equal((decoratorImports(appModule).match(/\bCustomerModule\b/g) ?? []).length, 1);
});

test('generates TypeORM environment configuration and explicit migrations', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-typeorm-config-'));
    const binPath = path.join(fixturePath, 'bin');
    fs.mkdirSync(binPath);
    writeExecutable(path.join(binPath, 'npm'), '#!/usr/bin/env bash\nexit 0\n');

    const result = spawnSync('bash', [typeormScriptPath, 'npm', 'sample'], {
        cwd: fixturePath,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binPath}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    const config = fs.readFileSync(path.join(fixturePath, 'src', 'database', 'typeorm.config.ts'), 'utf8');
    const dataSource = fs.readFileSync(path.join(fixturePath, 'src', 'database', 'data-source.ts'), 'utf8');
    assert.match(config, /synchronize: false/);
    assert.match(config, /migrationsRun: false/);
    assert.match(dataSource, /new DataSource/);
    assert.match(dataSource, /src\/\*\*\/\*\.entity/);
    assert.equal(
        fs.existsSync(path.join(fixturePath, 'src', 'database', 'migrations', '0000000000000-InitialSchema.ts')),
        true,
    );
    assert.match(fs.readFileSync(path.join(fixturePath, '.env.example'), 'utf8'), /DATABASE_PASSWORD=change-me/);
});

test('generates a secure validation bootstrap and optional Swagger endpoint', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-bootstrap-'));
    const mainPath = path.join(fixturePath, 'main.ts');
    fs.writeFileSync(mainPath, 'placeholder\n');

    for (const enabled of ['n', 'y']) {
        const result = spawnSync(process.execPath, [configureBootstrapPath, mainPath, enabled], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const main = fs.readFileSync(mainPath, 'utf8');
        assert.match(main, /whitelist: true/);
        assert.match(main, /forbidNonWhitelisted: true/);
        assert.match(main, /transform: true/);
        if (enabled === 'y') assert.match(main, /SwaggerModule\.setup\('api'/);
        else assert.doesNotMatch(main, /SwaggerModule/);
    }
});

test('preserves an existing TypeORM root connection during module generation', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-existing-typeorm-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\nimport { TypeOrmModule } from '@nestjs/typeorm';\n@Module({ imports: [TypeOrmModule.forRoot({ database: 'existing' })] })\nexport class AppModule {}\n",
    );
    writeNestManifest(fixturePath);

    const result = spawnSync('bash', [addModuleScriptPath, 'invoice', 'typeorm'], {
        cwd: fixturePath,
        encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const appModule = fs.readFileSync(appModulePath, 'utf8');
    assert.equal((appModule.match(/TypeOrmModule\.forRoot/g) ?? []).length, 1);
    assert.match(appModule, /database: 'existing'/);
});

test('binds repository ports through explicit Nest injection tokens', () => {
    for (const orm of ['typeorm', 'prisma']) {
        const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), `nestgen-repository-di-${orm}-`));
        const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
        fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
        fs.writeFileSync(
            appModulePath,
            "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
        );
        writeNestManifest(fixturePath);

        if (orm === 'prisma') {
            fs.mkdirSync(path.join(fixturePath, 'prisma'));
            fs.writeFileSync(path.join(fixturePath, 'prisma/schema.prisma'), '// existing schema\n');
        }

        const result = spawnSync('bash', [addModuleScriptPath, 'order', orm], {
            cwd: fixturePath,
            encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);

        const moduleRoot = path.join(fixturePath, 'src', 'app', 'order');
        const port = fs.readFileSync(path.join(moduleRoot, 'core', 'domain', 'ports', 'order.repository.ts'), 'utf8');
        const handler = fs.readFileSync(
            path.join(moduleRoot, 'core', 'application', 'commands', 'create-order.handler.ts'),
            'utf8',
        );
        const generatedModule = fs.readFileSync(path.join(moduleRoot, 'order.module.ts'), 'utf8');
        const token = port.match(/export const (\w+RepositoryToken) = Symbol\('([^']+RepositoryPort)'\);/);
        const repositoryClass = generatedModule.match(/useClass: (\w+Repository),/);

        assert.ok(token, 'the generated port must export a runtime DI token');
        assert.ok(repositoryClass, 'the generated module must bind a repository implementation');
        assert.match(handler, new RegExp(`@Inject\\(${token[1]}\\) private readonly repo: ${token[2]}`));
        assert.match(generatedModule, new RegExp(`provide: ${token[1]},`));
        assert.match(generatedModule, new RegExp(`useClass: ${repositoryClass[1]},`));
        assert.doesNotMatch(generatedModule, new RegExp(`\\n    ${repositoryClass[1]},`));
        if (orm === 'typeorm') {
            const handler = fs.readFileSync(
                path.join(moduleRoot, 'core', 'application', 'commands', 'create-order.handler.ts'),
                'utf8',
            );
            const repository = fs.readFileSync(
                path.join(moduleRoot, 'infrastructure', 'persistences', 'repositories', 'order.typeorm.repository.ts'),
                'utf8',
            );
            assert.match(handler, /new Order\(undefined, command\.name, command\.email\)/);
            assert.match(repository, /this\.repo\.create\(\{\n      name: order\.name,/);
        }
    }
});

test('uses portable resource names for generated classes, routes and tables', () => {
    const fixturePath = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-resource-name-'));
    const appModulePath = path.join(fixturePath, 'src', 'app.module.ts');
    fs.mkdirSync(path.dirname(appModulePath), { recursive: true });
    fs.writeFileSync(
        appModulePath,
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
    writeNestManifest(fixturePath);

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
    const controller = fs.readFileSync(
        path.join(moduleRoot, 'interfaces', 'controllers', 'order-item.controller.ts'),
        'utf8',
    );
    const ormEntity = fs.readFileSync(
        path.join(moduleRoot, 'infrastructure', 'persistences', 'repositories', 'order-item.orm.ts'),
        'utf8',
    );
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
    writeExecutable(
        path.join(binPath, 'npx'),
        `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_NEST:-}" == "1" ]]; then exit 41; fi
mkdir -p src
cat > src/app.module.ts <<'EOF'
import { Module } from '@nestjs/common';
@Module({ imports: [] })
export class AppModule {}
EOF
cat > src/main.ts <<'EOF'
export {};
EOF
`,
    );
    writeExecutable(
        path.join(binPath, 'npm'),
        `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_NPM:-}" == "1" ]]; then exit 42; fi
`,
    );
    writeExecutable(
        path.join(binPath, 'git'),
        `#!/usr/bin/env bash
if [[ "\${NESTGEN_TEST_FAIL_GIT:-}" == "1" ]]; then exit 43; fi
`,
    );
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
    const failedNest = runProjectGeneration(nestFailure.fixturePath, nestFailure.binPath, {
        NESTGEN_TEST_FAIL_NEST: '1',
    });
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
