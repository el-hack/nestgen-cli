const namePattern = /^[a-z][a-z0-9]*$/i;
const resourceNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i;
const enumValuePattern = /^[A-Z][A-Z0-9_]*$/;
const basicTypes = new Set(['string', 'number', 'integer', 'boolean', 'date', 'uuid']);
function parseType(rawType, value) {
    const basicType = rawType.toLowerCase();
    if (basicTypes.has(basicType))
        return { type: basicType };
    const decimal = /^decimal\((\d+);(\d+)\)$/i.exec(rawType);
    if (decimal) {
        const precision = Number(decimal[1]);
        const scale = Number(decimal[2]);
        if (precision < 1 || precision > 1000 || scale > precision)
            throw new Error(`Précision décimale invalide : ${value}. La précision doit être entre 1 et 1000, et l'échelle ne peut pas la dépasser.`);
        return { type: 'decimal', precision, scale };
    }
    const enumeration = /^enum\(([^)]+)\)$/i.exec(rawType);
    if (enumeration) {
        const enumValues = enumeration[1].split('|');
        if (enumValues.some((entry) => !enumValuePattern.test(entry)) || new Set(enumValues).size !== enumValues.length)
            throw new Error(`Enum invalide : ${value}. Les valeurs doivent être uniques, en MAJUSCULES, et séparées par |.`);
        return { type: 'enum', enumValues };
    }
    throw new Error(`Champ invalide : ${value}. Format attendu : nom:type, decimal(précision;échelle) ou enum(VALEUR|VALEUR), avec ? (nullable) ou ! (unique).`);
}
function parsePositiveInteger(value, label, field) {
    if (!/^\d+$/.test(value) || Number(value) < 1)
        throw new Error(`${label} invalide pour ${field}. Une valeur entière strictement positive est requise.`);
    return Number(value);
}
function parseNumber(value, label, field) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        throw new Error(`${label} invalide pour ${field}. Une valeur numérique finie est requise.`);
    return parsed;
}
function parseDefaultValue(raw, field, value) {
    if (field.type === 'boolean') {
        if (raw !== 'true' && raw !== 'false')
            throw new Error(`Valeur par défaut invalide : ${value}.`);
        return raw === 'true';
    }
    if (field.type === 'integer') {
        const parsed = parseNumber(raw, 'Valeur par défaut', value);
        if (!Number.isInteger(parsed))
            throw new Error(`Valeur par défaut invalide : ${value}. Un entier est requis.`);
        return parsed;
    }
    if (field.type === 'number')
        return parseNumber(raw, 'Valeur par défaut', value);
    if (field.type === 'decimal') {
        if (!/^-?\d+(?:\.\d+)?$/.test(raw))
            throw new Error(`Valeur par défaut invalide : ${value}. Un décimal est requis.`);
        const [, fraction = ''] = raw.split('.');
        if (fraction.length > field.scale || raw.replace(/[-.]/g, '').length > field.precision)
            throw new Error(`Valeur par défaut invalide : ${value}. Elle dépasse decimal(${field.precision};${field.scale}).`);
        return raw;
    }
    if (field.type === 'enum') {
        if (!field.enumValues.includes(raw))
            throw new Error(`Valeur par défaut invalide : ${value}.`);
        return raw;
    }
    if (field.type === 'string') {
        if (!/^[\p{L}\p{N} _.-]+$/u.test(raw))
            throw new Error(`Valeur par défaut invalide : ${value}.`);
        return raw;
    }
    throw new Error(`Les valeurs par défaut ne sont pas supportées pour le type ${field.type}.`);
}
function parseConstraints(raw, field, value) {
    if (!raw)
        return {};
    const constraints = {};
    for (const entry of raw.split(';')) {
        const [key, rawValue] = entry.split('=', 2);
        if (!key || (rawValue === undefined && key !== 'index'))
            throw new Error(`Contrainte invalide : ${value}.`);
        if (key === 'index') {
            if (rawValue !== undefined || constraints.indexed)
                throw new Error(`Contrainte invalide : ${value}.`);
            constraints.indexed = true;
            continue;
        }
        if (!rawValue || ['length', 'min', 'max', 'default'].includes(key) === false)
            throw new Error(`Contrainte invalide : ${value}.`);
        if (key === 'length') {
            if (field.type !== 'string' || constraints.length !== undefined)
                throw new Error(`La contrainte length est réservée aux chaînes : ${value}.`);
            constraints.length = parsePositiveInteger(rawValue, 'Longueur', value);
        }
        else if (key === 'min' || key === 'max') {
            if (field.type !== 'number' && field.type !== 'integer')
                throw new Error(`La contrainte ${key} est réservée aux nombres : ${value}.`);
            if (constraints[key] !== undefined)
                throw new Error(`Contrainte ${key} déclarée plusieurs fois : ${value}.`);
            constraints[key] = parseNumber(rawValue, key === 'min' ? 'Borne minimale' : 'Borne maximale', value);
        }
        else {
            if (constraints.defaultValue !== undefined)
                throw new Error(`Valeur par défaut déclarée plusieurs fois : ${value}.`);
            constraints.defaultValue = parseDefaultValue(rawValue, field, value);
        }
    }
    if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max)
        throw new Error(`Bornes incohérentes : ${value}. min ne peut pas dépasser max.`);
    if (constraints.length !== undefined &&
        typeof constraints.defaultValue === 'string' &&
        constraints.defaultValue.length > constraints.length)
        throw new Error(`Valeur par défaut trop longue : ${value}.`);
    return constraints;
}
export function parseResourceFields(values) {
    const names = new Set();
    const fields = values.map((value) => {
        const match = /^([^:]+):(.+?)(?:\{([^{}]+)\})?(\?)?(!)?$/.exec(value.trim());
        if (!match)
            throw new Error(`Champ invalide : ${value}. Format attendu : nom:type, avec ? (nullable) ou ! (unique).`);
        const [, rawName, rawType, rawConstraints, optional, unique] = match;
        if (!namePattern.test(rawName))
            throw new Error(`Nom de champ invalide : ${rawName}.`);
        const name = `${rawName[0].toLowerCase()}${rawName.slice(1)}`;
        if (name === 'id')
            throw new Error('Le champ id est géré par NestGen et ne doit pas être déclaré.');
        if (names.has(name))
            throw new Error(`Le champ ${name} est déclaré plusieurs fois.`);
        names.add(name);
        const field = {
            name,
            ...parseType(rawType, value),
            nullable: Boolean(optional),
            unique: Boolean(unique),
        };
        const constraints = parseConstraints(rawConstraints, field, value);
        if (field.nullable && constraints.defaultValue !== undefined)
            throw new Error(`Un champ nullable ne peut pas définir de valeur par défaut : ${value}.`);
        return { ...field, ...constraints };
    });
    if (!fields.length)
        throw new Error('Une ressource requiert au moins un champ métier.');
    return fields;
}
export function parseResourceIndexes(values, fields, uniqueValues = []) {
    const knownFields = new Set(fields.map((field) => field.name));
    const indexes = [
        ...fields.filter((field) => field.indexed).map((field) => ({ fields: [field.name], unique: false })),
        ...values.map((value) => ({ fields: value.trim().split('+'), unique: false })),
        ...uniqueValues.map((value) => ({ fields: value.trim().split('+'), unique: true })),
    ];
    const seen = new Set();
    return indexes.map((index) => {
        if (index.fields.length === 0 ||
            index.fields.some((field) => !namePattern.test(field) || !knownFields.has(field)))
            throw new Error(`Index invalide : ${index.fields.join('+')}. Chaque champ doit être déclaré dans la ressource.`);
        if (new Set(index.fields).size !== index.fields.length)
            throw new Error(`Index invalide : ${index.fields.join('+')}. Un champ est répété.`);
        const key = index.fields.join('+');
        if (seen.has(key))
            throw new Error(`Index déclaré plusieurs fois : ${key}.`);
        seen.add(key);
        return index.unique ? { fields: index.fields, unique: true } : { fields: index.fields };
    });
}
export function parseResourceRelations(values) {
    const seenFields = new Set();
    return values.map((value, index) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error(`Relation invalide à l'index ${index}. Un objet est requis.`);
        const relation = value;
        if (relation.type !== 'belongsTo' && relation.type !== 'manyToMany')
            throw new Error(`Relation invalide à l'index ${index}. Les types belongsTo et manyToMany sont supportés.`);
        if (typeof relation.target !== 'string' || !resourceNamePattern.test(relation.target))
            throw new Error(`Relation invalide à l'index ${index}. target doit être un nom de ressource valide.`);
        if (relation.field !== undefined && (typeof relation.field !== 'string' || !namePattern.test(relation.field)))
            throw new Error(`Relation invalide à l'index ${index}. field doit être un identifiant valide.`);
        if (relation.inverse !== undefined &&
            (typeof relation.inverse !== 'string' || !namePattern.test(relation.inverse)))
            throw new Error(`Relation invalide à l'index ${index}. inverse doit être un identifiant valide.`);
        if (relation.nullable !== undefined && typeof relation.nullable !== 'boolean')
            throw new Error(`Relation invalide à l'index ${index}. nullable doit être un booléen.`);
        if (relation.onDelete !== undefined && relation.onDelete !== 'RESTRICT' && relation.onDelete !== 'SET NULL')
            throw new Error(`Relation invalide à l'index ${index}. onDelete accepte RESTRICT ou SET NULL.`);
        if (relation.type === 'manyToMany' && (relation.nullable !== undefined || relation.onDelete !== undefined))
            throw new Error(`Relation invalide à l'index ${index}. manyToMany ne définit ni nullable ni onDelete.`);
        const nullable = relation.nullable ?? false;
        const onDelete = relation.onDelete ?? 'RESTRICT';
        if (onDelete === 'SET NULL' && !nullable)
            throw new Error(`Relation invalide à l'index ${index}. SET NULL requiert nullable: true.`);
        const target = relation.target.toLowerCase();
        const field = relation.field ? `${relation.field[0].toLowerCase()}${relation.field.slice(1)}` : undefined;
        if (field && seenFields.has(field))
            throw new Error(`Relation invalide à l'index ${index}. Le champ ${field} est déclaré plusieurs fois.`);
        if (field)
            seenFields.add(field);
        return {
            type: relation.type,
            target,
            field,
            inverse: relation.inverse ? `${relation.inverse[0].toLowerCase()}${relation.inverse.slice(1)}` : undefined,
            nullable,
            onDelete,
        };
    });
}
export function typescriptType(field) {
    return field.type === 'number' || field.type === 'integer'
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
        : field.type === 'integer'
            ? 'Int'
            : field.type === 'decimal'
                ? 'Decimal'
                : field.type === 'boolean'
                    ? 'Boolean'
                    : field.type === 'date'
                        ? 'DateTime'
                        : 'String';
    return `${type}${field.nullable ? '?' : ''}${field.unique ? ' @unique' : ''}`;
}
