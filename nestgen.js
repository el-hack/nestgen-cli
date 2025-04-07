#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 🧠 Chemins
const CLI_DIR = __dirname;
const ROOT_PATH = process.env.NESTGEN_ROOT || path.resolve(__dirname, './nestjs-generator');
const FEATURES_PATH = path.join(ROOT_PATH, 'features');

// 🖼️ Logo propre

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

// 🩺 Commande : nestgen doctor
function doctor() {
    printLogo();
    console.log("🔬 Diagnostic de l'environnement...\n");

    const results = [];

    // Vérif fichiers
    results.push({ label: '✅ nestgen.js présent', ok: fs.existsSync(path.join(CLI_DIR, 'nestgen.js')) });
    results.push({ label: '✅ generate_project.sh présent', ok: fs.existsSync(path.join(ROOT_PATH, 'generate_project.sh')) });
    results.push({ label: '✅ dossier features/ présent', ok: fs.existsSync(FEATURES_PATH) });

    // Vérif binaire global
    try {
        execSync('command -v nestgen', { stdio: 'ignore' });
        results.push({ label: '✅ commande nestgen disponible globalement', ok: true });
    } catch {
        results.push({ label: '❌ commande nestgen NON disponible globalement', ok: false });
    }

    // Résultat
    results.forEach(r => console.log(r.ok ? r.label : `❌ ${r.label}`));
    const allGood = results.every(r => r.ok);
    console.log("\n🎯 Résultat :", allGood ? "Tout est OK ✅" : "Des points sont à corriger ⚠️");
}

// 🧱 Commande : nestgen init
function initProject() {
    printLogo();

    const script = path.join(ROOT_PATH, 'generate_project.sh');

    if (!fs.existsSync(script)) {
        console.error(`❌ Script introuvable : ${script}`);
        process.exit(1);
    }
    execSync(`bash "${script}"`, { stdio: 'inherit' });
}

// 🧱 Commande : nestgen module <name> --orm=...
function generateModule(name, orm = 'typeorm') {
    printLogo();

    if (!name) {
        console.error('❌ Tu dois fournir un nom de module.');
        process.exit(1);
    }

    const script = path.join(FEATURES_PATH, 'add_module.sh');
    if (!fs.existsSync(script)) {
        console.error(`❌ Script introuvable : ${script}`);
        process.exit(1);
    }

    execSync(`bash "${script}" "${name}" "${orm}"`, { stdio: 'inherit' });
}

// 🧠 Parse les args
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
