# Documentation NestGen

Chaque dossier de `versions/` est un instantané du contrat publié : il n’est jamais réécrit après la publication de sa version. La documentation de la branche `develop` vit à la racine du dépôt ; elle prépare la prochaine version, alors que les liens ci-dessous décrivent ce qu’un utilisateur peut réellement installer.

| Version | Référence                        | Migration depuis la version précédente |
| ------- | -------------------------------- | -------------------------------------- |
| 0.1.0   | [Guide 0.1.0](versions/0.1.0.md) | Première version publique.             |

Le workflow de release refuse un tag `vX.Y.Z` lorsque `docs/versions/X.Y.Z.md` est absent ou porte une autre version. Ajoutez donc le guide et la section `CHANGELOG.md` dans le même commit que la hausse de version.
