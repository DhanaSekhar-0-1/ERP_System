import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { FilesService, MAX_FILE_BYTES, UploadedFileLike } from './files.service';

class UploadMetadataDto {
  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;
}

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload')
  @RequirePermissions('files:upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  upload(
    @CurrentUser() user: SupabaseUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() input: UploadMetadataDto,
  ) {
    return this.files.upload(user, file, input.entityType, input.entityId);
  }

  @Get(':fileId')
  @RequirePermissions('files:upload')
  findOne(@CurrentUser() user: SupabaseUser, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.files.findOne(user, fileId);
  }

  @Get(':fileId/download-url')
  @RequirePermissions('files:upload')
  downloadUrl(@CurrentUser() user: SupabaseUser, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.files.downloadUrl(user, fileId);
  }

  @Delete(':fileId')
  @RequirePermissions('files:upload')
  remove(@CurrentUser() user: SupabaseUser, @Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.files.remove(user, fileId);
  }
}
