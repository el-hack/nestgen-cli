#!/usr/bin/env node

import { spawnSync } from 'child_process';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { inspectProject } from './nestjs-generator/features/preflight.mjs';
import { generateModule } from './dist/engine/module-generator.js';
import { generateResource } from './dist/engine/resource-generator.js';
import {
    parseResourceFields,
    parseResourceIndexes,
    parseResourceListOptions,
    parseResourceRelations,
} from './dist/engine/resource-spec.js';
import { configFileName, defaultConfig, loadConfigIfPresent, writeConfig } from './dist/engine/project-config.js';
import { parseArchitectureProfile } from './dist/engine/architecture-profile.js';

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

function validatePackageManager(value) {
    if (!['npm', 'pnpm', 'yarn'].includes(value)) throw new Error('Package manager invalide.');
    return value;
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
    return { moduleName: validateModuleName(parsed.positionals[0]), orm: validateOrm(parsed.options.orm ?? 'typeorm') };
}

export function parseCliArgs(args) {
    const options = {
        orm: undefined,
        profile: undefined,
        packageManager: undefined,
        projectPath: undefined,
        docker: undefined,
        swagger: undefined,
        git: undefined,
        modules: undefined,
        indexes: undefined,
        definitionFile: undefined,
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
        else if (argument === '--profile') options.profile = args[++index];
        else if (argument.startsWith('--profile=')) options.profile = argument.slice(10);
        else if (argument === '--package-manager') options.packageManager = args[++index];
        else if (argument.startsWith('--package-manager=')) options.packageManager = argument.slice(18);
        else if (argument === '--project-path') options.projectPath = args[++index];
        else if (argument.startsWith('--project-path=')) options.projectPath = argument.slice(15);
        else if (argument === '--docker') options.docker = true;
        else if (argument === '--no-docker') options.docker = false;
        else if (argument === '--swagger') options.swagger = true;
        else if (argument === '--no-swagger') options.swagger = false;
        else if (argument === '--git') options.git = true;
        else if (argument === '--no-git') options.git = false;
        else if (argument === '--modules') options.modules = args[++index];
        else if (argument.startsWith('--modules=')) options.modules = argument.slice(10);
        else if (argument === '--fields') options.fields = args[++index];
        else if (argument.startsWith('--fields=')) options.fields = argument.slice(9);
        else if (argument === '--indexes') options.indexes = args[++index];
        else if (argument.startsWith('--indexes=')) options.indexes = argument.slice(10);
        else if (argument === '--file') options.definitionFile = args[++index];
        else if (argument.startsWith('--file=')) options.definitionFile = argument.slice(7);
        else if (argument === '--route') options.route = args[++index];
        else if (argument.startsWith('--route=')) options.route = argument.slice(8);
        else if (argument === '--table') options.table = args[++index];
        else if (argument.startsWith('--table=')) options.table = argument.slice(8);
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
    if (!fs.existsSync(GENERATE_SCRIPT)) {
        throw new Error(`Script introuvable : ${GENERATE_SCRIPT}`);
    }

    const answers = options.noInteractive
        ? (() => {
              const missing = [
                  ['nom du projet', options.projectName],
                  ['--project-path', options.projectPath],
                  ['--package-manager', options.packageManager],
                  ['--orm', options.orm],
                  ['--docker ou --no-docker', options.docker],
                  ['--swagger ou --no-swagger', options.swagger],
                  ['--git ou --no-git', options.git],
                  ['--modules', options.modules],
              ]
                  .filter(([, value]) => value === undefined)
                  .map(([name]) => name);
              if (missing.length) throw new Error(`init --no-interactive requiert : ${missing.join(', ')}.`);
              return {
                  projectName: options.projectName,
                  projectPath: options.projectPath,
                  packageManager: options.packageManager,
                  orm: options.orm,
                  withDocker: options.docker,
                  withSwagger: options.swagger,
                  withGit: options.git,
                  modules: options.modules ? options.modules.split(',').filter(Boolean) : [],
              };
          })()
        : await askInitQuestions();
    const { projectName, projectPath, packageManager, orm, withSwagger, withDocker, withGit, modules } = answers;

    const env = {
        APP_NAME: validateModuleName(projectName),
        PROJECT_PATH: resolveProjectPath(projectPath),
        PM: validatePackageManager(packageManager),
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
        orm = validateOrm(parsed.options.orm ?? 'typeorm');
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

    await generateModule(process.cwd(), moduleName, orm);
}

export function loadResourceDefinition(file, projectRoot = process.cwd()) {
    const candidate = path.resolve(projectRoot, String(file ?? ''));
    if (!candidate.startsWith(`${path.resolve(projectRoot)}${path.sep}`))
        throw new Error('--file doit désigner un fichier situé dans le projet courant.');
    let value;
    try {
        value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (error) {
        throw new Error(`Définition de ressource invalide (${candidate}) : ${error.message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error(`Définition de ressource invalide (${candidate}) : un objet JSON est requis.`);
    if (value.version !== 1) throw new Error(`Définition de ressource invalide (${candidate}) : version 1 requise.`);
    if (!Array.isArray(value.fields) || value.fields.some((field) => typeof field !== 'string'))
        throw new Error(`Définition de ressource invalide (${candidate}) : fields doit être un tableau de chaînes.`);
    for (const [index, field] of value.fields.entries()) {
        try {
            parseResourceFields([field]);
        } catch (error) {
            throw new Error(`Définition de ressource invalide (${candidate}) : fields[${index}] — ${error.message}`);
        }
    }
    const fields = parseResourceFields(value.fields);
    if (value.relations !== undefined && !Array.isArray(value.relations))
        throw new Error(`Définition de ressource invalide (${candidate}) : relations doit être un tableau.`);
    let relations;
    try {
        relations = parseResourceRelations(value.relations ?? []);
    } catch (error) {
        throw new Error(`Définition de ressource invalide (${candidate}) : relations — ${error.message}`);
    }
    const relationFields = relationIndexFields(relations);
    try {
        parseResourceListOptions(value.list, [...fields, ...relationFields]);
    } catch (error) {
        throw new Error(`Définition de ressource invalide (${candidate}) : list — ${error.message}`);
    }
    if (
        value.indexes !== undefined &&
        (!Array.isArray(value.indexes) || value.indexes.some((index) => typeof index !== 'string'))
    )
        throw new Error(`Définition de ressource invalide (${candidate}) : indexes doit être un tableau de chaînes.`);
    try {
        if (
            value.uniqueIndexes !== undefined &&
            (!Array.isArray(value.uniqueIndexes) || value.uniqueIndexes.some((index) => typeof index !== 'string'))
        )
            throw new Error(
                `Définition de ressource invalide (${candidate}) : uniqueIndexes doit être un tableau de chaînes.`,
            );
        parseResourceIndexes(value.indexes ?? [], [...fields, ...relationFields], value.uniqueIndexes ?? []);
    } catch (error) {
        throw new Error(`Définition de ressource invalide (${candidate}) : indexes — ${error.message}`);
    }
    return value;
}

function relationIndexFields(relations) {
    return relations
        .filter((relation) => relation.type === 'belongsTo')
        .map((relation) => ({
            name: `${relation.field ?? relation.target.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}Id`,
        }));
}

async function runResourceGeneration(parsed) {
    const definition = parsed.options.definitionFile ? loadResourceDefinition(parsed.options.definitionFile) : {};
    const name = validateModuleName(parsed.positionals[0] ?? definition.name ?? '');
    const fieldValues = parsed.options.fields?.split(',').filter(Boolean) ?? definition.fields;
    if (!fieldValues) throw new Error('resource requiert --fields ou --file avec fields.');
    const config = loadConfigIfPresent(process.cwd()) ?? defaultConfig;
    const orm = validateOrm(parsed.options.orm ?? definition.orm ?? config.orm);
    const profile = parseArchitectureProfile(parsed.options.profile ?? definition.profile ?? config.profile);
    const fields = parseResourceFields(fieldValues);
    const relations = parseResourceRelations(definition.relations ?? []);
    const relationFields = relationIndexFields(relations);
    const list = parseResourceListOptions(definition.list, [...fields, ...relationFields]);
    const indexes = parseResourceIndexes(
        parsed.options.indexes?.split(',').filter(Boolean) ?? definition.indexes ?? [],
        [...fields, ...relationFields],
        definition.uniqueIndexes ?? [],
    );
    const route = parsed.options.route ?? definition.route ?? `${name}s`;
    const table = parsed.options.table ?? definition.table ?? `${name}s`;
    if (!/^[a-z][a-z0-9/-]*$/.test(route) || !/^[a-z][a-z0-9_]*$/.test(table))
        throw new Error('Route ou table invalide.');
    if (parsed.options.dryRun) {
        console.log(
            JSON.stringify(
                { operation: 'resource', name, route, table, orm, profile, fields, indexes, relations, list },
                null,
                2,
            ),
        );
        return;
    }
    await generateResource(process.cwd(), { name, route, table, fields, indexes, relations, list, orm, profile });
}

function printUsage() {
    console.log(
        `Usage: nestgen <commande> [options]\n\nCommandes:\n  init [nom]                   Génère un projet NestJS\n  module <nom> [--orm <orm>]  Génère un module\n  resource <nom> --fields ...    Génère un CRUD TypeORM ou Prisma
  config init|show               Gère nestgen.config.json
  doctor                       Vérifie l'installation\n\nOptions:\n  -h, --help                   Affiche cette aide\n  -V, --version                Affiche la version\n  --no-interactive             Refuse les prompts\n  --quiet                      Supprime les sorties non essentielles\n  --verbose                    Active les diagnostics\n  --no-color                   Désactive les couleurs\n  --profile <simple|advanced>   Choisit le profil d'architecture
  --package-manager <pm>        Définit npm, pnpm ou yarn
  --project-path <chemin>       Définit le dossier parent du projet init
  --docker, --no-docker         Active ou désactive Docker pour init
  --swagger, --no-swagger       Active ou désactive Swagger pour init
  --git, --no-git               Active ou désactive Git pour init
  --modules <a,b>               Définit les modules init, séparés par des virgules
  --dry-run                    Affiche le plan sans écrire
  --indexes <a+b,c>            Ajoute des index composites ou simples\n\nChamps resource : string, number, integer, decimal(precision;scale), enum(VALEUR|VALEUR), boolean, date, uuid.`,
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
            if (parsed.positionals.length > 1) throw new Error('init accepte au plus un nom de projet.');
            await runInteractiveInit({ ...parsed.options, projectName: parsed.positionals[0] });
            break;

        case 'module':
            await runModuleGeneration(parsed);
            break;

        case 'resource':
            await runResourceGeneration(parsed);
            break;

        case 'config': {
            const action = parsed.positionals[0];
            if (action === 'show') {
                console.log(JSON.stringify(loadConfigIfPresent(process.cwd()) ?? defaultConfig, null, 2));
                break;
            }
            if (action === 'init') {
                const config = {
                    ...defaultConfig,
                    orm: validateOrm(parsed.options.orm ?? defaultConfig.orm),
                    profile: parseArchitectureProfile(parsed.options.profile),
                    packageManager: parsed.options.packageManager ?? defaultConfig.packageManager,
                };
                if (!['npm', 'pnpm', 'yarn'].includes(config.packageManager))
                    throw new Error('Package manager invalide.');
                if (parsed.options.dryRun) {
                    console.log(JSON.stringify({ operation: 'config-init', file: configFileName, config }, null, 2));
                    break;
                }
                writeConfig(process.cwd(), config);
                console.log(configFileName);
                break;
            }
            throw new Error('config requiert init ou show.');
        }

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
