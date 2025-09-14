import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { __Name__RepositoryPort } from '../../../core/domain/ports/__name__-repository.port';
import { __Name__Entity } from '../../../core/domain/entities/__name__.entity';
import { __Name__OrmEntity } from '../orm-entities/__name__.orm';
import { toDomain, toOrm } from '../orm-mappers/__name__.mapper';

@Injectable()
export class __Name__Repository implements __Name__RepositoryPort {
  constructor(@InjectRepository(__Name__OrmEntity) private readonly repo: Repository<__Name__OrmEntity>) {}

  async save(entity: __Name__Entity): Promise<__Name__Entity> {
    const saved = await this.repo.save(toOrm(entity));
    return toDomain(saved);
  }

  async findById(id: string): Promise<__Name__Entity | null> {
    const found = await this.repo.findOne({ where: { id } });
    return found ? toDomain(found) : null;
  }
}
