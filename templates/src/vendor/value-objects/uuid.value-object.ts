import { v4 as uuidV4, validate as isUuid } from 'uuid';
import { DomainPrimitive } from '../value-object.base';
import { ArgumentInvalidException } from '../exception/argument-invalid.exception';
import { ID } from './id.value-object';

export class UUID extends ID {
    static generate(): UUID {
        return new UUID(uuidV4());
    }
    static parse(id: string): UUID {
        return new UUID(id);
    }
    protected validate({ value }: DomainPrimitive<string>): void {
        if (!isUuid(value)) {
            throw new ArgumentInvalidException('Incorrect UUID format');
        }
    }
}
