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
const ROOT_PATH = process.env.NESTGEN_ROOT || path.resolve(__dirname, './nestjs-generator');
const GENERATE_SCRIPT = path.join(ROOT_PATH, 'generate_project.sh');

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
    console.log(chalk.cyan.bold('✨ NestGen CLI — Générateur modulaire NestJSs'));
}

// ────── Questions interactives
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

// ────── Exécution du init
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

// ────── Entrée CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'init':
        await runInteractiveInit();
        break;

    default:
        printLogo();
        console.log(chalk.gray(`
📘 Commandes disponibles :
  ▸ nestgen init       → Génère un projet complet NestJS (interactive)
  ▸ nestgen module     → Bientôt interactif aussi 😏
  ▸ nestgen doctor     → Diagnostic de l’installation CLI
`));
        break;
}
