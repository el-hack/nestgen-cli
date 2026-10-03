import chalk from 'chalk';
export function heading(title, subtitle) {
    return `\n  ${chalk.cyan.bold('◆ NestGen')} ${chalk.bold(title)}\n${subtitle ? `${chalk.dim(`  ${subtitle}`)}\n` : ''}`;
}
export function success(message) {
    return `\n  ${chalk.green('✓')} ${chalk.bold(message)}\n`;
}
export function formatError(message) {
    return `${heading('Erreur')}  ${chalk.red('✖')} ${message.split('\n').join('\n    ')}\n`;
}
export function formatConfig(config, subtitle) {
    const rows = [
        ['ORM', config.orm],
        ['Architecture', config.profile],
        ['Sources', config.sourceRoot],
        ['Package manager', config.packageManager],
        ['Version configuration', config.version],
        ['Version templates', config.templateVersion],
    ];
    return `${heading('Configuration', subtitle)}${rows.map(([label, value]) => `  ${chalk.dim(label.padEnd(24))}${value}`).join('\n')}\n`;
}
export function formatMigration(migration) {
    return [
        `  ${chalk.bold('Migration à préparer')}`,
        `    ${chalk.cyan(migration.command)}`,
        chalk.dim('    Cette commande prépare la migration ; aucune migration appliquée.'),
        ...migration.risks.map((risk) => `    ${risk.severity === 'danger' ? chalk.red('✖') : chalk.yellow('⚠')} ${risk.message}`),
        '',
    ].join('\n');
}
export function formatPlan(plan, verbose = false) {
    const lines = [heading('Aperçu', `Génération ${plan.operation} · aucun fichier écrit`)];
    for (const change of plan.changes) {
        const label = change.status === 'create'
            ? chalk.green('+ Créer')
            : change.status === 'replace'
                ? chalk.cyan('~ Modifier')
                : chalk.red('✖ Conflit');
        lines.push(`  ${label}  ${change.path}`);
        if (change.reason)
            lines.push(`    ${chalk.yellow(change.reason)}`);
        if (verbose && change.diff)
            lines.push(chalk.dim(`    ${change.diff.split('\n').join('\n    ')}`));
    }
    for (const conflict of plan.conflicts.filter((conflict) => !conflict.path))
        lines.push(`  ${chalk.red('✖')} ${conflict.reason}`);
    lines.push('', chalk.dim('  ────────────────────────────────────────'), `  ${plan.changes.length} fichiers · ${plan.conflicts.length} conflits`, '');
    if (plan.migration)
        lines.push(formatMigration(plan.migration));
    return lines.join('\n');
}
/** Align help columns from the complete existing command/option descriptions. */
export function formatHelp(usage) {
    return `${heading('Aide')}${usage
        .split('\n')
        .map((line) => {
        if (!line)
            return '';
        if (!line.startsWith(' '))
            return `  ${chalk.bold(line)}`;
        const [label, description] = line.trim().split(/\s{2,}/);
        return description ? `  ${chalk.cyan(label.padEnd(34))}  ${description}` : `  ${line.trim()}`;
    })
        .join('\n')}\n`;
}
