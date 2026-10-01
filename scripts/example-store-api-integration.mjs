import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = path.join(repositoryRoot, 'examples', 'store-api');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-store-api-example-'));
const projectRoot = path.join(temporaryRoot, 'store-api');
const cli = path.join(repositoryRoot, 'nestgen.js');

function run(command, args, cwd = projectRoot) {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result;
}

function runCli(...args) {
    const result = run(process.execPath, [cli, ...args, '--json']);
    try {
        return JSON.parse(result.stdout);
    } catch (error) {
        throw new Error(`La sortie JSON du CLI est invalide : ${error.message}\n${result.stdout}`);
    }
}

function writeFixture() {
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.cpSync(path.join(exampleRoot, 'definitions'), path.join(projectRoot, 'definitions'), { recursive: true });
    fs.writeFileSync(
        path.join(projectRoot, 'package.json'),
        `${JSON.stringify(
            {
                name: 'nestgen-store-api-example',
                private: true,
                type: 'module',
                dependencies: {
                    '@nestjs/common': '12.0.0',
                    '@nestjs/core': '12.0.0',
                    '@nestjs/cqrs': '12.0.0',
                    '@nestjs/typeorm': '12.0.0',
                    typeorm: '0.3.27',
                },
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(
        path.join(projectRoot, 'src', 'app.module.ts'),
        "import { Module } from '@nestjs/common';\n\n@Module({ imports: [] })\nexport class AppModule {}\n",
    );
}

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

try {
    const packageManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    const exampleManifest = JSON.parse(fs.readFileSync(path.join(exampleRoot, 'nestgen.example.json'), 'utf8'));
    assert.equal(exampleManifest.version, 1);
    assert.equal(exampleManifest.cliVersion, packageManifest.version, 'La version de l’exemple doit suivre le CLI.');
    assert.deepEqual(exampleManifest.resources, ['customers', 'products', 'orders', 'order-items']);

    writeFixture();
    const config = runCli('config', 'init', '--orm=typeorm', '--profile=advanced', '--package-manager=npm');
    assert.equal(config.ok, true);
    assert.equal(config.result.config.profile, 'advanced');

    for (const resource of exampleManifest.resources) {
        const output = runCli('resource', '--file', `definitions/${resource}.resource.json`);
        const expectedName = resource === 'order-items' ? 'order-item' : resource.slice(0, -1);
        assert.equal(output.ok, true);
        assert.equal(output.result.resource, expectedName);
        assert.equal(output.result.orm, 'typeorm');
        assert.equal(output.result.profile, 'advanced');
    }

    const customer = readJson('src/app/customer/resource.json');
    const product = readJson('src/app/product/resource.json');
    const order = readJson('src/app/order/resource.json');
    const orderItem = readJson('src/app/order-item/resource.json');
    assert.equal(
        customer.fields.some((field) => field.name === 'email' && field.unique),
        true,
    );
    assert.equal(
        product.fields.some((field) => field.name === 'sku' && field.unique),
        true,
    );
    assert.equal(
        product.fields.some((field) => field.name === 'stock' && field.defaultValue === 0),
        true,
    );
    assert.deepEqual(
        order.relations.map((relation) => relation.target),
        ['customer'],
    );
    assert.deepEqual(orderItem.relations.map((relation) => relation.target).sort(), ['order', 'product']);
    assert.equal(
        orderItem.indexes.some((index) => index.unique && index.fields.join('+') === 'orderId+productId'),
        true,
    );

    const orderItemEntity = fs.readFileSync(
        path.join(projectRoot, 'src/app/order-item/persistence/order-item.entity.ts'),
        'utf8',
    );
    assert.match(orderItemEntity, /@ManyToOne\(\(\) => Order/);
    assert.match(orderItemEntity, /@ManyToOne\(\(\) => Product/);

    const customerUpdate = readJson('definitions/customers.resource.json');
    customerUpdate.fields.push('phone:string{length=32}?');
    fs.writeFileSync(
        path.join(projectRoot, 'definitions', 'customers-v2.resource.json'),
        `${JSON.stringify(customerUpdate, null, 2)}\n`,
    );
    const migration = runCli(
        'resource',
        '--file',
        'definitions/customers-v2.resource.json',
        '--update',
        '--migration-name',
        'add-customer-phone',
        '--dry-run',
    );
    assert.equal(migration.ok, true);
    assert.match(migration.result.migration.command, /typeorm-ts-node-commonjs migration:generate/);
    assert.match(migration.result.migration.command, /add-customer-phone/);
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
