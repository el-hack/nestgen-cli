import { loadGenerationManifest, resourceGenerationKey } from './generation-manifest.js';
function migrationName(value) {
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(normalized))
        throw new Error('Nom de migration invalide. Utilisez des minuscules, chiffres et tirets.');
    return normalized;
}
function indexKey(index) {
    return `${index.unique ? 'unique:' : 'index:'}${index.fields.join('+')}`;
}
/** Plan an official ORM migration without generating or applying it. */
export function planResourceMigration(projectRoot, sourceRoot, resourceName, orm, requestedName, fields, indexes, relations) {
    const manifest = loadGenerationManifest(projectRoot);
    const entry = manifest?.generations[resourceGenerationKey(sourceRoot, resourceName)];
    if (!entry || entry.definition.kind !== 'resource')
        throw new Error(`Aucun manifeste de génération pour la ressource ${resourceName}.`);
    const previous = entry.definition;
    if (previous.kind !== 'resource' || entry.definition.orm !== orm)
        throw new Error(`Le manifeste de la ressource ${resourceName} ne correspond pas à l'ORM ${orm}.`);
    const risks = [];
    const previousFields = new Map(previous.fields.map((field) => [field.name, field]));
    const nextFields = new Map(fields.map((field) => [field.name, field]));
    for (const [name, field] of previousFields) {
        const next = nextFields.get(name);
        if (!next) {
            risks.push({
                id: 'COLUMN_REMOVED',
                severity: 'danger',
                message: `Suppression potentielle de la colonne ${name}.`,
            });
            continue;
        }
        if (next.type !== field.type) {
            risks.push({
                id: 'FIELD_TYPE_CHANGED',
                severity: 'danger',
                message: `Changement de type potentiel pour ${name} (${field.type} vers ${next.type}).`,
            });
        }
        if (field.nullable && !next.nullable) {
            risks.push({
                id: 'NULLABILITY_TIGHTENED',
                severity: 'warning',
                message: `${name} devient obligatoire ; les lignes existantes doivent être complétées.`,
            });
        }
    }
    const previousIndexes = new Set(previous.indexes.filter((index) => index.unique).map(indexKey));
    for (const index of indexes.filter((item) => item.unique)) {
        if (!previousIndexes.has(indexKey(index)))
            risks.push({
                id: 'UNIQUE_CONSTRAINT_ADDED',
                severity: 'warning',
                message: `Contrainte unique ajoutée sur ${index.fields.join(', ')} ; vérifiez les doublons existants.`,
            });
    }
    const previousRelations = new Set(previous.relations.map((relation) => `${relation.type}:${relation.target}:${relation.field ?? ''}`));
    const nextRelations = new Set(relations.map((relation) => `${relation.type}:${relation.target}:${relation.field ?? ''}`));
    for (const relation of previousRelations) {
        if (!nextRelations.has(relation))
            risks.push({
                id: 'RELATION_REMOVED',
                severity: 'danger',
                message: `Suppression potentielle de relation ${relation}.`,
            });
    }
    const name = migrationName(requestedName);
    return {
        version: 1,
        orm,
        migrationName: name,
        command: orm === 'typeorm'
            ? `npx typeorm-ts-node-commonjs migration:generate src/database/migrations/${name} --dataSource src/database/data-source.ts`
            : `npx prisma migrate dev --create-only --name ${name}`,
        risks,
        appliesMigration: false,
    };
}
