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
