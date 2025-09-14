import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('__name__s')
export class __Name__OrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;
}
