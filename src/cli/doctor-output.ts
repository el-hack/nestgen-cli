import chalk from 'chalk';

export type Diagnostic = {
    id: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    cause: string;
    action: string;
    detail?: string;
};

/** Human-readable presentation only; structured diagnostics remain unchanged. */
export function formatDoctorOutput(
    diagnostics: Diagnostic[],
    options: { quiet?: boolean; verbose?: boolean } = {},
): string {
    const groups = [
        { severity: 'ERROR', title: 'À corriger', marker: '✖', color: chalk.red },
        { severity: 'WARNING', title: 'À vérifier', marker: '⚠', color: chalk.yellow },
        { severity: 'INFO', title: 'Vérifications', marker: '✓', color: chalk.green },
    ] as const;
    const lines: string[] = options.quiet
        ? []
        : [
              '',
              `  ${chalk.cyan.bold('◆ NestGen')} ${chalk.bold('Doctor')}`,
              chalk.dim('  Diagnostic de votre environnement'),
              '',
          ];
    for (const group of groups) {
        if (options.quiet && group.severity === 'INFO') continue;
        const entries = diagnostics.filter((diagnostic) => diagnostic.severity === group.severity);
        if (!entries.length) continue;
        if (!options.quiet) lines.push(`  ${group.color.bold(group.title)} ${chalk.dim(`(${entries.length})`)}`, '');
        for (const diagnostic of entries) {
            lines.push(`  ${group.color(group.marker)} ${diagnostic.cause}`);
            if (diagnostic.severity !== 'INFO' || (diagnostic.id === 'NESTGEN_CONFIG' && !diagnostic.detail))
                lines.push(`    → ${diagnostic.action}`);
            if (options.verbose) {
                lines.push(chalk.dim(`    Code : ${diagnostic.id}`));
                if (diagnostic.detail) lines.push(chalk.dim(`    Détail : ${diagnostic.detail}`));
            }
        }
        if (!options.quiet) lines.push('');
    }
    if (!options.quiet) {
        const count = (severity: Diagnostic['severity']) =>
            diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
        const errors = count('ERROR');
        const warnings = count('WARNING');
        lines.push(
            chalk.dim('  ────────────────────────────────────────'),
            `  ${errors ? chalk.red.bold('✖ Des corrections sont nécessaires') : warnings ? chalk.yellow.bold('⚠ Quelques points à vérifier') : chalk.green.bold('✓ Votre environnement est prêt')}`,
            `  ${chalk.red(`${errors} erreur${errors > 1 ? 's' : ''}`)}  ·  ${chalk.yellow(`${warnings} avertissement${warnings > 1 ? 's' : ''}`)}  ·  ${chalk.dim(`${count('INFO')} vérifications`)}`,
            '',
        );
    }
    return lines.join('\n');
}
