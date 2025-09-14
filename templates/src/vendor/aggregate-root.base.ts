import { ID } from './value-objects/id.value-object';

export abstract class AggregateRootBase<TProps, TId extends ID = ID> {
    protected readonly props: Readonly<TProps>;
    protected readonly _id: TId;

    protected constructor(id: TId, props: TProps) {
        this._id = id;
        this.props = Object.freeze({ ...props });
    }

    get id(): TId {
        return this._id;
    }
}
