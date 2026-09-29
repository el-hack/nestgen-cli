#!/usr/bin/env node

import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
    console.log(chalk.magentaBright(`
███╗   ██╗███████╗███████╗████████╗ ██████╗ ███████╗███╗   ██╗
████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔════╝ ██╔════╝████╗  ██║
██╔██╗ ██║█████╗  ███████╗   ██║   ██║  ███╗█████╗  ██╔██╗ ██║
██║╚██╗██║██╔══╝  ╚════██║   ██║   ██║   ██║██╔══╝  ██║╚██╗██║
██║ ╚████║███████╗███████║   ██║   ╚██████╔╝███████╗██║ ╚████║
╚═╝  ╚═══╝╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚══════╝╚═╝  ╚═══╝
`));
    console.log(chalk.cyan.bold('✨ NestGen CLI — Générateur modulaire NestJS'));
}

// ────── Helpers
export function isNestProject() {
    return fs.existsSync(path.resolve('./src/app.module.ts'));
}

export function validateModuleName(value) {
    const moduleName = String(value ?? '').trim();

    if (!MODULE_NAME_PATTERN.test(moduleName)) {
        throw new Error('Le nom du module doit commencer par une lettre et ne contenir que des lettres, chiffres, tirets ou underscores.');
    }

    return moduleName.toLowerCase();
}

export function validateOrm(value) {
    const orm = String(value ?? '').trim().toLowerCase();

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
    const moduleName = validateModuleName(args[1]);
    const ormArg = args.find(arg => arg.startsWith('--orm='));
    const orm = validateOrm(ormArg ? ormArg.slice('--orm='.length) : 'typeorm');
    return { moduleName, orm };
}

export function runBashScript(scriptPath, args = [], env = {}) {
    const result = spawnSync('bash', [scriptPath, ...args], {
        env: { ...process.env, ...env },
        stdio: 'inherit',
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
            filter: (input) => input.split(' ').map(s => s.trim()).filter(Boolean),
            validate: validatePromptValue((modules) => modules.forEach(validateModuleName)),
        }
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

async function runInteractiveInit() {
    printLogo();

    if (!fs.existsSync(GENERATE_SCRIPT)) {
        throw new Error(`Script introuvable : ${GENERATE_SCRIPT}`);
    }

    const answers = await askInitQuestions();
    const {
        projectName,
        projectPath,
        packageManager,
        orm,
        withSwagger,
        withDocker,
        withGit,
        modules,
    } = answers;

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
async function runModuleGeneration(args) {
    printLogo();

    let moduleName, orm;

    if (args.length > 1) {
        ({ moduleName, orm } = parseModuleArgs(args));
    } else {
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

    console.log(chalk.cyan(`\n⚙️  Génération du module ${moduleName}...\n`));
    runBashScript(ADD_MODULE_SCRIPT, [moduleName, orm]);
}

// ────── Entrée CLI
export async function main(args = process.argv.slice(2)) {
    const command = args[0];

    switch (command) {
        case 'init':
            await runInteractiveInit();
            break;

        case 'module':
            await runModuleGeneration(args);
            break;

        default:
            printLogo();
            console.log(chalk.gray(`
📘 Commandes disponibles :
  ▸ nestgen init                 → Génère un projet complet NestJS (interactive)
  ▸ nestgen module [nom] [--orm=xxx]  → Génère un module (interactive ou CLI)
  ▸ nestgen doctor              → Diagnostic de l’installation CLI
`));
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    main().catch((error) => {
        console.error(chalk.red(`❌ ${error.message}`));
        process.exitCode = 1;
    });
}
