import fs from 'node:fs';
import { projectPath } from './project-path.js';
function error(message) {
    throw new Error(`Préflight échoué : ${message}`);
}
function projectFile(root, relative, required, missingMessage) {
    const target = projectPath(root, relative);
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat) {
        if (required)
            error(missingMessage ?? `${relative} introuvable.`);
        return null;
    }
    if (!stat.isFile())
        error(`fichier régulier attendu : ${relative}.`);
    return target;
}
function readObject(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('objet JSON attendu');
        return value;
    }
    catch (cause) {
        error(`JSON invalide dans ${file} : ${cause instanceof Error ? cause.message : String(cause)}`);
    }
}
/** Read-only prerequisite checks shared by module, resource and legacy entry points. */
export function inspectProject(projectRoot, orm, options = {}) {
    const root = fs.realpathSync(projectRoot);
    const packagePath = projectFile(root, 'package.json', true, 'package.json introuvable. Exécute la commande à la racine d’un projet NestJS.');
    const appModulePath = projectFile(root, 'src/app.module.ts', true, 'src/app.module.ts introuvable. Les workspaces et structures personnalisées ne sont pas encore supportés.');
    const nestCliPath = projectFile(root, 'nest-cli.json', false);
    const packageJson = readObject(packagePath);
    const nestCli = nestCliPath ? readObject(nestCliPath) : null;
    if (nestCli?.monorepo || nestCli?.projects)
        error('les workspaces Nest ne sont pas encore supportés. Cible une application autonome.');
    if (nestCli?.sourceRoot !== undefined && nestCli.sourceRoot !== 'src')
        error('sourceRoot personnalisé non supporté : la génération requiert sourceRoot: "src".');
    if (nestCli?.root !== undefined && nestCli.root !== '' && nestCli.root !== '.')
        error('root personnalisé non supporté : exécute la génération à la racine de l’application.');
    const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
    };
    const required = ['@nestjs/common', '@nestjs/core'];
    if (options.cqrs !== false)
        required.push('@nestjs/cqrs');
    if (orm === 'typeorm')
        required.push('@nestjs/typeorm', 'typeorm');
    else if (orm === 'prisma')
        required.push('@prisma/client');
    else
        error(`ORM non supporté : ${orm}.`);
    const unavailable = required.filter((dependency) => !dependencies[dependency]);
    if (unavailable.length)
        error(`dépendances manquantes : ${unavailable.join(', ')}.`);
    if (orm === 'prisma') {
        projectFile(root, 'prisma/schema.prisma', true);
        projectFile(root, 'src/prisma/prisma.service.ts', false);
        projectFile(root, 'src/prisma/prisma.module.ts', false);
    }
    const appModule = fs.readFileSync(appModulePath, 'utf8');
    if (!/@Module\s*\(/.test(appModule))
        error('le décorateur @Module est introuvable dans src/app.module.ts.');
    return {
        root,
        appModulePath,
        packageManager: projectFile(root, 'pnpm-lock.yaml', false)
            ? 'pnpm'
            : projectFile(root, 'yarn.lock', false)
                ? 'yarn'
                : projectFile(root, 'package-lock.json', false)
                    ? 'npm'
                    : null,
        hasRootTypeOrmConnection: /\bTypeOrmModule\.forRoot\s*\(/.test(appModule),
    };
}
