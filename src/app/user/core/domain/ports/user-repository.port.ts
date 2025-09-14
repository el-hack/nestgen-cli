import { UserEntity } from '../entities/user.entity';

export interface UserRepositoryPort {
  save(entity: UserEntity): Promise<UserEntity>;
  findById(id: string): Promise<UserEntity | null>;
}
