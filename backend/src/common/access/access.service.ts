import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { SupabaseUser } from '../auth/supabase-user.interface';
import { ROLE } from './roles';

export interface AccessContext {
  userId: string;
  authUserId: string;
  email: string;
  displayName: string;
  organizationId: string | null;
  schoolId: string | null;
  roles: string[];
  permissions: Set<string>;
  staffId: string | null;
  studentId: string | null;
  guardianId: string | null;
  isSuperAdmin: boolean;
  isSchoolAdmin: boolean;
  isPrincipal: boolean;
  isTeacher: boolean;
  isAccountant: boolean;
  isParent: boolean;
  isStudent: boolean;
  /** School Admin, Principal or Super Admin: full read across the school. */
  isLeader: boolean;
}

export type SchoolContext = AccessContext & { schoolId: string };

/** Which students a user may see. `all` means every student in the school. */
export type StudentScope = { all: true } | { all: false; ids: string[] };

/** Teacher coverage: whole classes (assignment without section) and single sections. */
export interface TeacherCoverage {
  classIds: string[];
  sectionIds: string[];
  subjectIds: string[];
}

@Injectable()
export class AccessService {
  private readonly cache = new WeakMap<SupabaseUser, Promise<AccessContext>>();

  constructor(private readonly database: DatabaseService) {}

  /** Loads the caller's ERP identity once per request. */
  context(authUser: SupabaseUser): Promise<AccessContext> {
    let pending = this.cache.get(authUser);
    if (!pending) {
      pending = this.load(authUser);
      this.cache.set(authUser, pending);
    }
    return pending;
  }

  async schoolContext(authUser: SupabaseUser): Promise<SchoolContext> {
    const context = await this.context(authUser);
    if (!context.schoolId) {
      throw new ForbiddenException('ERP user is not assigned to a school');
    }
    return context as SchoolContext;
  }

  hasPermission(context: AccessContext, code: string): boolean {
    return context.permissions.has(code);
  }

  assertLeader(context: AccessContext, message = 'School Admin or Principal access is required') {
    if (!context.isLeader) {
      throw new ForbiddenException(message);
    }
  }

  assertAdmin(context: AccessContext, message = 'School Admin access is required') {
    if (!context.isSchoolAdmin && !context.isSuperAdmin) {
      throw new ForbiddenException(message);
    }
  }

  /** Classes, sections and subjects a teacher is assigned to, across all years. */
  async teacherCoverage(context: SchoolContext): Promise<TeacherCoverage> {
    if (!context.staffId) {
      return { classIds: [], sectionIds: [], subjectIds: [] };
    }
    const assignments = await this.database.staffAssignment.findMany({
      where: { schoolId: context.schoolId, staffId: context.staffId },
      select: { classId: true, sectionId: true, subjectId: true },
    });
    return {
      classIds: [...new Set(assignments.filter((a) => !a.sectionId).map((a) => a.classId))],
      sectionIds: [
        ...new Set(assignments.filter((a) => a.sectionId).map((a) => a.sectionId as string)),
      ],
      subjectIds: [...new Set(assignments.map((a) => a.subjectId))],
    };
  }

  /** Enrollment filter matching a teacher's coverage. */
  coverageWhere(coverage: TeacherCoverage): Prisma.EnrollmentWhereInput {
    return {
      OR: [
        { classId: { in: coverage.classIds } },
        { sectionId: { in: coverage.sectionIds } },
      ],
    };
  }

  async studentScope(context: SchoolContext): Promise<StudentScope> {
    if (context.isLeader || context.isAccountant) {
      return { all: true };
    }
    const ids = new Set<string>();
    if (context.studentId) {
      ids.add(context.studentId);
    }
    if (context.guardianId) {
      const links = await this.database.studentGuardian.findMany({
        where: { guardianId: context.guardianId },
        select: { studentId: true },
      });
      links.forEach((link) => ids.add(link.studentId));
    }
    if (context.isTeacher) {
      const coverage = await this.teacherCoverage(context);
      const enrollments = await this.database.enrollment.findMany({
        where: { schoolId: context.schoolId, ...this.coverageWhere(coverage) },
        select: { studentId: true },
      });
      enrollments.forEach((enrollment) => ids.add(enrollment.studentId));
    }
    return { all: false, ids: [...ids] };
  }

  async studentWhere(context: SchoolContext): Promise<Prisma.StudentWhereInput> {
    const scope = await this.studentScope(context);
    return scope.all
      ? { schoolId: context.schoolId }
      : { schoolId: context.schoolId, id: { in: scope.ids } };
  }

  async assertStudentAccess(context: SchoolContext, studentId: string) {
    const student = await this.database.student.findFirst({
      where: { id: studentId, schoolId: context.schoolId },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    const scope = await this.studentScope(context);
    if (!scope.all && !scope.ids.includes(studentId)) {
      throw new ForbiddenException('You cannot access this student');
    }
    return student;
  }

  /** Teachers may act only on enrollments in their classes or sections; leaders on any. */
  async assertEnrollmentManageable(context: SchoolContext, enrollmentId: string) {
    const enrollment = await this.database.enrollment.findFirst({
      where: { id: enrollmentId, schoolId: context.schoolId },
    });
    if (!enrollment) {
      throw new NotFoundException('Enrollment not found');
    }
    if (context.isLeader) {
      return enrollment;
    }
    const coverage = await this.teacherCoverage(context);
    const covered =
      coverage.classIds.includes(enrollment.classId) ||
      coverage.sectionIds.includes(enrollment.sectionId);
    if (!context.isTeacher || !covered) {
      throw new ForbiddenException('You can manage only students in your assigned classes');
    }
    return enrollment;
  }

  private async load(authUser: SupabaseUser): Promise<AccessContext> {
    const user = await this.database.user.findUnique({
      where: { authUserId: authUser.id },
      select: {
        id: true,
        authUserId: true,
        email: true,
        displayName: true,
        status: true,
        organizationId: true,
        schoolId: true,
        school: { select: { isArchived: true } },
        staffProfile: { select: { id: true } },
        studentProfile: { select: { id: true, isArchived: true } },
        guardian: { select: { id: true } },
        roles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { code: true } } } },
              },
            },
          },
        },
        permissionOverrides: {
          select: { effect: true, permission: { select: { code: true } } },
        },
      },
    });
    if (!user) {
      throw new ForbiddenException('ERP user profile is required');
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('ERP user is not active');
    }
    const roles = user.roles.map(({ role }) => role.name);
    const isSuperAdmin = roles.includes(ROLE.SUPER_ADMIN);
    if (user.school?.isArchived && !isSuperAdmin) {
      throw new ForbiddenException('This school is archived');
    }
    if (user.studentProfile?.isArchived) {
      throw new ForbiddenException('This student account is archived');
    }
    const permissions = new Set(
      user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.code),
      ),
    );
    for (const override of user.permissionOverrides) {
      if (override.effect === 'GRANT') {
        permissions.add(override.permission.code);
      } else {
        permissions.delete(override.permission.code);
      }
    }
    const isSchoolAdmin = roles.includes(ROLE.SCHOOL_ADMIN);
    const isPrincipal = roles.includes(ROLE.PRINCIPAL);
    return {
      userId: user.id,
      authUserId: user.authUserId,
      email: user.email,
      displayName: user.displayName,
      organizationId: user.organizationId,
      schoolId: user.schoolId,
      roles,
      permissions,
      staffId: user.staffProfile?.id ?? null,
      studentId: user.studentProfile?.id ?? null,
      guardianId: user.guardian?.id ?? null,
      isSuperAdmin,
      isSchoolAdmin,
      isPrincipal,
      isTeacher: roles.includes(ROLE.TEACHER),
      isAccountant: roles.includes(ROLE.ACCOUNTANT),
      isParent: roles.includes(ROLE.PARENT),
      isStudent: roles.includes(ROLE.STUDENT),
      isLeader: isSuperAdmin || isSchoolAdmin || isPrincipal,
    };
  }
}
