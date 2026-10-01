const RESOURCE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/i;
const ROUTE_PATTERN = /^[a-z][a-z0-9-]*$/;
const TABLE_PATTERN = /^[a-z][a-z0-9_]*$/;

function fail(message) {
    throw new Error(`Nom de ressource invalide : ${message}`);
}

function pluralize(word) {
    if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
    if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
    return `${word}s`;
}

export function describeResource(rawName, options = {}) {
    const name = String(rawName ?? '').trim();
    if (!RESOURCE_NAME_PATTERN.test(name)) {
        fail('il doit commencer par une lettre et ne contenir que des lettres, chiffres, tirets ou underscores.');
    }

    const segments = name.toLowerCase().split(/[-_]/);
    const singular = segments.join('-');
    const plural = options.plural
        ? String(options.plural).trim().toLowerCase()
        : `${segments.slice(0, -1).join('-')}${segments.length > 1 ? '-' : ''}${pluralize(segments.at(-1))}`;
    const route = options.route ? String(options.route).trim().toLowerCase() : plural;
    const table = options.table ? String(options.table).trim().toLowerCase() : plural.replaceAll('-', '_');

    if (!ROUTE_PATTERN.test(plural)) fail('le pluriel doit être une ressource kebab-case.');
    if (!ROUTE_PATTERN.test(route)) fail('la route doit être une ressource kebab-case.');
    if (!TABLE_PATTERN.test(table)) fail('la table doit être une ressource snake_case.');

    const pascal = segments.map((segment) => `${segment[0].toUpperCase()}${segment.slice(1)}`).join('');
    return {
        name: singular,
        pascal,
        camel: `${pascal[0].toLowerCase()}${pascal.slice(1)}`,
        plural,
        route,
        table,
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        const [rawName] = process.argv.slice(2);
        const resource = describeResource(rawName, {
            plural: process.env.RESOURCE_PLURAL,
            route: process.env.RESOURCE_ROUTE,
            table: process.env.RESOURCE_TABLE,
        });
        for (const [key, value] of Object.entries(resource)) console.log(`${key.toUpperCase()}=${value}`);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exitCode = 1;
    }
}
