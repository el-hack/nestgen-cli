# Moteur de génération

La commande `nestgen module` utilise le moteur TypeScript compilé dans `dist/engine`. Il valide le projet, construit les fichiers dans un répertoire de staging, analyse `AppModule` avec le compilateur TypeScript, puis applique l’enregistrement du module. Une transaction `.nestgen-transaction.json` rend une interruption visible ; une génération ultérieure refuse d’écraser cet état sans intervention explicite. Les entrées utilisateur sont des données de templates et ne sont jamais interpolées dans une commande shell.

Les scripts Bash d’initialisation restent une couche de compatibilité pendant la migration. Ils sont appelés avec des arguments séparés par `spawnSync`, sans shell Node ni interpolation de commande. Le chemin de génération de modules ne les utilise plus.

## Évaluation des Nest schematics

Les schematics Nest sont adaptés à des ressources Nest conventionnelles, mais ne modélisent pas le contrat hexagonal de NestGen (ports, tokens d’injection, CQRS et adaptateurs ORM). Les adopter imposerait des transformations correctives fragiles après génération. Le moteur conserve donc des templates versionnés et une transformation AST ciblée ; il pourra appeler un schematic à l’avenir uniquement pour une cible compatible, derrière une interface de processus sans shell.
