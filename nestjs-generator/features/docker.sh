#!/usr/bin/env bash

set -euo pipefail

APP_NAME=${1:?Nom_application_requis}
PM=${2:-npm}

case "$PM" in
  npm|pnpm|yarn) ;;
  *)
    echo "❌ Package manager non supporté pour Docker : $PM."
    exit 1
    ;;
esac

for file in Dockerfile compose.yaml .dockerignore; do
  if [ -e "$file" ]; then
    echo "❌ $file existe déjà. Aucune configuration Docker n'a été remplacée."
    exit 1
  fi
done

case "$PM" in
  npm)
    cat > Dockerfile <<'DOCKERFILE'
FROM node:24-alpine AS base
WORKDIR /app

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS development
COPY . .
CMD ["npm", "run", "start:dev"]

FROM dependencies AS build
COPY . .
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p node_modules

FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
DOCKERFILE
    ;;
  pnpm)
    cat > Dockerfile <<'DOCKERFILE'
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS development
COPY . .
CMD ["pnpm", "run", "start:dev"]

FROM dependencies AS build
COPY . .
RUN pnpm run build

FROM base AS production-dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && mkdir -p node_modules

FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
DOCKERFILE
    ;;
  yarn)
    cat > Dockerfile <<'DOCKERFILE'
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable

FROM base AS dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

FROM dependencies AS development
COPY . .
CMD ["yarn", "start:dev"]

FROM dependencies AS build
COPY . .
RUN yarn build

FROM base AS production-dependencies
COPY package.json yarn.lock ./
RUN yarn install --production=true --frozen-lockfile && mkdir -p node_modules

FROM node:24-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
DOCKERFILE
    ;;
esac

cat > compose.yaml <<COMPOSE
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-appdb}
      POSTGRES_USER: \${POSTGRES_USER:-nestgen}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-nestgen-local-only}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \$\$POSTGRES_USER -d \$\$POSTGRES_DB"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 5s

  app:
    build:
      context: .
      target: development
    command: \${NESTGEN_DEV_COMMAND:-$PM run start:dev}
    environment:
      DATABASE_HOST: postgres
      DATABASE_PORT: 5432
      DATABASE_NAME: \${POSTGRES_DB:-appdb}
      DATABASE_USER: \${POSTGRES_USER:-nestgen}
      DATABASE_PASSWORD: \${POSTGRES_PASSWORD:-nestgen-local-only}
      PORT: \${PORT:-3000}
    ports:
      - "\${PORT:-3000}:3000"
    volumes:
      - .:/app
      - app-node-modules:/app/node_modules
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-data:
  app-node-modules:
COMPOSE

cat > .dockerignore <<'IGNORE'
node_modules
dist
coverage
.git
.env
.env.*
!.env.example
npm-debug.log*
yarn-debug.log*
pnpm-debug.log*
IGNORE

if [ ! -e .env.example ]; then
  cat > .env.example <<'ENV'
# Variables utilisées par compose.yaml en développement local.
POSTGRES_DB=appdb
POSTGRES_USER=nestgen
POSTGRES_PASSWORD=change-me-before-sharing
POSTGRES_PORT=5432
PORT=3000
ENV
else
  echo "ℹ️  .env.example existe déjà et a été conservé."
fi

echo "✅ Docker de développement et image de production générés pour $APP_NAME ($PM)."
