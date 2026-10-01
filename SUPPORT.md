# Support des plateformes

NestGen requiert Node.js LTS et Bash pour exécuter les scripts de génération.

| Plateforme        | Statut       | Prérequis                                                         |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| macOS             | Supportée    | Node.js LTS, Bash 3.2+                                            |
| Linux             | Supportée    | Node.js LTS, Bash 3.2+                                            |
| Windows natif     | Non supporté | Les scripts Bash ne sont pas exécutés par `cmd.exe` ou PowerShell |
| Windows avec WSL2 | Supportée    | Une distribution Linux, Node.js LTS et Bash                       |

Les transformations de noms et de fichiers sensibles à l’OS sont exécutées avec Node.js. Aucun générateur ne dépend de `sed -i`.
