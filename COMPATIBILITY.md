# Matrice de compatibilité

Les versions sont choisies pour le générateur Nest 12. Elles sont volontairement déclarées dans les scripts afin qu’une génération ne suive pas le tag mutable `latest`.

| Élément | Version ou combinaison supportée |
| --- | --- |
| Node.js pour générer | `>=24.15.0 <27` |
| Nest CLI temporaire | `@nestjs/cli@12.0.0`, exécutée localement avec le package manager choisi |
| Nest et extensions | Nest 12, `@nestjs/config@4`, `@nestjs/typeorm@12`, `@nestjs/swagger@12` |
| ORM | TypeORM `0.3` ou Prisma `6` |
| Package manager | npm 11, pnpm 10, Yarn Berry 4 |
| Systèmes | macOS et Linux ; Windows avec WSL2 |

Le générateur n’installe jamais Nest CLI globalement. Il passe par `npx`, `pnpm dlx` ou `yarn dlx` selon le choix initial, puis installe les dépendances avec ce même gestionnaire. Le lockfile créé par Nest reste donc celui qui pilote les installations ultérieures.

Les planchers Node suivent les exigences déclarées par la [documentation Nest CLI](https://docs.nestjs.com/cli/overview) pour les schémas, et la sélection d’une ligne LTS suit les [versions Node publiées](https://nodejs.org/en/download/current).
