# Matrice de compatibilité

Les versions sont choisies pour le générateur Nest 12. Elles sont volontairement déclarées dans les scripts afin qu’une génération ne suive pas le tag mutable `latest`.

| Élément              | Version ou combinaison supportée                                         |
| -------------------- | ------------------------------------------------------------------------ |
| Node.js pour générer | `>=24.15.0 <27` (lignes 24, 25 et 26)                                    |
| Nest CLI temporaire  | `@nestjs/cli@12.0.0`, exécutée localement avec le package manager choisi |
| Nest et extensions   | Nest 12, `@nestjs/config@4`, `@nestjs/typeorm@12`, `@nestjs/swagger@12`  |
| ORM                  | TypeORM `0.3` ou Prisma `6.19`                                           |
| Package manager      | npm 11, pnpm 10, Yarn Berry 4                                            |
| Systèmes             | macOS et Linux ; Windows avec WSL2                                       |

Le générateur n’installe jamais Nest CLI globalement. Il passe par `npx`, `pnpm dlx` ou `yarn dlx` selon le choix initial, puis installe les dépendances avec ce même gestionnaire. Le lockfile créé par Nest reste donc celui qui pilote les installations ultérieures.

## Couverture automatisée

La CI est le contrat exécutable de cette matrice. Elle ne publie aucune release tant qu’un de ces parcours échoue :

| Parcours         | Environnements exécutés                         | Ce qui est vérifié                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrat CLI      | Ubuntu avec Node `24.15.0`, `25.x` et `26.x`    | Lint, formatage et tests de génération.                                                                                                                                                                                                            |
| Systèmes         | macOS avec Node `24.15.0`                       | Les mêmes tests de génération que sur Linux. Windows est supporté à travers WSL2, dont l’environnement Linux est couvert par le runner Ubuntu.                                                                                                     |
| Intégrations     | Ubuntu, Node `24.15.0`, PostgreSQL 16 et Docker | Prisma, TypeORM sur HTTP, Docker généré et tarball npm installé dans un consommateur.                                                                                                                                                              |
| Package managers | npm 11, pnpm 10 et Yarn Berry 4                 | Chaque gestionnaire crée son lockfile puis réinstalle une dépendance locale avec son mode verrouillé. Les commandes de génération et les Dockerfiles sont aussi testés ; chaque Dockerfile copie exclusivement le lockfile du gestionnaire choisi. |

Les intégrations avec Docker et PostgreSQL restent sur Ubuntu, car les services Linux et leurs images sont la cible de production. Elles complètent le test de contrat lancé sur tous les systèmes ; elles ne constituent pas une promesse de conteneurs Windows ou macOS natifs.

Les environnements exclus sont Node `<24.15.0` ou `>=27`, Windows natif via PowerShell/CMD, Yarn Classic et les installations qui mélangent plusieurs lockfiles. Une release doit attendre la réussite des jobs `Compatibility`, `Integration` et `Package manager`; la protection de branche du dépôt doit les déclarer obligatoires.

Le chemin Prisma génère son schéma, `PrismaService` et `PrismaModule`. La CI le valide sur PostgreSQL 16 : migration, compilation du projet, démarrage de Nest et persistance d’une ressource.

Les planchers Node suivent les exigences déclarées par la [documentation Nest CLI](https://docs.nestjs.com/cli/overview) pour les schémas, et la sélection d’une ligne LTS suit les [versions Node publiées](https://nodejs.org/en/download/current).
