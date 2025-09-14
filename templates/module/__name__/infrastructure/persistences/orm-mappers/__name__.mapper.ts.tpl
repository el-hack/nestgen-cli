import { __Name__Entity } from '../../../core/domain/entities/__name__.entity';
import { __Name__OrmEntity } from '../orm-entities/__name__.orm';

export const toOrm = (domain: __Name__Entity): __Name__OrmEntity => {
  const o = new __Name__OrmEntity();
  o.id = domain.id.toString();
  o.name = domain.name;
  return o;
};

export const toDomain = (orm: __Name__OrmEntity): __Name__Entity =>
  __Name__Entity.restore(orm.id, { name: orm.name });
