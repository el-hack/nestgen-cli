export type DomainPrimitive<T> = { value: T };

export abstract class ValueObject<T> {
    constructor(protected readonly _value: T) {
        this.validate({ value: _value } as DomainPrimitive<T>);
        Object.freeze(this);
    }

    get value(): T {
        return this._value;
    }

    equals(vo?: ValueObject<T>): boolean {
        if (!vo) return false;
        if (vo.constructor !== this.constructor) return false;
        return vo.value === this.value;
    }

    protected abstract validate(props: DomainPrimitive<T>): void;
}
