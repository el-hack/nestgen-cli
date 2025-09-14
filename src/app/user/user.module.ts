import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserController } from './interfaces/controllers/user.controller';
import { CreateUserHandler } from './core/application/commands/create-user.handler';
import { UserOrmEntity } from './infrastructure/persistences/orm-entities/user.orm';
import { UserRepository } from './infrastructure/persistences/repositories/user.repository';

@Module({
  imports: [CqrsModule, TypeOrmModule.forFeature([UserOrmEntity])],
  controllers: [UserController],
  providers: [
    CreateUserHandler,
    { provide: 'UserRepositoryPort', useClass: UserRepository },
  ],
})
export class UserModule {}
