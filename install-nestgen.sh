#!/bin/bash

echo "🚀 INSTALLATION + DOCTOR DU CLI NESTGEN ⚙️"

# Chemins
CLI_DIR=$(pwd)
BIN_FILE="nestgen.js"
PKG_FILE="package.json"
PNPM_BIN=$(pnpm bin -g)

# 🧠 Étape 1 : Vérifier que pnpm est installé
if ! command -v pnpm &>/dev/null; then
  echo "❌ pnpm non installé. Installe-le avec : npm install -g pnpm"
  exit 1
fi

# 📦 Étape 2 : Vérifier et créer le package.json si besoin
if [ ! -f "$PKG_FILE" ]; then
  echo "📦 package.json manquant — création automatique..."
  cat > "$PKG_FILE" <<EOF
{
  "name": "nestgen",
  "version": "1.0.0",
  "description": "CLI NestJS module generator",
  "bin": {
    "nestgen": "nestgen.js"
  },
  "type": "module",
  "license": "MIT"
}
EOF
else
  echo "✅ package.json présent"
fi

# 🧠 Étape 3 : Vérifier le champ 'bin'
if ! grep -q '"bin"' "$PKG_FILE"; then
  echo "❌ Le champ \"bin\" est manquant dans package.json"
  exit 1
fi

# 📂 Étape 4 : Vérifier que nestgen.js existe
if [ ! -f "$BIN_FILE" ]; then
  echo "❌ Le fichier $BIN_FILE est manquant. Place-toi dans le dossier nestgen-cli"
  exit 1
else
  echo "✅ $BIN_FILE présent"
fi

# ✅ Étape 5 : Rendre le fichier exécutable
chmod +x "$BIN_FILE"
echo "✅ $BIN_FILE rendu exécutable"

# 🔗 Étape 6 : Lien global via pnpm
pnpm unlink --global >/dev/null 2>&1
pnpm link --global

# 🧪 Étape 7 : Vérifier que le binaire est bien créé
if [ ! -f "$PNPM_BIN/nestgen" ]; then
  echo "❌ Binaire nestgen non trouvé dans $PNPM_BIN"
  exit 1
else
  echo "✅ Binaire nestgen détecté dans $PNPM_BIN"
fi

# ➕ Étape 8 : S'assurer que le chemin est dans le .zshrc
if ! grep -q "$PNPM_BIN" ~/.zshrc; then
  echo "➕ Ajout de $PNPM_BIN au PATH dans ~/.zshrc"
  echo "export PATH=\"\$PATH:$PNPM_BIN\"" >> ~/.zshrc
else
  echo "✅ Le PATH contient déjà $PNPM_BIN"
fi

# ♻️ Étape 9 : Recharge le shell
echo "♻️ Reload de ~/.zshrc"
source ~/.zshrc

# ✅ Étape 10 : Test final
if command -v nestgen >/dev/null 2>&1; then
  echo "🎉 nestgen est maintenant disponible globalement !"
  nestgen --help
else
  echo "❌ Problème détecté : la commande nestgen n’est toujours pas reconnue"
  echo "👉 Essaie manuellement : source ~/.zshrc ou redémarre ton terminal"
fi
