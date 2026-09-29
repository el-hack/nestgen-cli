import fs from 'node:fs';

const [appModulePath, moduleClass, modulePath, orm] = process.argv.slice(2);

function fail(message) {
    throw new Error(`Impossible de mettre à jour AppModule : ${message}`);
}

function findMatching(source, start, open, close) {
    let depth = 0;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;

    for (let index = start; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];

        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (!escaped && character === quote) quote = null;
            escaped = !escaped && character === '\\';
            if (character !== '\\') escaped = false;
            continue;
        }
        if (character === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (character === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            continue;
        }
        if (character === open) depth += 1;
        if (character === close) {
            depth -= 1;
            if (depth === 0) return index;
        }
    }

    fail(`délimiteur ${open}${close} non fermé.`);
}

function findDecoratorObject(source) {
    const decoratorMatch = /@Module\s*\(/.exec(source);
    if (!decoratorMatch) fail('décorateur @Module introuvable.');

    const objectStart = source.indexOf('{', decoratorMatch.index + decoratorMatch[0].length);
    if (objectStart === -1) fail('objet du décorateur @Module introuvable.');

    return {
        start: objectStart,
        end: findMatching(source, objectStart, '{', '}'),
    };
}

function findImportsArray(source, object) {
    const propertyPattern = /\bimports\s*:\s*\[/g;
    let match;

    while ((match = propertyPattern.exec(source)) !== null) {
        if (match.index > object.end) break;
        const before = source.slice(object.start + 1, match.index);
        let depth = 0;
        for (const character of before) {
            if (character === '{') depth += 1;
            if (character === '}') depth -= 1;
        }
        if (depth !== 0) continue;

        const arrayStart = match.index + match[0].lastIndexOf('[');
        return { start: arrayStart, end: findMatching(source, arrayStart, '[', ']') };
    }

    fail('tableau imports dans @Module introuvable ou non supporté.');
}

function containsToken(items, token) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(items);
}

function appendImports(source, array, additions) {
    if (additions.length === 0) return source;

    const current = source.slice(array.start + 1, array.end);
    const separator = current.trim() === '' ? '' : current.trimEnd().endsWith(',') ? '\n' : ',\n';
    const indentation = current.includes('\n') ? (current.match(/\n([ \t]*)[^\n]*$/)?.[1] ?? '    ') : '';
    const inserted = additions.map((item) => `${indentation}${item}`).join(',\n');
    const replacement =
        current.trim() === ''
            ? current.includes('\n')
                ? `\n${inserted}\n  `
                : inserted
            : `${current}${separator}${inserted}`;

    return `${source.slice(0, array.start + 1)}${replacement}${source.slice(array.end)}`;
}

function addImport(source, line) {
    return source.includes(line) ? source : `${line}\n${source}`;
}

try {
    let source = fs.readFileSync(appModulePath, 'utf8');
    const object = findDecoratorObject(source);
    const array = findImportsArray(source, object);
    const currentImports = source.slice(array.start + 1, array.end);
    const additions = [];

    if (!containsToken(currentImports, 'CqrsModule')) additions.push('CqrsModule');
    if (!containsToken(currentImports, moduleClass)) additions.push(moduleClass);
    if (orm === 'typeorm' && !/\bTypeOrmModule\.forRoot(?:Async)?\s*\(/.test(currentImports)) {
        additions.unshift('TypeOrmModule.forRootAsync({ useFactory: typeOrmOptions })');
    }

    source = appendImports(source, array, additions);
    source = addImport(source, `import { ${moduleClass} } from '${modulePath}';`);
    source = addImport(source, "import { CqrsModule } from '@nestjs/cqrs';");
    if (orm === 'typeorm') {
        source = addImport(source, "import { typeOrmOptions } from './database/typeorm.config';");
        source = addImport(source, "import { TypeOrmModule } from '@nestjs/typeorm';");
    }

    fs.writeFileSync(appModulePath, source);
} catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
}
