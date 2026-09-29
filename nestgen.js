#!/usr/bin/env node

import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { inspectProject } from './nestjs-generator/features/preflight.mjs';
import { generateModule } from './dist/engine/module-generator.js';

// ────── Resolve __dirname compatible ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ────── Définition du chemin du générateur
const ROOT_PATH = process.env.NESTGEN_ROOT || path.resolve(__dirname, './nestjs-generator');
const GENERATE_SCRIPT = path.join(ROOT_PATH, 'generate_project.sh');
const ADD_MODULE_SCRIPT = path.join(ROOT_PATH, './features/add_module.sh');
const SUPPORTED_ORMS = new Set(['typeorm', 'prisma']);
const MODULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/i;

// ────── Logo CLI
function printLogo() {
    console.log(
        chalk.magentaBright(`
███╗   ██╗███████╗███████╗████████╗ ██████╗ ███████╗███╗   ██╗
████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔════╝ ██╔════╝████╗  ██║
██╔██╗ ██║█████╗  ███████╗   ██║   ██║  ███╗█████╗  ██╔██╗ ██║
██║╚██╗██║██╔══╝  ╚════██║   ██║   ██║   ██║██╔══╝  ██║╚██╗██║
██║ ╚████║███████╗███████║   ██║   ╚██████╔╝███████╗██║ ╚████║
╚═╝  ╚═══╝╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚══════╝╚═╝  ╚═══╝
`),
    );
    console.log(chalk.cyan.bold('✨ NestGen CLI — Générateur modulaire NestJS'));
}

// ────── Helpers
export function isNestProject() {
    return fs.existsSync(path.resolve('./src/app.module.ts'));
}

export function validateModuleName(value) {
    const moduleName = String(value ?? '').trim();

    if (!MODULE_NAME_PATTERN.test(moduleName)) {
        throw new Error(
            'Le nom du module doit commencer par une lettre et ne contenir que des lettres, chiffres, tirets ou underscores.',
        );
    }

    return moduleName.toLowerCase();
}

export function validateOrm(value) {
    const orm = String(value ?? '')
        .trim()
        .toLowerCase();

    if (!SUPPORTED_ORMS.has(orm)) {
        throw new Error(`ORM non supporté : ${value}. Valeurs acceptées : ${[...SUPPORTED_ORMS].join(', ')}.`);
    }

    return orm;
}

export function resolveProjectPath(value) {
    const projectPath = String(value ?? '').trim();

    if (!projectPath || projectPath.includes('\0')) {
        throw new Error('Le dossier cible doit être un chemin non vide valide.');
    }

    return path.resolve(projectPath);
}

export function parseModuleArgs(args) {
    const parsed = parseCliArgs(args);
    if (parsed.command !== 'module' || !parsed.positionals[0])
        throw new Error('La commande module requiert un nom de module.');
    return { moduleName: validateModuleName(parsed.positionals[0]), orm: validateOrm(parsed.options.orm) };
}

export function parseCliArgs(args) {
    const options = {
        orm: 'typeorm',
        noInteractive: false,
        quiet: false,
        verbose: false,
        color: true,
        help: false,
        version: false,
        dryRun: false,
    };
    const positionals = [];
    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--orm') {
            const value = args[++index];
            if (!value || value.startsWith('-')) throw new Error('--orm requiert une valeur.');
            options.orm = value;
        } else if (argument.startsWith('--orm=')) options.orm = argument.slice(6);
        else if (argument === '--no-interactive') options.noInteractive = true;
        else if (argument === '--quiet') options.quiet = true;
        else if (argument === '--verbose') options.verbose = true;
        else if (argument === '--dry-run') options.dryRun = true;
        else if (argument === '--no-color') options.color = false;
        else if (argument === '--help' || argument === '-h') options.help = true;
        else if (argument === '--version' || argument === '-V') options.version = true;
        else if (argument.startsWith('-')) throw new Error(`Option inconnue : ${argument}`);
        else positionals.push(argument);
    }
    return { command: positionals.shift(), positionals, options };
}

export function createModulePlan(projectRoot, moduleName, orm) {
    const normalizedName = validateModuleName(moduleName);
    const normalizedOrm = validateOrm(orm);
    const resourceRoot = `src/app/${normalizedName}`;
    return {
        operation: 'module',
        module: normalizedName,
        orm: normalizedOrm,
        projectRoot,
        files: [
            `${resourceRoot}/core/domain/entities/${normalizedName}.entity.ts`,
            `${resourceRoot}/core/domain/ports/${normalizedName}.repository.ts`,
            `${resourceRoot}/core/application/commands/create-${normalizedName}.command.ts`,
            `${resourceRoot}/core/application/commands/create-${normalizedName}.handler.ts`,
            `${resourceRoot}/interfaces/dtos/create-${normalizedName}.dto.ts`,
            `${resourceRoot}/interfaces/controllers/${normalizedName}.controller.ts`,
            `${resourceRoot}/${normalizedName}.module.ts`,
        ],
        mutations: [
            'Ajoute le module dans @Module({ imports }) de src/app.module.ts.',
            'Ajoute CqrsModule dans src/app.module.ts si nécessaire.',
            ...(normalizedOrm === 'typeorm'
                ? ['Ajoute la configuration TypeORM racine seulement si elle est absente.']
                : []),
        ],
    };
}

export function runBashScript(scriptPath, args = [], env = {}, quiet = false) {
    const result = spawnSync('bash', [scriptPath, ...args], {
        env: { ...process.env, ...env },
        stdio: quiet ? 'pipe' : 'inherit',
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Le script ${path.basename(scriptPath)} a échoué avec le code ${result.status ?? 'inconnu'}.`);
    }
}

// ────── Commande : INIT
async function askInitQuestions() {
    return await inquirer.prompt([
        {
            type: 'input',
            name: 'projectName',
            message: '📛 Nom du projet :',
            default: 'my-app',
            validate: validatePromptValue(validateModuleName),
        },
        {
            type: 'input',
            name: 'projectPath',
            message: '📁 Dossier cible :',
            default: './',
            validate: validatePromptValue(resolveProjectPath),
        },
        {
            type: 'list',
            name: 'packageManager',
            message: '📦 Package manager :',
            choices: ['pnpm', 'yarn', 'npm'],
            default: 'pnpm',
        },
        {
            type: 'list',
            name: 'orm',
            message: '🧠 ORM :',
            choices: ['typeorm', 'prisma'],
            default: 'typeorm',
        },
        {
            type: 'confirm',
            name: 'withSwagger',
            message: '📚 Activer Swagger ?',
            default: true,
        },
        {
            type: 'confirm',
            name: 'withDocker',
            message: '🐳 Activer Docker ?',
            default: false,
        },
        {
            type: 'confirm',
            name: 'withGit',
            message: '🔃 Initialiser Git ?',
            default: true,
        },
        {
            type: 'input',
            name: 'modules',
            message: '📦 Modules à générer (séparés par des espaces) :',
            default: 'user',
            filter: (input) =>
                input
                    .split(' ')
                    .map((s) => s.trim())
                    .filter(Boolean),
            validate: validatePromptValue((modules) => modules.forEach(validateModuleName)),
        },
    ]);
}

function validatePromptValue(validator) {
    return (value) => {
        try {
            validator(value);
            return true;
        } catch (error) {
            return error.message;
        }
    };
}

async function runInteractiveInit(options) {
    if (!options.quiet) printLogo();
    if (options.noInteractive)
        throw new Error(
            'init --no-interactive requiert des options de projet qui ne sont pas encore prises en charge.',
        );

    if (!fs.existsSync(GENERATE_SCRIPT)) {
        throw new Error(`Script introuvable : ${GENERATE_SCRIPT}`);
    }

    const answers = await askInitQuestions();
    const { projectName, projectPath, packageManager, orm, withSwagger, withDocker, withGit, modules } = answers;

    const env = {
        APP_NAME: validateModuleName(projectName),
        PROJECT_PATH: resolveProjectPath(projectPath),
        PM: packageManager,
        ORM: validateOrm(orm),
        WITH_SWAGGER: withSwagger ? 'y' : 'n',
        WITH_DOCKER: withDocker ? 'y' : 'n',
        WITH_GIT: withGit ? 'y' : 'n',
        MODULES: modules.map(validateModuleName).join(' '),
    };

    console.log('\n🚀 Lancement de la génération du projet...\n');
    runBashScript(GENERATE_SCRIPT, [], env);
}

// ────── Commande : MODULE
async function runModuleGeneration(parsed) {
    if (!parsed.options.quiet) printLogo();

    let moduleName, orm;

    if (parsed.positionals[0]) {
        moduleName = validateModuleName(parsed.positionals[0]);
        orm = validateOrm(parsed.options.orm);
    } else {
        if (parsed.options.noInteractive) throw new Error('module --no-interactive requiert un nom de module.');
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'moduleName',
                message: '📦 Nom du module :',
                validate: validatePromptValue(validateModuleName),
            },
            {
                type: 'list',
                name: 'orm',
                message: '🧠 ORM utilisé :',
                choices: ['typeorm', 'prisma'],
                default: 'typeorm',
            },
        ]);
        moduleName = validateModuleName(answers.moduleName);
        orm = validateOrm(answers.orm);
    }

    if (!isNestProject()) {
        throw new Error('Aucun projet NestJS détecté dans ce dossier. Lance cette commande depuis un projet NestJS.');
    }

    if (parsed.options.dryRun) {
        inspectProject(process.cwd(), orm);
        console.log(JSON.stringify(createModulePlan(process.cwd(), moduleName, orm), null, 2));
        return;
    }

    if (!parsed.options.quiet) console.log(chalk.cyan(`\n⚙️  Génération du module ${moduleName}...\n`));
    if (process.env.NESTGEN_ROOT) {
        runBashScript(ADD_MODULE_SCRIPT, [moduleName, orm], {}, parsed.options.quiet);
        return;
    }

    generateModule(process.cwd(), moduleName, orm);
}

function printUsage() {
    console.log(
        `Usage: nestgen <commande> [options]\n\nCommandes:\n  init                         Génère un projet NestJS en mode interactif\n  module <nom> [--orm <orm>]  Génère un module\n  doctor                       Vérifie l'installation\n\nOptions:\n  -h, --help                   Affiche cette aide\n  -V, --version                Affiche la version\n  --no-interactive             Refuse les prompts\n  --quiet                      Supprime les sorties non essentielles\n  --verbose                    Active les diagnostics\n  --no-color                   Désactive les couleurs\n  --dry-run                    Affiche le plan sans écrire`,
    );
}

function runDoctor() {
    const checks = [
        [
            'Node.js',
            process.versions.node,
            Number(process.versions.node.split('.')[0]) >= 24,
            'Installe Node.js 24 LTS ou une version supportée.',
        ],
        [
            'Scripts NestGen',
            `${GENERATE_SCRIPT}, ${ADD_MODULE_SCRIPT}`,
            fs.existsSync(GENERATE_SCRIPT) && fs.existsSync(ADD_MODULE_SCRIPT),
            'Réinstalle NestGen.',
        ],
    ];
    for (const [name, detail, valid, advice] of checks)
        console.log(`${valid ? 'OK' : 'ERREUR'} ${name}: ${detail}${valid ? '' : ` — ${advice}`}`);
    try {
        const project = inspectProject(process.cwd(), 'typeorm');
        console.log(
            `OK Projet Nest: ${project.packageManager ?? 'lockfile absent'}; connexion TypeORM racine: ${project.hasRootTypeOrmConnection ? 'présente' : 'absente'}.`,
        );
    } catch (error) {
        console.log(
            `INFO Projet Nest: ${error.message} — Lance doctor depuis un projet Nest compatible pour analyser son intégration.`,
        );
    }
    if (checks.some(([, , valid]) => !valid)) throw new Error('Des prérequis NestGen sont manquants.');
}

// ────── Entrée CLI
export async function main(args = process.argv.slice(2)) {
    const parsed = parseCliArgs(args);
    if (!parsed.options.color) chalk.level = 0;
    if (parsed.options.version) {
        const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        console.log(packageJson.version);
        return;
    }
    if (parsed.options.help || !parsed.command) {
        printUsage();
        return;
    }

    switch (parsed.command) {
        case 'init':
            await runInteractiveInit(parsed.options);
            break;

        case 'module':
            await runModuleGeneration(parsed);
            break;

        case 'doctor':
            runDoctor();
            break;

        default:
            throw new Error(`Commande inconnue : ${parsed.command}. Utilise --help.`);
    }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error(chalk.red(`❌ ${error.message}`));
        process.exitCode = 1;
    });
}
