#!/usr/bin/env bash
set -euo pipefail

# --- Racines
# Projet = dossier courant (là où on veut générer src/app/…)
REPO_ROOT="$(pwd)"

# CLI = dossier du script (features/) → remonter d’un cran pour atteindre /templates
CLI_FEATURES_PATH="$(cd "$(dirname "$0")" && pwd)"
CLI_ROOT="$(cd "$CLI_FEATURES_PATH/.." && pwd)"
TEMPLATE_ROOT="$CLI_ROOT/templates/module/__name__"

# --- Colors & logs
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info(){ echo -e "${YELLOW}ℹ️  $*${NC}"; }
ok(){ echo -e "${GREEN}✅ $*${NC}"; }
err(){ echo -e "${RED}❌ $*${NC}"; }

# --- Guard: s'assurer qu'on est dans un projet Nest
if [[ ! -f "$REPO_ROOT/src/app.module.ts" ]]; then
  err "Aucun projet NestJS détecté (src/app.module.ts manquant). Lance la commande depuis la racine du projet."
  exit 1
fi

# --- Args
RAW_NAME="${1:-}"; ORM="${2:-typeorm}"
if [[ -z "$RAW_NAME" ]]; then err "Nom du module requis. Ex: add_module.sh user typeorm"; exit 1; fi
if [[ "$ORM" != "typeorm" && "$ORM" != "prisma" ]]; then err "ORM non supporté: $ORM"; exit 1; fi

# --- Name formats
to_kebab() {
  # lower + remplace tout ce qui n’est pas alnum par des tirets + squeeze
  local s="$1"
  s="$(printf "%s" "$s" | awk '{print tolower($0)}')"
  s="${s//[^a-z0-9]/-}"
  # squeeze des tirets successifs
  s="$(printf "%s" "$s" | sed -E 's/-+/-/g; s/^-|-$//g')"
  printf "%s" "$s"
}

to_pascal() {
  # split sur - _ et espaces, Capitalize chaque token
  local s="$1"
  s="${s//[-_]/ }"
  awk '{
    for(i=1;i<=NF;i++){
      $i=toupper(substr($i,1,1)) tolower(substr($i,2))
    }
    printf "%s", $0
  }' <<<"$s" | tr -d ' '
}

to_camel() {
  local p
  p="$(to_pascal "$1")"
  printf "%s%s" "$(printf "%s" "${p:0:1}" | awk '{print tolower($0)}')" "${p:1}"
}

NAME="$(to_kebab "$RAW_NAME")"; PASCAL="$(to_pascal "$NAME")"; CAMEL="$(to_camel "$NAME")"
DEST_ROOT="$REPO_ROOT/src/app/$NAME"

# --- Checks
if [[ ! -d "$TEMPLATE_ROOT" ]]; then err "Templates introuvables: $TEMPLATE_ROOT"; exit 1; fi
info "Module: $NAME  |  Pascal: $PASCAL  |  Camel: $CAMEL"
info "Templates: $TEMPLATE_ROOT"
info "Destination: $DEST_ROOT"

# --- Render helper
render_file() {
  local src="$1" dst="$2"
  mkdir -p "$(dirname "$dst")"
  perl -pe "s/__name__/$NAME/g; s/__Name__/$PASCAL/g; s/__nameCamel__/$CAMEL/g" "$src" > "$dst"
}

# --- Copier/rendre tous les .tpl
while IFS= read -r -d '' tpl; do
  rel="${tpl#$TEMPLATE_ROOT/}"; rel="${rel%.tpl}"
  rel="${rel//__name__/$NAME}"; rel="${rel//__Name__/$PASCAL}"; rel="${rel//__nameCamel__/$CAMEL}"
  dst="$DEST_ROOT/$rel"
  render_file "$tpl" "$dst"
  ok "Généré: src/app/$NAME/${rel}"
done < <(find "$TEMPLATE_ROOT" -type f -name '*.tpl' -print0)

# --- Sanity ORM
if [[ "$ORM" == "typeorm" ]]; then
  [[ -f "$DEST_ROOT/infrastructure/persistences/orm-entities/$NAME.orm.ts" ]] \
    || err "Manque: infrastructure/persistences/orm-entities/$NAME.orm.ts"
  [[ -f "$DEST_ROOT/infrastructure/persistences/repositories/$NAME.repository.ts" ]] \
    || err "Manque: infrastructure/persistences/repositories/$NAME.repository.ts"
fi

# --- Injection dans app.module.ts
bash "$CLI_FEATURES_PATH/inject_module_to_app.sh" "$NAME" "$ORM"

ok "Module \"$NAME\" généré et injecté 🎉"
