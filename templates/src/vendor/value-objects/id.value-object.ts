import { ValueObject, DomainPrimitive } from '../value-object.base';

export abstract class ID extends ValueObject<string> {
    protected validate({ value }: DomainPrimitive<string>): void {
        if (!value) throw new Error('ID is required');
    }
    toString(): string {
        return this.value;
    }
}
