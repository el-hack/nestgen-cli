export class ArgumentInvalidException extends Error {
    constructor(message = 'Invalid argument') {
        super(message);
        this.name = 'ArgumentInvalidException';
    }
}
