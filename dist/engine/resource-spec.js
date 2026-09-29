const fieldPattern = /^([a-z][a-z0-9]*):(string|number|boolean|date|uuid)(\?)?(!)?$/i;
export function parseResourceFields(values) {
    const names = new Set();
    const fields = values.map((value) => {
        const match = fieldPattern.exec(value.trim());
        if (!match)
            throw new Error(`Champ invalide : ${value}. Format attendu : nom:type, avec ? (nullable) ou ! (unique).`);
        const [, rawName, rawType, optional, unique] = match;
        const name = `${rawName[0].toLowerCase()}${rawName.slice(1)}`;
        if (name === 'id')
            throw new Error('Le champ id est géré par NestGen et ne doit pas être déclaré.');
        if (names.has(name))
            throw new Error(`Le champ ${name} est déclaré plusieurs fois.`);
        names.add(name);
        return {
            name,
            type: rawType.toLowerCase(),
            nullable: Boolean(optional),
            unique: Boolean(unique),
        };
    });
    if (!fields.length)
        throw new Error('Une ressource requiert au moins un champ métier.');
    return fields;
}
export function typescriptType(field) {
    return field.type === 'number'
        ? 'number'
        : field.type === 'boolean'
            ? 'boolean'
            : field.type === 'date'
                ? 'Date'
                : 'string';
}
export function prismaType(field) {
    const type = field.type === 'number'
        ? 'Float'
        : field.type === 'boolean'
            ? 'Boolean'
            : field.type === 'date'
                ? 'DateTime'
                : 'String';
    return `${type}${field.nullable ? '?' : ''}${field.unique ? ' @unique' : ''}`;
}
