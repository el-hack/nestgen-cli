import { AggregateRootBase } from '@vendor/aggregate-root.base';
import { UUID } from '@vendor/value-objects/uuid.value-object';

export interface __Name__Props {
  name: string;
}

export class __Name__Entity extends AggregateRootBase<__Name__Props, UUID> {
  private constructor(id: UUID, props: __Name__Props) { super(id, props); }

  // Création (génère l’ID implicitement)
  static create(props: __Name__Props): __Name__Entity {
    if (!props.name?.trim()) throw new Error('__Name__Entity: name is required');
    return new __Name__Entity(UUID.generate(), props);
  }

  // Restauration depuis la DB (conserve l’ID existant)
  static restore(id: string, props: __Name__Props): __Name__Entity {
    if (!props.name?.trim()) throw new Error('__Name__Entity: name is required');
    return new __Name__Entity(UUID.parse(id), props);
  }

  get name(): string { return this.props.name; }
}
