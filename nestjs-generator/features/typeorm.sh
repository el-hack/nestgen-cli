#!/bin/bash

PM=$1
APP_NAME=$2

$PM install @nestjs/typeorm typeorm pg

# Ajout de config dans app.module.ts manuellement ensuite
echo "✅ TypeORM installé et prêt. Pense à configurer app.module.ts ou on peut automatiser ça plus tard 😉"
