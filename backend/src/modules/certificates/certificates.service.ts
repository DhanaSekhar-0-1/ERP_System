import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Certificate, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service';
import { SupabaseUser } from '../../common/auth/supabase-user.interface';
import { AccessService, SchoolContext } from '../../common/access/access.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApprovalEngine } from '../../common/approvals/approval-engine.service';
import { NotifyService } from '../../common/notify/notify.service';
import {
  CertificateQueryDto,
  CreateCertificateDto,
  SubmitCertificateDto,
} from './dto/certificates.dto';

const CERTIFICATE_APPROVAL = 'certificate.issue';

const TITLES: Record<string, string> = {
  BONAFIDE: 'Bonafide Certificate',
  STUDY: 'Study Certificate',
  TRANSFER: 'Transfer Certificate',
  CHARACTER: 'Character Certificate',
};

/**
 * Certificates are generated from verified student records, never retyped. Issued
 * certificates are immutable; re-issuance creates a new version that supersedes the old one.
 */
@Injectable()
export class CertificatesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalEngine,
    private readonly notify: NotifyService,
  ) {}

  onModuleInit(): void {
    this.approvals.register(CERTIFICATE_APPROVAL, {
      onApproved: async (transaction, request) => {
        await transaction.certificate.update({
          where: { id: request.entityId },
          data: { status: 'APPROVED', approvalRequestId: request.id },
        });
      },
      onRejected: async (transaction, request) => {
        await transaction.certificate.update({
          where: { id: request.entityId },
          data: { status: 'REJECTED', approvalRequestId: request.id },
        });
      },
    });
  }

  async create(authUser: SupabaseUser, input: CreateCertificateDto) {
    const context = await this.access.schoolContext(authUser);
    await this.access.assertStudentAccess(context, input.studentId);
    let version = 1;
    if (input.supersedesId) {
      const previous = await this.scoped(context, input.supersedesId);
      if (previous.status !== 'ISSUED' || previous.studentId !== input.studentId || previous.type !== input.type) {
        throw new ConflictException('Only an issued certificate of the same type and student can be superseded');
      }
      version = previous.version + 1;
    }
    const certificate = await this.database.certificate.create({
      data: {
        schoolId: context.schoolId,
        studentId: input.studentId,
        type: input.type,
        purpose: input.purpose?.trim() || null,
        supersedesId: input.supersedesId ?? null,
        version,
        createdById: context.userId,
      },
    });
    await this.audit.record(context, {
      action: 'certificate.created',
      entityType: 'certificate',
      entityId: certificate.id,
      newValue: input,
    });
    return certificate;
  }

  async findMany(authUser: SupabaseUser, query: CertificateQueryDto) {
    const context = await this.access.schoolContext(authUser);
    return this.database.certificate.findMany({
      where: {
        AND: [
          await this.visibility(context),
          {
            ...(query.studentId ? { studentId: query.studentId } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.type ? { type: query.type } : {}),
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
      take: 500,
    });
  }

  async findOne(authUser: SupabaseUser, certificateId: string) {
    const context = await this.access.schoolContext(authUser);
    const certificate = await this.database.certificate.findFirst({
      where: { AND: [{ id: certificateId }, await this.visibility(context)] },
      include: { student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } } },
    });
    if (!certificate) throw new NotFoundException('Certificate not found');
    return certificate;
  }

  /** Transfer certificates are Tier 4 (Admin + Principal, document required); others Tier 3. */
  async submit(authUser: SupabaseUser, certificateId: string, input: SubmitCertificateDto) {
    const context = await this.access.schoolContext(authUser);
    const certificate = await this.scoped(context, certificateId);
    if (!['DRAFT', 'REJECTED'].includes(certificate.status)) {
      throw new ConflictException(`Certificate is already ${certificate.status.toLowerCase()}`);
    }
    const tier = certificate.type === 'TRANSFER' ? 4 : 3;
    await this.database.certificate.update({
      where: { id: certificate.id },
      data: { status: 'PENDING_APPROVAL' },
    });
    try {
      return await this.approvals.create(context, {
        type: CERTIFICATE_APPROVAL,
        entityType: 'certificate',
        entityId: certificate.id,
        reason: input.reason,
        payload: { type: certificate.type, studentId: certificate.studentId },
        tier,
        documentFileId: input.documentFileId,
      });
    } catch (error) {
      await this.database.certificate.update({
        where: { id: certificate.id },
        data: { status: certificate.status },
      });
      throw error;
    }
  }

  async decide(authUser: SupabaseUser, certificateId: string, decision: 'approve' | 'reject', note?: string) {
    const context = await this.access.schoolContext(authUser);
    const certificate = await this.scoped(context, certificateId);
    const request = await this.database.approvalRequest.findFirst({
      where: { schoolId: context.schoolId, type: CERTIFICATE_APPROVAL, entityId: certificate.id, status: 'PENDING' },
    });
    if (!request) throw new NotFoundException('No pending approval for this certificate');
    if (decision === 'approve') {
      await this.approvals.approve(context, request.id, note);
    } else {
      await this.approvals.reject(context, request.id, note);
    }
    return this.findOne(authUser, certificateId);
  }

  async generate(authUser: SupabaseUser, certificateId: string) {
    const context = await this.access.schoolContext(authUser);
    this.access.assertLeader(context);
    const certificate = await this.scoped(context, certificateId);
    if (certificate.status === 'ISSUED') {
      throw new ConflictException('This certificate is already issued; create a new version to re-issue');
    }
    if (certificate.status !== 'APPROVED') {
      throw new ConflictException('The certificate must be approved before it is generated');
    }
    const content = await this.snapshot(context, certificate);
    const serialNo = `${certificate.type.slice(0, 2)}-${new Date().getFullYear()}-${randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;
    const issued = await this.database.$transaction(async (transaction) => {
      const updated = await transaction.certificate.update({
        where: { id: certificate.id },
        data: {
          status: 'ISSUED',
          serialNo,
          content: content as Prisma.InputJsonValue,
          issuedAt: new Date(),
          issuedById: context.userId,
        },
      });
      await this.audit.record(
        context,
        {
          action: 'certificate.issued',
          entityType: 'certificate',
          entityId: certificate.id,
          newValue: { serialNo, version: certificate.version },
        },
        transaction,
      );
      return updated;
    });
    await this.notify.toStudentFamily(certificate.studentId, {
      type: 'certificate.issued',
      title: `${TITLES[certificate.type]} issued`,
      body: `Serial number ${serialNo}`,
      data: { certificateId: certificate.id },
    });
    return issued;
  }

  async downloadHtml(authUser: SupabaseUser, certificateId: string): Promise<string> {
    const certificate = await this.findOne(authUser, certificateId);
    if (certificate.status !== 'ISSUED' || !certificate.content) {
      throw new ConflictException('Only issued certificates can be downloaded');
    }
    const content = certificate.content as Record<string, string | null>;
    const escape = (value: string | null | undefined) =>
      String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] as string);
    const rows = Object.entries(content)
      .filter(([key]) => !['title', 'schoolName', 'schoolAddress', 'body'].includes(key))
      .map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`)
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(content.title)}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#111}h1{text-align:center}
h2{text-align:center;font-weight:normal}table{width:100%;border-collapse:collapse;margin:24px 0}
th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left}footer{margin-top:48px;display:flex;justify-content:space-between}</style>
</head><body><h1>${escape(content.schoolName)}</h1><h2>${escape(content.title)}</h2>
<p>${escape(content.body)}</p><table>${rows}</table>
<footer><span>Serial: ${escape(certificate.serialNo)} (version ${certificate.version})</span><span>Principal</span></footer></body></html>`;
  }

  private async snapshot(context: SchoolContext, certificate: Certificate) {
    const [student, school, enrollment] = await Promise.all([
      this.database.student.findUniqueOrThrow({
        where: { id: certificate.studentId },
        include: { guardians: { where: { isPrimary: true }, include: { guardian: true } } },
      }),
      this.database.school.findUniqueOrThrow({ where: { id: context.schoolId }, include: { settings: true } }),
      this.database.enrollment.findFirst({
        where: { studentId: certificate.studentId },
        orderBy: { createdAt: 'desc' },
        include: { class: true, section: true, academicYear: true },
      }),
    ]);
    const name = `${student.firstName} ${student.lastName ?? ''}`.trim();
    const classLabel = enrollment ? `${enrollment.class.name} - ${enrollment.section.name}` : null;
    return {
      title: TITLES[certificate.type],
      schoolName: school.name,
      schoolAddress: school.settings?.address ?? null,
      body:
        certificate.type === 'TRANSFER'
          ? `This is to certify that ${name} was a bonafide student of this school and has been granted transfer.`
          : `This is to certify that ${name} is a bonafide student of this school${classLabel ? ` studying in ${classLabel}` : ''}.`,
      studentName: name,
      admissionNo: student.admissionNo,
      dateOfBirth: student.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      guardianName: student.guardians[0]?.guardian.name ?? null,
      class: classLabel,
      academicYear: enrollment?.academicYear.name ?? null,
      enrollmentStatus: enrollment?.status ?? null,
      purpose: certificate.purpose,
      issuedOn: new Date().toISOString().slice(0, 10),
    };
  }

  private async visibility(context: SchoolContext): Promise<Prisma.CertificateWhereInput> {
    if (context.isLeader || this.access.hasPermission(context, 'certificates:manage')) {
      return { schoolId: context.schoolId };
    }
    const scope = await this.access.studentScope(context);
    return { schoolId: context.schoolId, studentId: { in: scope.all ? [] : scope.ids }, status: 'ISSUED' };
  }

  private async scoped(context: SchoolContext, certificateId: string) {
    const certificate = await this.database.certificate.findFirst({
      where: { id: certificateId, schoolId: context.schoolId },
    });
    if (!certificate) throw new NotFoundException('Certificate not found');
    return certificate;
  }
}
