# Contrats de génération

La suite `node --test` s’exécute sans réseau ni base de données. Chaque scénario utilise un répertoire temporaire isolé.

| Régression | Contrat vérifié |
| --- | --- |
| A01 | Les noms et arguments non valides sont refusés avant l’appel d’un script externe. |
| A02 | Une collision de module, de fichier Docker ou de schéma ne remplace aucune donnée existante. |
| A03 | L’enregistrement `AppModule` est idempotent et cible le tableau `imports` du décorateur. |
| A04 | Un échec Nest CLI, package manager ou Git arrête la génération et masque le résumé de succès. |
| A05 | Les noms kebab-case et snake_case produisent des fichiers, classes, routes et tables stables. |

Les tests vérifient le contenu produit, les codes de sortie et la préservation des fichiers, plutôt que la seule présence d’un dossier.
