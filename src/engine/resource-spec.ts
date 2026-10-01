export type ScalarType = 'string' | 'number' | 'integer' | 'decimal' | 'boolean' | 'date' | 'uuid' | 'enum';

export type ResourceField = {
    name: string;
    type: ScalarType;
    nullable: boolean;
    unique: boolean;
    precision?: number;
    scale?: number;
    enumValues?: string[];
};

const namePattern = /^[a-z][a-z0-9]*$/i;
const enumValuePattern = /^[A-Z][A-Z0-9_]*$/;
const basicTypes = new Set<ScalarType>(['string', 'number', 'integer', 'boolean', 'date', 'uuid']);

function parseType(rawType: string, value: string): Pick<ResourceField, 'type' | 'precision' | 'scale' | 'enumValues'> {
    const basicType = rawType.toLowerCase() as ScalarType;
    if (basicTypes.has(basicType)) return { type: basicType };

    const decimal = /^decimal\((\d+);(\d+)\)$/i.exec(rawType);
    if (decimal) {
        const precision = Number(decimal[1]);
        const scale = Number(decimal[2]);
        if (precision < 1 || precision > 1000 || scale > precision)
            throw new Error(
                `Précision décimale invalide : ${value}. La précision doit être entre 1 et 1000, et l'échelle ne peut pas la dépasser.`,
            );
        return { type: 'decimal', precision, scale };
    }

    const enumeration = /^enum\(([^)]+)\)$/i.exec(rawType);
    if (enumeration) {
        const enumValues = enumeration[1].split('|');
        if (enumValues.some((entry) => !enumValuePattern.test(entry)) || new Set(enumValues).size !== enumValues.length)
            throw new Error(
                `Enum invalide : ${value}. Les valeurs doivent être uniques, en MAJUSCULES, et séparées par |.`,
            );
        return { type: 'enum', enumValues };
    }

    throw new Error(
        `Champ invalide : ${value}. Format attendu : nom:type, decimal(précision;échelle) ou enum(VALEUR|VALEUR), avec ? (nullable) ou ! (unique).`,
    );
}

export function parseResourceFields(values: string[]): ResourceField[] {
    const names = new Set<string>();
    const fields = values.map((value) => {
        const match = /^([^:]+):(.+?)(\?)?(!)?$/.exec(value.trim());
        if (!match)
            throw new Error(`Champ invalide : ${value}. Format attendu : nom:type, avec ? (nullable) ou ! (unique).`);
        const [, rawName, rawType, optional, unique] = match;
        if (!namePattern.test(rawName)) throw new Error(`Nom de champ invalide : ${rawName}.`);
        const name = `${rawName[0].toLowerCase()}${rawName.slice(1)}`;
        if (name === 'id') throw new Error('Le champ id est géré par NestGen et ne doit pas être déclaré.');
        if (names.has(name)) throw new Error(`Le champ ${name} est déclaré plusieurs fois.`);
        names.add(name);
        return {
            name,
            ...parseType(rawType, value),
            nullable: Boolean(optional),
            unique: Boolean(unique),
        };
    });
    if (!fields.length) throw new Error('Une ressource requiert au moins un champ métier.');
    return fields;
}

export function typescriptType(field: ResourceField): string {
    return field.type === 'number' || field.type === 'integer'
        ? 'number'
        : field.type === 'boolean'
          ? 'boolean'
          : field.type === 'date'
            ? 'Date'
            : 'string';
}

export function prismaType(field: ResourceField): string {
    const type =
        field.type === 'number'
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
