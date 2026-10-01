import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nestgen-docker-e2e-'));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerScript = path.join(repositoryRoot, 'nestjs-generator', 'features', 'docker.sh');
const tag = `nestgen-docker-e2e-${process.pid}-${Date.now()}`;

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result;
}

try {
    fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
            name: 'nestgen-docker-integration',
            private: true,
            scripts: { build: 'mkdir -p dist && printf "console.log(\'ready\')\\n" > dist/main.js' },
        }),
    );
    run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']);
    run('bash', [dockerScript, 'docker-integration', 'npm']);

    const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
    const compose = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
    assert.match(dockerfile, /FROM dependencies AS development/);
    assert.match(dockerfile, /FROM node:24-alpine AS production/);
    assert.match(dockerfile, /USER node/);
    assert.match(compose, /condition: service_healthy/);

    run('docker', ['compose', '-f', 'compose.yaml', 'config']);
    run('docker', ['build', '--target', 'development', '--tag', `${tag}-development`, '.']);
    run('docker', ['build', '--target', 'production', '--tag', `${tag}-production`, '.']);

    for (const packageManager of [
        {
            name: 'pnpm',
            lockfile: 'pnpm-lock.yaml',
            install: 'RUN pnpm install --frozen-lockfile',
            productionInstall: 'RUN pnpm install --prod --frozen-lockfile',
        },
        {
            name: 'yarn',
            lockfile: 'yarn.lock',
            install: 'RUN yarn install --frozen-lockfile',
            productionInstall: 'RUN yarn install --production=true --frozen-lockfile',
        },
    ]) {
        fs.rmSync(path.join(root, 'Dockerfile'));
        fs.rmSync(path.join(root, 'compose.yaml'));
        fs.rmSync(path.join(root, '.dockerignore'));
        fs.writeFileSync(path.join(root, packageManager.lockfile), 'lockfile fixture\n');
        run('bash', [dockerScript, 'docker-integration', packageManager.name]);

        const packageManagerDockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
        assert.match(packageManagerDockerfile, new RegExp(`COPY package\\.json ${packageManager.lockfile} ./`));
        assert.match(packageManagerDockerfile, new RegExp(packageManager.install));
        assert.match(packageManagerDockerfile, new RegExp(packageManager.productionInstall));
    }
} finally {
    spawnSync('docker', ['image', 'rm', '--force', `${tag}-development`, `${tag}-production`], { encoding: 'utf8' });
    fs.rmSync(root, { recursive: true, force: true });
}
