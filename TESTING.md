# Contrats de génération

La suite `node --test` s’exécute sans réseau ni base de données. Chaque scénario utilise un répertoire temporaire isolé.

| Régression | Contrat vérifié                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| A01        | Les noms et arguments non valides sont refusés avant l’appel d’un script externe.                        |
| A02        | Une collision de module, de fichier Docker ou de schéma ne remplace aucune donnée existante.             |
| A03        | L’enregistrement `AppModule` est idempotent et cible le tableau `imports` du décorateur.                 |
| A04        | Un échec Nest CLI, package manager ou Git arrête la génération et masque le résumé de succès.            |
| A05        | Les noms kebab-case et snake_case produisent des fichiers, classes, routes et tables stables.            |
| A06        | Chaque ressource génère un test REST E2E qui force `DATABASE_TEST_NAME`, isole son schéma et le nettoie. |

Les tests vérifient le contenu produit, les codes de sortie et la préservation des fichiers, plutôt que la seule présence d’un dossier.

## Exemple Store API

`npm run test:example` reconstruit dans un répertoire temporaire l’exemple publié `examples/store-api` avec le binaire CLI. Il vérifie les ressources clients, produits, commandes et lignes de commande, leurs contraintes d’unicité et relations, puis le plan d’une migration TypeORM. La commande est exécutée par la CI d’intégration et par `prepack`; le test du tarball vérifie que les définitions et leur guide sont publiés.
