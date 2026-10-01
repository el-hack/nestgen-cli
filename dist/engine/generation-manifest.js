import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from './project-path.js';
export const generationManifestPath = '.nestgen/generation-manifest.json';
const manifestVersion = 1;
function generatorVersion() {
    const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (typeof manifest.version !== 'string')
        throw new Error('Version du générateur introuvable.');
    return manifest.version;
}
function generationKey(definition) {
    return `${definition.kind}:${definition.sourceRoot}/app/${definition.name}`;
}
export function resourceGenerationKey(sourceRoot, name) {
    return `resource:${sourceRoot}/app/${name}`;
}
function sha256(content) {
    return createHash('sha256').update(content).digest('hex');
}
function normalizeManifest(manifest) {
    return {
        version: 1,
        generations: Object.fromEntries(Object.entries(manifest.generations)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [
            key,
            {
                definition: entry.definition,
                files: Object.fromEntries(Object.entries(entry.files).sort(([left], [right]) => left.localeCompare(right))),
                generator: entry.generator,
            },
        ])),
    };
}
export function loadGenerationManifest(projectRoot) {
    const file = projectPath(projectRoot, generationManifestPath);
    if (!fs.existsSync(file))
        return undefined;
    let value;
    try {
        value = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    catch {
        throw new Error('Le manifeste de génération est invalide.');
    }
    if (!value || typeof value !== 'object' || value.version !== manifestVersion)
        throw new Error('Version de manifeste de génération non supportée.');
    const generations = value.generations;
    if (!generations || typeof generations !== 'object' || Array.isArray(generations))
        throw new Error('Le manifeste de génération est invalide.');
    return normalizeManifest(value);
}
function resourceDefinition(name, orm, sourceRoot, route, table, profile, fields, indexes, relations, list) {
    return {
        kind: 'resource',
        name,
        orm,
        sourceRoot,
        route,
        table,
        profile,
        // Defaults can contain domain secrets. They remain in the resource definition,
        // but generation metadata must stay safe to commit.
        fields: fields.map(({ defaultValue: _defaultValue, ...field }) => field),
        indexes,
        relations,
        list,
    };
}
export function moduleGenerationDefinition(name, orm, sourceRoot) {
    return { kind: 'module', name, orm, sourceRoot };
}
export function resourceGenerationDefinition(name, orm, sourceRoot, route, table, profile, fields, indexes, relations, list) {
    return resourceDefinition(name, orm, sourceRoot, route, table, profile, fields, indexes, relations, list);
}
/** Add the versioned generation manifest to the same transaction as generated files. */
export function withGenerationManifest(projectRoot, changes, definition) {
    const existing = loadGenerationManifest(projectRoot) ?? { version: 1, generations: {} };
    const files = Object.fromEntries(changes
        .map((change) => [change.path, sha256(change.content)])
        .sort(([left], [right]) => left.localeCompare(right)));
    const manifest = normalizeManifest({
        ...existing,
        generations: {
            ...existing.generations,
            [generationKey(definition)]: {
                definition,
                files,
                generator: { name: 'nestgen-cli', version: generatorVersion() },
            },
        },
    });
    return [
        ...changes,
        {
            path: generationManifestPath,
            content: `${JSON.stringify(manifest, null, 2)}\n`,
            operation: existing.generations[generationKey(definition)] ||
                fs.existsSync(projectPath(projectRoot, generationManifestPath))
                ? 'replace'
                : 'create',
        },
    ];
}
/** Report generated files changed after their recorded successful generation. */
export function modifiedGeneratedFiles(projectRoot, entry) {
    return Object.entries(entry.files)
        .filter(([file, fingerprint]) => {
        const target = projectPath(projectRoot, file);
        return !fs.existsSync(target) || sha256(fs.readFileSync(target, 'utf8')) !== fingerprint;
    })
        .map(([file]) => file)
        .sort();
}
