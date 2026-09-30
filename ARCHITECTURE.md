# Moteur de génération

Les commandes `nestgen module` et `nestgen resource` utilisent le moteur TypeScript compilé dans `dist/engine`. Elles calculent toutes les transformations (dont AppModule, schéma et runtime Prisma) avant la première écriture. Un plan commun explicite les créations et remplacements ; les collisions et chemins invalides sont refusés avant staging.

Le répertoire exclusif `.nestgen-transaction` sert de verrou et contient un manifeste, les nouveaux contenus et les sauvegardes. Chaque fichier est installé par renommage sur le même système de fichiers. Si une opération échoue, les fichiers appliqués sont restaurés dans l'ordre inverse, avec leurs permissions, puis les nouveaux répertoires sont retirés. Les tests injectent des erreurs à chaque étape de création, écriture, changement de permissions et renommage pour les deux générateurs et les deux ORM de module.

Cette restauration couvre les erreurs interceptées du processus ; ce n'est pas une transaction multi-fichier du système d'exploitation. Après un arrêt brutal ou une erreur persistante empêchant la restauration, la génération suivante refuse de remplacer le verrou. Le manifeste associe chaque chemin à son index ; `old-N` contient l'original d'un remplacement. Conserver une copie du répertoire avant récupération, examiner les fichiers concernés et restaurer les originaux avant de retirer le verrou. Une ancienne transaction `.nestgen-transaction.json` bloque également la génération. Si seul le nettoyage final échoue après application complète, le CLI signale le nettoyage nécessaire sans annoncer un échec de génération.

Les entrées utilisateur sont des données de templates et ne sont jamais interpolées dans une commande shell.

Les scripts Bash d’initialisation restent une couche de compatibilité pendant la migration. Ils sont appelés avec des arguments séparés par `spawnSync`, sans shell Node ni interpolation de commande. Le chemin de génération de modules ne les utilise plus.

## Évaluation des Nest schematics

Les schematics Nest sont adaptés à des ressources Nest conventionnelles, mais ne modélisent pas le contrat hexagonal de NestGen (ports, tokens d’injection, CQRS et adaptateurs ORM). Les adopter imposerait des transformations correctives fragiles après génération. Le moteur conserve donc des templates versionnés et une transformation AST ciblée ; il pourra appeler un schematic à l’avenir uniquement pour une cible compatible, derrière une interface de processus sans shell.
