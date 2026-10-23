import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { SupabaseAuthService } from '../../common/auth/supabase-auth.service';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';

export const FILE_BUCKET = 'erp-files';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const SIGNED_URL_SECONDS = 300;

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Private documents in Supabase Storage; downloads use short-lived signed URLs only. */
@Injectable()
export class FilesService implements OnModuleInit {
  private readonly logger = new Logger(FilesService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly supabase: SupabaseAuthService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const { data } = await this.supabase.storage.getBucket(FILE_BUCKET);
      if (!data) {
        const { error } = await this.supabase.storage.createBucket(FILE_BUCKET, {
          public: false,
          fileSizeLimit: MAX_FILE_BYTES,
        });
        if (error) this.logger.warn(`Could not create bucket ${FILE_BUCKET}: ${error.message}`);
      }
    } catch (error) {
      this.logger.warn(`Storage bucket check failed: ${String(error)}`);
    }
  }

  async upload(
    authUser: SupabaseUser,
    file: UploadedFileLike | undefined,
    entityType?: string,
    entityId?: string,
  ) {
    const context = await this.access.schoolContext(authUser);
    if (!file) throw new BadRequestException('A file is required in the "file" field');
    if (file.size > MAX_FILE_BYTES) throw new BadRequestException('Files must be 10 MB or smaller');
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(`File type ${file.mimetype} is not allowed`);
    }
    if (entityType === 'student' && entityId) {
      await this.access.assertStudentAccess(context, entityId);
    }
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    const storagePath = `${context.schoolId}/${randomUUID()}-${safeName}`;
    const { error } = await this.supabase.storage
      .from(FILE_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
    if (error) {
      throw new InternalServerErrorException(`Upload failed: ${error.message}`);
    }
    const asset = await this.database.fileAsset.create({
      data: {
        schoolId: context.schoolId,
        uploadedById: context.userId,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storagePath,
      },
    });
    await this.audit.record(context, {
      action: 'file.uploaded',
      entityType: entityType ?? 'file',
      entityId: entityId ?? asset.id,
      newValue: { fileId: asset.id, fileName: asset.fileName, sizeBytes: asset.sizeBytes },
    });
    return asset;
  }

  async findOne(authUser: SupabaseUser, fileId: string) {
    const context = await this.access.schoolContext(authUser);
    return this.readable(context, fileId);
  }

  async downloadUrl(authUser: SupabaseUser, fileId: string) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.readable(context, fileId);
    const { data, error } = await this.supabase.storage
      .from(FILE_BUCKET)
      .createSignedUrl(asset.storagePath, SIGNED_URL_SECONDS, { download: asset.fileName });
    if (error || !data) {
      throw new InternalServerErrorException('Could not create a download link');
    }
    return { url: data.signedUrl, expiresInSeconds: SIGNED_URL_SECONDS, fileName: asset.fileName };
  }

  async remove(authUser: SupabaseUser, fileId: string) {
    const context = await this.access.schoolContext(authUser);
    const asset = await this.readable(context, fileId);
    if (asset.uploadedById !== context.userId && !context.isLeader) {
      throw new ForbiddenException('Only the uploader or school leadership can delete this file');
    }
    const referenced = await this.database.approvalRequest.count({ where: { documentFileId: fileId } });
    if (referenced) {
      throw new ForbiddenException('This file supports an approval request and must be kept');
    }
    await this.supabase.storage.from(FILE_BUCKET).remove([asset.storagePath]);
    await this.database.fileAsset.update({ where: { id: asset.id }, data: { deletedAt: new Date() } });
    await this.audit.record(context, {
      action: 'file.deleted',
      entityType: asset.entityType ?? 'file',
      entityId: asset.entityId ?? asset.id,
      oldValue: { fileId: asset.id, fileName: asset.fileName },
    });
    return { id: asset.id, deleted: true };
  }

  /** Uploader, leaders, and people who can see the linked student may read a file. */
  private async readable(context: SchoolContext, fileId: string) {
    const asset = await this.database.fileAsset.findFirst({
      where: { id: fileId, schoolId: context.schoolId, deletedAt: null },
    });
    if (!asset) throw new NotFoundException('File not found');
    if (asset.uploadedById === context.userId || context.isLeader) return asset;
    if (asset.entityType === 'student' && asset.entityId) {
      await this.access.assertStudentAccess(context, asset.entityId);
      return asset;
    }
    throw new ForbiddenException('You cannot access this file');
  }
}
