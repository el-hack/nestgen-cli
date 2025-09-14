import { UserEntity } from '../../../core/domain/entities/user.entity';
import { UserOrmEntity } from '../orm-entities/user.orm';

export const toOrm = (domain: UserEntity): UserOrmEntity => {
  const o = new UserOrmEntity();
  o.id = domain.id.toString();
  o.name = domain.name;
  return o;
};

export const toDomain = (orm: UserOrmEntity): UserEntity =>
  UserEntity.restore(orm.id, { name: orm.name });
