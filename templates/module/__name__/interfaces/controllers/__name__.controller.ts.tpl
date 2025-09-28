import { Controller, Post, Body } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Create__Name__Command } from '../../core/application/commands/create-__name__.command';
import { Create__Name__Request } from '../requests/create-__name__.request';


@Controller('__name__s')
export class __Name__Controller {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async create(@Body() dto: Create__Name__Request) {
    const id = await this.commandBus.execute(new Create__Name__Command(dto.name));
    return { id };
  }
}
