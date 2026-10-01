import fs from 'node:fs';
import path from 'node:path';

const [sourceDirectory, orm] = process.argv.slice(2);

if (!sourceDirectory || !['typeorm', 'prisma'].includes(orm)) {
    console.error('❌ Usage : operational_foundation.mjs <source-directory> <typeorm|prisma>');
    process.exitCode = 1;
} else {
    const operationsDirectory = path.join(sourceDirectory, 'operations');
    const appModule = path.join(sourceDirectory, 'app.module.ts');

    if (!fs.existsSync(appModule)) {
        console.error(`❌ AppModule introuvable : ${appModule}`);
        process.exitCode = 1;
    } else if (fs.existsSync(operationsDirectory)) {
        console.error(`❌ ${operationsDirectory} existe déjà. Le socle d’exploitation n’a pas été remplacé.`);
        process.exitCode = 1;
    } else {
        const databaseHealth =
            orm === 'typeorm'
                ? `import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<{ status: 'up' | 'down' }> {
    try {
      if (!this.dataSource.isInitialized) return { status: 'down' };
      await this.dataSource.query('SELECT 1');
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }
}
`
                : `import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DatabaseHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{ status: 'up' | 'down' }> {
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    }
  }
}
`;

        const files = new Map([
            [
                'request-context.ts',
                `import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
`,
            ],
            [
                'request-id.middleware.ts',
                `import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

const REQUEST_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const candidate = request.header('x-request-id');
    const requestId = candidate && REQUEST_ID.test(candidate) ? candidate : randomUUID();
    response.setHeader('x-request-id', requestId);
    requestContext.run({ requestId }, next);
  }
}
`,
            ],
            [
                'structured-logger.service.ts',
                `import { Injectable, type LoggerService } from '@nestjs/common';
import { requestContext } from './request-context';

const SENSITIVE_KEY = /password|secret|token|authorization|cookie|api[-_]?key/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(nested)]),
  );
}

@Injectable()
export class StructuredLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]): void {
    this.write('log', message, optional);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.write('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.write('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.write('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.write('verbose', message, optional);
  }

  private write(level: string, message: unknown, optional: unknown[]): void {
    const context = requestContext.getStore();
    const record = {
      timestamp: new Date().toISOString(),
      level,
      message: typeof message === 'string' ? message : redact(message),
      ...(context ? { requestId: context.requestId } : {}),
      ...(optional.length > 0 ? { details: redact(optional) } : {}),
    };
    process[level === 'error' ? 'stderr' : 'stdout'].write(JSON.stringify(record) + '\\n');
  }
}
`,
            ],
            ['database-health.service.ts', databaseHealth],
            [
                'health.controller.ts',
                `import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseHealthService } from './database-health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Get('live')
  live(): { status: 'ok'; checks: { application: 'up' } } {
    return { status: 'ok', checks: { application: 'up' } };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok'; checks: { database: 'up' } }> {
    const database = await this.databaseHealth.check();
    if (database.status === 'down') {
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
`,
            ],
            [
                'operations.module.ts',
                `import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
${orm === 'prisma' ? "import { PrismaModule } from '../prisma/prisma.module';\n" : ''}import { DatabaseHealthService } from './database-health.service';
import { HealthController } from './health.controller';
import { RequestIdMiddleware } from './request-id.middleware';
import { StructuredLogger } from './structured-logger.service';

@Module({
  imports: [${orm === 'prisma' ? 'PrismaModule' : ''}],
  controllers: [HealthController],
  providers: [DatabaseHealthService, RequestIdMiddleware, StructuredLogger],
  exports: [StructuredLogger],
})
export class OperationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
`,
            ],
            [
                'README.md',
                `# Socle d’exploitation

Cette option est locale au projet et ne requiert aucun service externe. Elle expose :

- \`GET /health/live\` : le processus Nest peut répondre ; aucun appel de dépendance n’est fait.
- \`GET /health/ready\` : le processus et la base PostgreSQL sont prêts. Une base indisponible retourne \`503\` avec \`{ status: 'error', checks: { database: 'down' } }\`.

Chaque réponse reçoit \`x-request-id\`. Une valeur cliente sûre est conservée ; sinon NestGen en crée une. Le logger Nest produit un JSON par ligne avec cet identifiant, et masque récursivement les clés contenant \`password\`, \`secret\`, \`token\`, \`authorization\`, \`cookie\` ou \`apiKey\`.

\`main.ts\` active \`enableShutdownHooks()\`. Ainsi, \`SIGTERM\` et \`SIGINT\` ferment le contexte Nest ; TypeORM ferme sa connexion et Prisma exécute son \`onModuleDestroy\` existant. Les migrations restent explicites et ne sont jamais appliquées par ces endpoints.
`,
            ],
        ]);

        fs.mkdirSync(operationsDirectory, { recursive: true });
        try {
            for (const [name, content] of files) fs.writeFileSync(path.join(operationsDirectory, name), content);
        } catch (error) {
            fs.rmSync(operationsDirectory, { recursive: true, force: true });
            throw error;
        }
    }
}
