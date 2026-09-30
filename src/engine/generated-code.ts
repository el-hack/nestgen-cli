import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import type { FileChange } from './file-transaction.js';

/** Format newly generated TypeScript in memory before the transaction can write anything. */
export async function formatGeneratedCode(root: string, changes: FileChange[]): Promise<FileChange[]> {
    const result: FileChange[] = [];
    for (const change of changes) {
        // Existing shared files contain user formatting; their targeted edits must stay targeted.
        if (change.operation !== 'create' || !change.path.endsWith('.ts')) {
            result.push(change);
            continue;
        }
        const filepath = path.join(root, change.path);
        const options = await resolveConfig(filepath, { editorconfig: true, useCache: false });
        result.push({
            ...change,
            content: await format(change.content, {
                singleQuote: true,
                trailingComma: 'all',
                ...options,
                filepath,
                parser: 'typescript',
            }),
        });
    }
    return result;
}
