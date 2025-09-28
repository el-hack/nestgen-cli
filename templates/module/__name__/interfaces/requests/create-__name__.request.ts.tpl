import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';

/**
 * DTO de création pour __Name__
 * Adapte les propriétés ci-dessous à ton domaine.
 */
export class Create__Name__Request {
  @ApiProperty({ description: 'Nom lisible / label' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
