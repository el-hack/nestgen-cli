import fs from 'node:fs';
import path from 'node:path';
/** Resolve a path inside a canonical project root, without following child symlinks. */
export function projectPath(root, relativePath) {
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error(`Destination hors projet : ${relativePath}`);
    let current = root;
    for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        const stat = fs.lstatSync(current, { throwIfNoEntry: false });
        if (stat?.isSymbolicLink())
            throw new Error(`Lien symbolique non supporté : ${current}`);
        if (stat && current !== target && !stat.isDirectory())
            throw new Error(`Répertoire attendu : ${current}`);
    }
    return target;
}
export function availableFeatureDirectory(root, name, sourceRoot = 'src') {
    const directory = projectPath(root, `${sourceRoot}/app/${name}`);
    if (fs.lstatSync(directory, { throwIfNoEntry: false }))
        throw new Error(`Le module ou la ressource ${name} existe déjà.`);
    return directory;
}
