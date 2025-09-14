#!/usr/bin/env node

import { execSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ────── Resolve __dirname compatible ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ────── Définition du chemin du générateur
const ROOT_PATH = process.env.NESTGEN_ROOT || path.resolve(__dirname, '.');
const GENERATE_SCRIPT = path.join(ROOT_PATH, 'generate_project.sh');
const ADD_MODULE_SCRIPT = path.join(ROOT_PATH, './features/add_module.sh');

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
function isNestProject() {
    return fs.existsSync(path.resolve('./src/app.module.ts'));
}

function parseModuleArgs(args) {
    const moduleName = args[1];
    const ormArg = args.find(arg => arg.startsWith('--orm='));
    const orm = ormArg ? ormArg.split('=')[1] : 'typeorm';
    return { moduleName, orm };
}

// ────── Commande : INIT
async function askInitQuestions() {
    return await inquirer.prompt([
        {
            type: 'input',
            name: 'projectName',
            message: '📛 Nom du projet :',
            default: 'my-app',
        },
        {
            type: 'input',
            name: 'projectPath',
            message: '📁 Dossier cible :',
            default: './',
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
        }
    ]);
}

async function runInteractiveInit() {
    printLogo();

    if (!fs.existsSync(GENERATE_SCRIPT)) {
        console.log(chalk.red(`❌ Script introuvable : ${GENERATE_SCRIPT}`));
        process.exit(1);
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
        APP_NAME: projectName,
        PROJECT_PATH: path.resolve(projectPath),
        PM: packageManager,
        ORM: orm,
        WITH_SWAGGER: withSwagger ? 'y' : 'n',
        WITH_DOCKER: withDocker ? 'y' : 'n',
        WITH_GIT: withGit ? 'y' : 'n',
        MODULES: modules.join(' '),
    };

    const envExport = Object.entries(env)
        .map(([key, val]) => `${key}="${val}"`)
        .join(' ');

    console.log('\n🚀 Lancement de la génération du projet...\n');
    try {
        execSync(`env ${envExport} bash "${GENERATE_SCRIPT}"`, {
            stdio: 'inherit',
        });
    } catch (err) {
        console.error(chalk.red('❌ Une erreur est survenue pendant la génération.'));
        process.exit(1);
    }
}

// ────── Commande : MODULE
async function runModuleGeneration(args) {
    printLogo();

    let moduleName, orm;

    if (args.length > 1) {
        ({ moduleName, orm } = parseModuleArgs(args));
        if (!moduleName) {
            console.log(chalk.red('❌ Tu dois fournir un nom de module.'));
            process.exit(1);
        }
    } else {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'moduleName',
                message: '📦 Nom du module :',
                validate: input => !!input || 'Le nom du module est requis',
            },
            {
                type: 'list',
                name: 'orm',
                message: '🧠 ORM utilisé :',
                choices: ['typeorm', 'prisma'],
                default: 'typeorm',
            },
        ]);
        moduleName = answers.moduleName;
        orm = answers.orm;
    }

    if (!isNestProject()) {
        console.log(chalk.red('❌ Aucun projet NestJS détecté dans ce dossier.'));
        console.log('👉 Lance cette commande depuis un projet généré avec `nestgen init`.');
        process.exit(1);
    }

    try {
        console.log(chalk.cyan(`\n⚙️  Génération du module ${moduleName}...\n`));
        execSync(`bash "${ADD_MODULE_SCRIPT}" "${moduleName}" "${orm}"`, {
            stdio: 'inherit',
        });
    } catch (err) {
        console.error(chalk.red('❌ Une erreur est survenue pendant la génération du module.'));
        process.exit(1);
    }
}

// ────── Entrée CLI
const args = process.argv.slice(2);
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
        break;
}
