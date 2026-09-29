import fs from 'node:fs';
import path from 'node:path';
import { ResourceField, prismaType, typescriptType } from './resource-spec.js';

type Options = { name: string; fields: ResourceField[]; route: string; table: string };

function pascal(value: string): string {
    return value
        .split('-')
        .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
        .join('');
}

function entityFields(fields: ResourceField[]): string {
    return fields
        .map((field) => `    public ${field.name}: ${typescriptType(field)}${field.nullable ? ' | null' : ''},`)
        .join('\n');
}

function dtoFields(fields: ResourceField[]): string {
    return fields
        .map(
            (field) =>
                `    ${field.name}${field.nullable ? '?' : ''}: ${typescriptType(field)}${field.nullable ? ' | null' : ''};`,
        )
        .join('\n');
}

export function generateResource(projectRoot: string, options: Options): void {
    const name = options.name.toLowerCase();
    const className = pascal(name);
    const directory = path.join(projectRoot, 'src', 'app', name);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Nom de ressource invalide.');
    if (fs.existsSync(directory)) throw new Error(`La ressource ${name} existe déjà.`);
    fs.mkdirSync(path.join(directory, 'domain'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'dto'), { recursive: true });
    fs.mkdirSync(path.join(directory, 'persistence'), { recursive: true });
    fs.writeFileSync(
        path.join(directory, 'domain', `${name}.ts`),
        `export class ${className} {\n  constructor(\n    public readonly id: string,\n${entityFields(options.fields)}\n  ) {}\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'dto', `create-${name}.dto.ts`),
        `export class Create${className}Dto {\n${dtoFields(options.fields)}\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'persistence', `${name}.prisma`),
        `model ${className} {\n  id String @id @default(uuid())\n${options.fields.map((field) => `  ${field.name} ${prismaType(field)}`).join('\n')}\n\n  @@map("${options.table}")\n}\n`,
    );
    fs.writeFileSync(
        path.join(directory, 'resource.json'),
        `${JSON.stringify({ name, route: options.route, table: options.table, fields: options.fields }, null, 2)}\n`,
    );
}
