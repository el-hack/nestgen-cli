import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const packageManager = process.argv[2];
const configurations = {
    npm: {
        packageManager: 'npm@11.0.0',
        lockfile: 'package-lock.json',
        prepare: ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
        install: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    },
    pnpm: {
        packageManager: 'pnpm@10.0.0',
        lockfile: 'pnpm-lock.yaml',
        prepare: ['install', '--lockfile-only', '--ignore-scripts'],
        install: ['install', '--frozen-lockfile', '--ignore-scripts'],
    },
    yarn: {
        packageManager: 'yarn@4.5.0',
        lockfile: 'yarn.lock',
        prepare: ['install', '--mode=update-lockfile'],
        install: ['install', '--immutable', '--mode=skip-build'],
    },
};

const configuration = configurations[packageManager];
if (!configuration) {
    throw new Error(`Unsupported package manager: ${packageManager ?? '(missing)'}`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), `nestgen-${packageManager}-lockfile-`));

function run(command, args) {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        env: {
            ...process.env,
            YARN_CACHE_FOLDER: path.join(root, '.yarn-cache'),
            YARN_GLOBAL_FOLDER: path.join(root, '.yarn-global'),
        },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    }
}

try {
    fs.mkdirSync(path.join(root, 'fixture'));
    fs.writeFileSync(
        path.join(root, 'package.json'),
        `${JSON.stringify(
            {
                name: `nestgen-${packageManager}-lockfile-integration`,
                private: true,
                packageManager: configuration.packageManager,
                dependencies: { fixture: 'file:./fixture' },
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(
        path.join(root, 'fixture', 'package.json'),
        `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`,
    );
    if (packageManager === 'yarn') {
        fs.writeFileSync(path.join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n');
    }

    run(packageManager, configuration.prepare);
    assert.equal(fs.existsSync(path.join(root, configuration.lockfile)), true, `${configuration.lockfile} is required`);

    run(packageManager, configuration.install);
    assert.equal(fs.existsSync(path.join(root, 'node_modules', 'fixture', 'package.json')), true);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
