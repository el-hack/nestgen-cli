import fs from 'node:fs';
import path from 'node:path';

function error(message) {
    throw new Error(`Préflight échoué : ${message}`);
}

export function inspectProject(projectRoot, orm) {
    const packagePath = path.join(projectRoot, 'package.json');
    const appModulePath = path.join(projectRoot, 'src', 'app.module.ts');
    const nestCliPath = path.join(projectRoot, 'nest-cli.json');

    if (!fs.existsSync(packagePath))
        error('package.json introuvable. Exécute la commande à la racine d’un projet NestJS.');
    if (!fs.existsSync(appModulePath))
        error(
            'src/app.module.ts introuvable. Les workspaces et structures personnalisées ne sont pas encore supportés.',
        );

    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const nestCli = fs.existsSync(nestCliPath) ? JSON.parse(fs.readFileSync(nestCliPath, 'utf8')) : null;
    if (nestCli?.monorepo) error('les workspaces Nest ne sont pas encore supportés. Cible une application autonome.');

    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    const missing = ['@nestjs/common', '@nestjs/core', '@nestjs/cqrs'];
    if (orm === 'typeorm') missing.push('@nestjs/typeorm', 'typeorm');
    if (orm === 'prisma') missing.push('@prisma/client');
    const unavailable = missing.filter((dependency) => !dependencies[dependency]);
    if (unavailable.length) error(`dépendances manquantes : ${unavailable.join(', ')}.`);

    const appModule = fs.readFileSync(appModulePath, 'utf8');
    if (!/@Module\s*\(/.test(appModule)) error('le décorateur @Module est introuvable dans src/app.module.ts.');

    return {
        appModulePath,
        packageManager: fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))
            ? 'pnpm'
            : fs.existsSync(path.join(projectRoot, 'yarn.lock'))
              ? 'yarn'
              : fs.existsSync(path.join(projectRoot, 'package-lock.json'))
                ? 'npm'
                : null,
        hasRootTypeOrmConnection: /\bTypeOrmModule\.forRoot\s*\(/.test(appModule),
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const [projectRoot, orm] = process.argv.slice(2);
        process.stdout.write(`${JSON.stringify(inspectProject(projectRoot, orm))}\n`);
    } catch (cause) {
        console.error(`❌ ${cause.message}`);
        process.exitCode = 1;
    }
}
