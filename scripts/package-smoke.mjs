import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-package-'));
const packageDirectory = path.join(temporaryRoot, 'package');
const consumerDirectory = path.join(temporaryRoot, 'consumer');
const fixtureDirectory = path.join(consumerDirectory, 'fixture');
const npmCacheDirectory = path.join(temporaryRoot, 'npm-cache');

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? repositoryRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            npm_config_cache: npmCacheDirectory,
            npm_config_update_notifier: 'false',
            ...options.env,
        },
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(
            `${command} ${args.join(' ')} a échoué (code ${result.status}).\n${result.stdout}\n${result.stderr}`,
        );
    }

    return result;
}

function writeConsumerProject() {
    fs.mkdirSync(path.join(fixtureDirectory, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(consumerDirectory, 'package.json'),
        `${JSON.stringify(
            {
                name: 'nestgen-distribution-consumer',
                private: true,
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(
        path.join(fixtureDirectory, 'package.json'),
        `${JSON.stringify(
            {
                name: 'nestgen-dry-run-fixture',
                private: true,
                dependencies: {
                    '@nestjs/common': '12.0.0',
                    '@nestjs/core': '12.0.0',
                    '@nestjs/cqrs': '12.0.0',
                    '@nestjs/typeorm': '12.0.0',
                    typeorm: '0.3.0',
                },
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(
        path.join(fixtureDirectory, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
}

function assertTarballContents(packResult) {
    const [tarball] = JSON.parse(packResult.stdout);
    const files = tarball.files.map(({ path: filePath }) => filePath).sort();
    const allowedPaths = /^(package\.json|LICENSE|readme\.md|nestgen\.js|dist\/|examples\/|nestjs-generator\/)/;
    const requiredPaths = [
        'package.json',
        'nestgen.js',
        'dist/engine/module-generator.js',
        'nestjs-generator/generate_project.sh',
        'nestjs-generator/features/add_module.sh',
        'nestjs-generator/features/preflight.mjs',
        'nestjs-generator/features/update_app_module.mjs',
        'nestjs-generator/features/operations.sh',
        'nestjs-generator/features/operational_foundation.mjs',
        'examples/store-api/README.md',
        'examples/store-api/nestgen.example.json',
        'examples/store-api/definitions/customers.resource.json',
        'examples/store-api/definitions/products.resource.json',
        'examples/store-api/definitions/orders.resource.json',
        'examples/store-api/definitions/order-items.resource.json',
    ];

    for (const filePath of files) {
        assert.match(filePath, allowedPaths, `Fichier non publiable présent dans le tarball : ${filePath}`);
        assert.doesNotMatch(
            filePath,
            /(^|\/)(node_modules|test|\.git)(\/|$)|\.DS_Store$/,
            `Fichier interdit : ${filePath}`,
        );
    }
    for (const requiredPath of requiredPaths) {
        assert.ok(files.includes(requiredPath), `Fichier nécessaire absent du tarball : ${requiredPath}`);
    }

    return path.join(packageDirectory, tarball.filename);
}

try {
    run('npm', ['run', 'prepack']);
    fs.mkdirSync(packageDirectory);
    const packResult = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packageDirectory]);
    const tarballPath = assertTarballContents(packResult);

    writeConsumerProject();
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath], { cwd: consumerDirectory });

    const binaryPath = path.join(consumerDirectory, 'node_modules', '.bin', 'nestgen');
    const installedPackage = JSON.parse(
        fs.readFileSync(path.join(consumerDirectory, 'node_modules', 'nestgen-cli', 'package.json'), 'utf8'),
    );
    const sourcePackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    assert.equal(installedPackage.version, sourcePackage.version);
    const version = run(process.execPath, [binaryPath, '--version'], { cwd: consumerDirectory });
    assert.equal(version.stdout.trim(), sourcePackage.version);
    const help = run(process.execPath, [binaryPath, '--help'], { cwd: consumerDirectory });
    assert.match(help.stdout, /Usage: nestgen/);

    const dryRun = run(
        process.execPath,
        [binaryPath, 'module', 'invoice', '--orm=typeorm', '--dry-run', '--no-interactive', '--quiet'],
        { cwd: fixtureDirectory },
    );
    const dryRunPlan = JSON.parse(dryRun.stdout);
    assert.equal(dryRunPlan.version, 1);
    assert.equal(dryRunPlan.operation, 'module');
    assert.equal(dryRunPlan.conflicts.length, 0);
    assert.equal(
        dryRunPlan.changes.some(
            (change) => change.path === 'src/app/invoice/invoice.module.ts' && change.status === 'create',
        ),
        true,
    );
    assert.equal(fs.existsSync(path.join(fixtureDirectory, 'src', 'app', 'invoice')), false);

    run(
        process.execPath,
        [
            binaryPath,
            'resource',
            'product',
            '--orm=typeorm',
            '--fields=sku:string!,price:number,published:boolean',
            '--route=catalog/products',
            '--table=catalog_products',
            '--no-interactive',
            '--quiet',
        ],
        { cwd: fixtureDirectory },
    );
    const resourceRoot = path.join(fixtureDirectory, 'src', 'app', 'product');
    assert.ok(fs.existsSync(path.join(resourceRoot, 'persistence', 'product.repository.ts')));
    assert.ok(fs.existsSync(path.join(resourceRoot, 'persistence', 'product.repository.spec.ts')));
    assert.ok(fs.existsSync(path.join(fixtureDirectory, 'test', 'product.e2e-spec.ts')));
    assert.ok(fs.existsSync(path.join(fixtureDirectory, 'test', 'compose.e2e.yaml')));
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
