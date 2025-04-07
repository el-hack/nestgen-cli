#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 📁 Chemins internes au package
const CLI_DIR = __dirname;
const ROOT_PATH = path.resolve(CLI_DIR, 'nestjs-generator');
const FEATURES_PATH = path.join(ROOT_PATH, 'features');

// 🖼️ Logo
function printLogo() {
    console.log(`
███╗   ██╗███████╗███████╗████████╗ ██████╗ ███████╗███╗   ██╗
████╗  ██║██╔════╝██╔════╝╚══██╔══╝██╔════╝ ██╔════╝████╗  ██║
██╔██╗ ██║█████╗  ███████╗   ██║   ██║  ███╗█████╗  ██╔██╗ ██║
██║╚██╗██║██╔══╝  ╚════██║   ██║   ██║   ██║██╔══╝  ██║╚██╗██║
██║ ╚████║███████╗███████║   ██║   ╚██████╔╝███████╗██║ ╚████║
╚═╝  ╚═══╝╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚══════╝╚═╝  ╚═══╝
                                                              
✨ NestGen CLI — Générateur modulaire NestJS
📦 DDD • CQRS • Hexagonal • TypeORM/Prisma • Swagger/Docker
`);
}

// 🔍 Vérifie qu’un script existe
function checkFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
        console.error(`❌ ${label} introuvable : ${filePath}`);
        process.exit(1);
    }
}

// 🧪 Diagnostic : nestgen doctor
function doctor() {
    printLogo();
    console.log("🔬 Diagnostic de l'environnement...\n");

    const checks = [
        { label: 'nestgen.js présent', ok: true },
        { label: 'generate_project.sh', ok: fs.existsSync(path.join(ROOT_PATH, 'generate_project.sh')) },
        { label: 'features/', ok: fs.existsSync(FEATURES_PATH) },
        { label: 'add_module.sh', ok: fs.existsSync(path.join(FEATURES_PATH, 'add_module.sh')) },
    ];

    try {
        execSync('command -v nestgen', { stdio: 'ignore' });
        checks.push({ label: 'commande nestgen (global)', ok: true });
    } catch {
        checks.push({ label: 'commande nestgen (global)', ok: false });
    }

    for (const c of checks) {
        console.log(c.ok ? `✅ ${c.label}` : `❌ ${c.label}`);
    }

    console.log("\n🎯 Résultat :", checks.every(c => c.ok) ? "Tout est OK ✅" : "Des points sont à corriger ⚠️");
}

// 🚀 Création de projet : nestgen init
function initProject() {
    printLogo();
    const script = path.join(ROOT_PATH, 'generate_project.sh');
    checkFile(script, 'Script de génération');
    execSync(`bash "${script}"`, { stdio: 'inherit' });
}

// ➕ Module : nestgen module user --orm=typeorm
function generateModule(name, orm = 'typeorm') {
    printLogo();

    if (!name) {
        console.error('❌ Tu dois fournir un nom de module.');
        process.exit(1);
    }

    const script = path.join(FEATURES_PATH, 'add_module.sh');
    checkFile(script, 'Script add_module');
    execSync(`bash "${script}" "${name}" "${orm}"`, { stdio: 'inherit' });
}

// 🧠 Commandes CLI
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
    case 'init':
        initProject();
        break;
    case 'module':
        const moduleName = args[1];
        const ormArg = args.find(a => a.startsWith('--orm='));
        const orm = ormArg ? ormArg.split('=')[1] : 'typeorm';
        generateModule(moduleName, orm);
        break;
    case 'doctor':
        doctor();
        break;
    default:
        printLogo();
        console.log(`📘 Commandes disponibles :
  ▸ nestgen init                          → Crée un projet NestJS complet
  ▸ nestgen module <nom> --orm=typeorm   → Génère un module (DDD/CQRS)
  ▸ nestgen doctor                       → Vérifie l’environnement CLI
`);
        break;
}
