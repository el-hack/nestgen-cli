import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRepositoryPort } from '../../../core/domain/ports/user-repository.port';
import { UserEntity } from '../../../core/domain/entities/user.entity';
import { UserOrmEntity } from '../orm-entities/user.orm';
import { toDomain, toOrm } from '../orm-mappers/user.mapper';

@Injectable()
export class UserRepository implements UserRepositoryPort {
  constructor(@InjectRepository(UserOrmEntity) private readonly repo: Repository<UserOrmEntity>) {}

  async save(entity: UserEntity): Promise<UserEntity> {
    const saved = await this.repo.save(toOrm(entity));
    return toDomain(saved);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const found = await this.repo.findOne({ where: { id } });
    return found ? toDomain(found) : null;
  }
}
