import fs from 'node:fs';
import path from 'node:path';
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
    const nestCliPath = projectFile(root, 'nest-cli.json', false);
    const packageJson = readObject(packagePath);
    const nestCli = nestCliPath ? readObject(nestCliPath) : null;
    const projects = nestCli?.projects;
    const applicationNames = Object.entries(projects ?? {})
        .filter(([, project]) => project.type === undefined || project.type === 'application')
        .map(([name]) => name);
    if (nestCli?.monorepo && applicationNames.length === 0)
        error('workspaces Nest : aucune application déclarée dans nest-cli.json.');
    const application = options.application;
    if (application && !applicationNames.includes(application))
        error(`application inconnue : ${application}. Applications disponibles : ${applicationNames.join(', ') || 'aucune'}.`);
    if (!application && applicationNames.length > 1)
        error(`workspace ambigu : utilise --application. Applications disponibles : ${applicationNames.join(', ')}.`);
    const selected = application
        ? projects[application]
        : applicationNames.length === 1
            ? projects[applicationNames[0]]
            : nestCli;
    const sourceRoot = selected?.sourceRoot ?? 'src';
    if (typeof sourceRoot !== 'string' || !sourceRoot || path.isAbsolute(sourceRoot) || sourceRoot.includes('..'))
        error('sourceRoot invalide dans nest-cli.json.');
    const appModulePath = projectFile(root, `${sourceRoot}/app.module.ts`, true, sourceRoot === 'src'
        ? `${sourceRoot}/app.module.ts introuvable.`
        : `sourceRoot personnalisé : ${sourceRoot}/app.module.ts introuvable.`);
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
        projectFile(root, `${sourceRoot}/prisma/prisma.service.ts`, false);
        projectFile(root, `${sourceRoot}/prisma/prisma.module.ts`, false);
    }
    const appModule = fs.readFileSync(appModulePath, 'utf8');
    if (!/@Module\s*\(/.test(appModule))
        error(`le décorateur @Module est introuvable dans ${sourceRoot}/app.module.ts.`);
    return {
        root,
        appModulePath,
        sourceRoot,
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
