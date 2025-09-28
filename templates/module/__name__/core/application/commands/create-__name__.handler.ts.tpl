import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Create__Name__Command } from './create-__name__.command';
import { __Name__Entity } from '../../domain/entities/__name__.entity';
import { __Name__RepositoryPort } from '../../domain/ports/__name__-repository.port.ts';

@CommandHandler(Create__Name__Command)
export class Create__Name__Handler implements ICommandHandler<Create__Name__Command> {
  constructor(private readonly repo: __Name__RepositoryPort) {}

  async execute(cmd: Create__Name__Command): Promise<string> {
    const entity = __Name__Entity.create({ name: cmd.name });
    const saved = await this.repo.save(entity);
    return saved.id.toString();
  }
}
