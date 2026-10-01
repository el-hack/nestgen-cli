import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const foundationScript = path.resolve('nestjs-generator/features/operational_foundation.mjs');
const bootstrapScript = path.resolve('nestjs-generator/features/configure_bootstrap.mjs');

function run(script, args, directory) {
    return spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: 'utf8' });
}

for (const orm of ['typeorm', 'prisma']) {
    test(`generates an optional operational foundation for ${orm}`, (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `nestgen-operations-${orm}-`));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'src', 'app.module.ts'),
            "import { Module } from '@nestjs/common';\n@Module({ imports: [] })\nexport class AppModule {}\n",
        );

        const result = run(foundationScript, ['src', orm], root);
        assert.equal(result.status, 0, result.stderr);

        const operations = path.join(root, 'src', 'operations');
        const health = fs.readFileSync(path.join(operations, 'health.controller.ts'), 'utf8');
        const logger = fs.readFileSync(path.join(operations, 'structured-logger.service.ts'), 'utf8');
        const middleware = fs.readFileSync(path.join(operations, 'request-id.middleware.ts'), 'utf8');
        const module = fs.readFileSync(path.join(operations, 'operations.module.ts'), 'utf8');
        const guide = fs.readFileSync(path.join(operations, 'README.md'), 'utf8');
        const database = fs.readFileSync(path.join(operations, 'database-health.service.ts'), 'utf8');

        assert.match(health, /@Get\('live'\)/);
        assert.match(health, /@Get\('ready'\)/);
        assert.match(health, /ServiceUnavailableException/);
        assert.match(middleware, /x-request-id/);
        assert.match(middleware, /randomUUID/);
        assert.match(logger, /SENSITIVE_KEY/);
        assert.match(logger, /\[REDACTED\]/);
        assert.match(logger, /requestId/);
        assert.match(module, /RequestIdMiddleware/);
        assert.match(guide, /SIGTERM/);
        assert.match(guide, /\/health\/live/);
        if (orm === 'typeorm') assert.match(database, /InjectDataSource/);
        else {
            assert.match(database, /\$queryRawUnsafe\('SELECT 1'\)/);
            assert.match(module, /PrismaModule/);
        }

        const duplicate = run(foundationScript, ['src', orm], root);
        assert.notEqual(duplicate.status, 0);
        assert.match(duplicate.stderr, /existe déjà/);
    });
}

test('configures graceful shutdown and structured Nest logging only when operations are enabled', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-operations-bootstrap-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const main = path.join(root, 'main.ts');
    fs.writeFileSync(main, 'export {};\n');

    const result = run(bootstrapScript, [main, 'n', 'y'], root);
    assert.equal(result.status, 0, result.stderr);
    const source = fs.readFileSync(main, 'utf8');
    assert.match(source, /StructuredLogger/);
    assert.match(source, /bufferLogs: true/);
    assert.match(source, /app\.useLogger/);
    assert.match(source, /app\.enableShutdownHooks\(\)/);
});
