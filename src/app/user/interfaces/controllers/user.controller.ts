import { Controller, Post, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { CreateUserDto } from '../dtos/create-user.dto';
import { CreateUserCommand } from '../../core/application/commands/create-user.command';

@Controller('users')
export class UserController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const id = await this.commandBus.execute(new CreateUserCommand(dto.name));
    return { id };
  }
}
