import fs from 'node:fs';
import path from 'node:path';

export type FileChange = { path: string; content: string; operation: 'create' | 'replace' };
const transactionDirectory = '.nestgen-transaction';

/** Apply a fully validated plan; roll back all applied files when a filesystem operation fails. */
export function applyFileChanges(projectRoot: string, changes: FileChange[]): void {
    const root = fs.realpathSync(projectRoot);
    const stage = path.join(root, transactionDirectory);
    const targets = new Set<string>();
    const plan = changes.map((change, index) => {
        const target = path.resolve(root, change.path);
        const relative = path.relative(root, target);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
            throw new Error(`Destination hors projet : ${change.path}`);
        if (relative.split(path.sep)[0].startsWith('.nestgen-transaction'))
            throw new Error(`Destination réservée : ${change.path}`);
        if (targets.has(target)) throw new Error(`Destination dupliquée : ${change.path}`);
        targets.add(target);
        let current = root;
        for (const part of relative.split(path.sep)) {
            current = path.join(current, part);
            const stat = fs.lstatSync(current, { throwIfNoEntry: false });
            if (stat?.isSymbolicLink()) throw new Error(`Lien symbolique non supporté : ${current}`);
            if (stat && current !== target && !stat.isDirectory()) throw new Error(`Répertoire attendu : ${current}`);
        }
        const stat = fs.lstatSync(target, { throwIfNoEntry: false });
        if (change.operation === 'create' && stat) throw new Error(`Le fichier existe déjà : ${change.path}`);
        if (change.operation === 'replace' && !stat?.isFile())
            throw new Error(`Fichier à remplacer introuvable : ${change.path}`);
        return {
            ...change,
            target,
            original: stat ? fs.readFileSync(target) : undefined,
            mode: stat ? stat.mode & 0o777 : 0o666 & ~process.umask(),
            prepared: path.join(stage, `new-${index}`),
            backup: path.join(stage, `old-${index}`),
        };
    });
    for (const item of plan) {
        let parent = path.dirname(item.target);
        while (parent !== root) {
            if (targets.has(parent)) throw new Error(`Conflit fichier/répertoire : ${parent}`);
            parent = path.dirname(parent);
        }
    }
    if (fs.existsSync(path.join(root, '.nestgen-transaction.json')))
        throw new Error('Transaction interrompue détectée : .nestgen-transaction.json.');
    // mkdir without recursive is an exclusive lock; never remove a lock owned by another invocation.
    fs.mkdirSync(stage);
    const directories: string[] = [];
    const applied: typeof plan = [];
    let retainBackups = false;
    let committed = false;
    try {
        fs.writeFileSync(
            path.join(stage, 'manifest.json'),
            JSON.stringify(plan.map(({ path: file, operation, mode }, index) => ({ file, operation, mode, index }))),
        );
        for (const item of plan) {
            fs.writeFileSync(item.prepared, item.content, { flag: 'wx', mode: item.mode });
            fs.chmodSync(item.prepared, item.mode);
            if (item.original !== undefined) {
                fs.writeFileSync(item.backup, item.original, { flag: 'wx', mode: item.mode });
                fs.chmodSync(item.backup, item.mode);
            }
        }
        for (const item of plan) {
            const missing: string[] = [];
            let parent = path.dirname(item.target);
            while (!fs.existsSync(parent)) {
                missing.push(parent);
                parent = path.dirname(parent);
            }
            for (const directory of missing.reverse()) {
                fs.mkdirSync(directory);
                directories.push(directory);
            }
            if (item.original !== undefined) {
                if (!fs.readFileSync(item.target).equals(item.original))
                    throw new Error(`Le fichier a changé pendant la génération : ${item.path}`);
            } else if (fs.existsSync(item.target)) {
                throw new Error(`Le fichier est apparu pendant la génération : ${item.path}`);
            }
            fs.renameSync(item.prepared, item.target);
            applied.push(item);
        }
        committed = true;
    } catch (error) {
        const failures: unknown[] = [];
        for (const item of applied.reverse()) {
            try {
                if (item.original !== undefined) fs.renameSync(item.backup, item.target);
                else fs.unlinkSync(item.target);
            } catch (rollbackError) {
                failures.push(rollbackError);
            }
        }
        for (const directory of directories.reverse()) {
            try {
                fs.rmdirSync(directory);
            } catch (rollbackError) {
                failures.push(rollbackError);
            }
        }
        if (failures.length) {
            retainBackups = true;
            throw new AggregateError(
                [error, ...failures],
                `Restauration incomplète ; sauvegardes conservées : ${stage}`,
            );
        }
        throw error;
    } finally {
        if (!retainBackups) {
            try {
                fs.rmSync(stage, { recursive: true, force: true });
            } catch (cleanupError) {
                if (!committed) throw cleanupError;
                // The complete plan is already committed. Never report a failed generation after that point.
                console.warn(`Génération terminée ; nettoyage manuel nécessaire : ${stage}`, cleanupError);
            }
        }
    }
}
