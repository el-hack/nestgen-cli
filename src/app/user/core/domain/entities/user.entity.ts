import { AggregateRootBase } from '@vendor/aggregate-root.base';
import { UUID } from '@vendor/value-objects/uuid.value-object';

export interface UserProps {
  name: string;
}

export class UserEntity extends AggregateRootBase<UserProps, UUID> {
  private constructor(id: UUID, props: UserProps) { super(id, props); }

  // Création (génère l’ID implicitement)
  static create(props: UserProps): UserEntity {
    if (!props.name?.trim()) throw new Error('UserEntity: name is required');
    return new UserEntity(UUID.generate(), props);
  }

  // Restauration depuis la DB (conserve l’ID existant)
  static restore(id: string, props: UserProps): UserEntity {
    if (!props.name?.trim()) throw new Error('UserEntity: name is required');
    return new UserEntity(UUID.parse(id), props);
  }

  get name(): string { return this.props.name; }
}
