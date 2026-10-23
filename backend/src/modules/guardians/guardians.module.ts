import { Module } from '@nestjs/common';
import { GuardiansController, MeController } from './guardians.controller';
import { GuardiansService } from './guardians.service';

@Module({
  controllers: [GuardiansController, MeController],
  providers: [GuardiansService],
})
export class GuardiansModule {}
