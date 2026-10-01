import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
const version = packageManifest.version;
const landing = fs.readFileSync(path.join(repositoryRoot, 'readme.md'), 'utf8');
const versionGuide = fs.readFileSync(path.join(repositoryRoot, 'docs', 'versions', `${version}.md`), 'utf8');
const exampleGuide = fs.readFileSync(path.join(repositoryRoot, 'examples', 'store-api', 'README.md'), 'utf8');
const exampleManifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'examples', 'store-api', 'nestgen.example.json'), 'utf8'),
);

function runCli(args) {
    const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'nestgen.js'), ...args], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`nestgen ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

function assertLocalLinks(document, source) {
    for (const match of document.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        const target = match[1];
        if (/^(?:https?:|mailto:)/.test(target)) continue;
        assert.equal(path.isAbsolute(target), false, `${source} ne doit pas utiliser de lien absolu local : ${target}`);
        assert.equal(
            fs.existsSync(path.resolve(repositoryRoot, target)),
            true,
            `${source} référence ${target}, qui est absent.`,
        );
    }
}

assert.match(landing, new RegExp(`npm install --global nestgen-cli@${version.replaceAll('.', '\\.')}`));
assert.match(
    landing,
    new RegExp(`## Published in ${version.replaceAll('.', '\\.')} / Disponible dans ${version.replaceAll('.', '\\.')}`),
);
assert.match(landing, /## Planned \(not released\) \/ Prévu \(non publié\)/);
assert.match(landing, /## Public demo \/ Démonstration publique/);
assert.match(landing, /npm run test:example/);
assert.match(landing, /npm run test:package/);
assert.match(landing, /not a production certification \/ pas une certification de production/);
assert.equal(exampleManifest.cliVersion, version);
assert.match(versionGuide, new RegExp(`nestgen-cli@${version.replaceAll('.', '\\.')}`));
assert.match(exampleGuide, new RegExp(`nestgen-cli@${version.replaceAll('.', '\\.')}`));
assert.match(landing, /https:\/\/www\.npmjs\.com\/package\/nestgen-cli/);
assert.match(landing, /https:\/\/github\.com\/el-hack\/nestgen-cli/);
assert.doesNotMatch(landing, /production[- ]ready|guaranteed performance|performances garanties/i);

const cliVersion = runCli(['--version']).trim();
const help = runCli(['--help']);
assert.equal(cliVersion, version);
for (const command of ['init', 'module', 'resource', 'config', 'doctor']) {
    assert.match(help, new RegExp(`\\b${command}\\b`));
    assert.match(landing, new RegExp(`nestgen ${command}(?:\\b| )`));
}

assertLocalLinks(landing, 'readme.md');
