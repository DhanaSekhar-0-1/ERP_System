import { Module } from '@nestjs/common';
import { LibraryController, StudentLibraryController } from './library.controller';
import { LibraryService } from './library.service';

@Module({
  controllers: [LibraryController, StudentLibraryController],
  providers: [LibraryService],
})
export class LibraryModule {}
