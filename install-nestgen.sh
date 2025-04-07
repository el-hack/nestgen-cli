#!/bin/bash

echo ""
echo "🚀 INSTALLATION + CONFIGURATION DU CLI NESTGEN ⚙️"
echo ""

# ─── Chemins
CLI_DIR=$(pwd)
BIN_FILE="nestgen.js"
PKG_FILE="package.json"
PNPM_BIN=$(pnpm bin -g)

# 🧠 Étape 1 : Vérifier pnpm
if ! command -v pnpm &>/dev/null; then
  echo "❌ pnpm non installé. Installe-le avec : npm install -g pnpm"
  exit 1
fi

# 🧾 Étape 2 : Demander le nom du package
read -p "📦 Quel nom veux-tu donner à ton package CLI ? (ex: @outis23/nestgen) : " PACKAGE_NAME
PACKAGE_NAME=${PACKAGE_NAME:-"nestgen"}

# 📦 Étape 3 : Créer package.json si manquant
if [ ! -f "$PKG_FILE" ]; then
  echo "📦 package.json manquant — création automatique..."
  cat > "$PKG_FILE" <<EOF
{
  "name": "$PACKAGE_NAME",
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
  echo "✅ package.json détecté"
  echo "🔧 Mise à jour du nom dans package.json..."
  sed -i '' "s/\"name\": \".*\"/\"name\": \"$PACKAGE_NAME\"/" "$PKG_FILE"
fi

# ✅ Étape 4 : Vérif fichier binaire
if [ ! -f "$BIN_FILE" ]; then
  echo "❌ $BIN_FILE manquant. Place-toi dans le dossier nestgen-cli"
  exit 1
else
  echo "✅ $BIN_FILE trouvé"
fi

# ✅ Étape 5 : Executable
chmod +x "$BIN_FILE"
echo "✅ Binaire exécutable"

# 🔗 Étape 6 : Lien global via pnpm
pnpm unlink --global >/dev/null 2>&1
pnpm link --global

# 🧼 Étape 7 : Clean packageManager si tu veux un fichier clean
sed -i '' '/"packageManager":/d' "$PKG_FILE"

# ✅ Étape 8 : Vérif dans $PATH
SHELL_RC="$HOME/.zshrc"
[ -f "$HOME/.bashrc" ] && SHELL_RC="$HOME/.bashrc"

if ! grep -q "$PNPM_BIN" "$SHELL_RC"; then
  echo "➕ Ajout de $PNPM_BIN dans $SHELL_RC"
  echo "export PATH=\"\$PATH:$PNPM_BIN\"" >> "$SHELL_RC"
else
  echo "✅ $PNPM_BIN déjà présent dans le PATH"
fi

# ♻️ Étape 9 : Reload
echo ""
echo "♻️ Fais : source $SHELL_RC ou redémarre ton terminal"

# 🧪 Étape 10 : Test
if command -v nestgen >/dev/null 2>&1; then
  echo ""
  echo "🎉 CLI NestGen prêt ! Tu peux lancer : nestgen --help"
else
  echo ""
  echo "⚠️  La commande nestgen n’est pas encore reconnue"
  echo "👉 Essaie : source $SHELL_RC"
fi
