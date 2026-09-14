import { Module } from '@nestjs/common';
import { HomeworkController, StudentHomeworkController } from './homework.controller';
import { HomeworkService } from './homework.service';

@Module({
  controllers: [HomeworkController, StudentHomeworkController],
  providers: [HomeworkService],
})
export class HomeworkModule {}
