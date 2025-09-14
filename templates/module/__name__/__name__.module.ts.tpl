import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { __Name__Controller } from './interfaces/controllers/__name__.controller';
import { Create__Name__Handler } from './core/application/commands/create-__name__.handler';
import { __Name__OrmEntity } from './infrastructure/persistences/orm-entities/__name__.orm';
import { __Name__Repository } from './infrastructure/persistences/repositories/__name__.repository';

@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([__Name__OrmEntity])],
  controllers: [__Name__Controller],
  providers: [
    Create__Name__Handler,
    { provide: '__Name__RepositoryPort', useClass: __Name__Repository },
  ],
})
export class __Name__Module {}
