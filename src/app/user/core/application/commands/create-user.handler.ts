import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateUserCommand } from './create-user.command';
import { UserEntity } from '../../domain/entities/user.entity';
import { UserRepositoryPort } from '../../domain/ports/user.repository';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(private readonly repo: UserRepositoryPort) {}

  async execute(cmd: CreateUserCommand): Promise<string> {
    const entity = UserEntity.create({ name: cmd.name });
    const saved = await this.repo.save(entity);
    return saved.id.toString();
  }
}
