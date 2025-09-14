import { __Name__Entity } from '../entities/__name__.entity';

export interface __Name__RepositoryPort {
  save(entity: __Name__Entity): Promise<__Name__Entity>;
  findById(id: string): Promise<__Name__Entity | null>;
}
