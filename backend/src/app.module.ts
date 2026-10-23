import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './common/auth/auth.module';
import { CommonModule } from './common/common.module';
import { DatabaseModule } from './common/database/database.module';
import { StudentsModule } from './modules/students/students.module';
import { GuardiansModule } from './modules/guardians/guardians.module';
import { AcademicYearsModule } from './modules/academic-years/academic-years.module';
import { ClassesModule } from './modules/classes/classes.module';
import { SectionsModule } from './modules/sections/sections.module';
import { StaffModule } from './modules/staff/staff.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { StaffAssignmentsModule } from './modules/staff-assignments/staff-assignments.module';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { HomeworkModule } from './modules/homework/homework.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuditModule } from './modules/audit/audit.module';
import { ExaminationsModule } from './modules/examinations/examinations.module';
import { FeesModule } from './modules/fees/fees.module';
import { LeavesModule } from './modules/leaves/leaves.module';
import { TimetablesModule } from './modules/timetables/timetables.module';
import { ComplaintsModule } from './modules/complaints/complaints.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FilesModule } from './modules/files/files.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { DashboardsModule } from './modules/dashboards/dashboards.module';
import { TransportModule } from './modules/transport/transport.module';
import { LibraryModule } from './modules/library/library.module';
import { AssetsModule } from './modules/assets/assets.module';
import { SyncModule } from './modules/sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    DatabaseModule,
    CommonModule,
    AuthModule,
    StudentsModule,
    GuardiansModule,
    AcademicYearsModule,
    ClassesModule,
    SectionsModule,
    StaffModule,
    SubjectsModule,
    StaffAssignmentsModule,
    EnrollmentsModule,
    AttendanceModule,
    HomeworkModule,
    AnnouncementsModule,
    OrganizationsModule,
    SchoolsModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    ApprovalsModule,
    AuditModule,
    ExaminationsModule,
    FeesModule,
    LeavesModule,
    TimetablesModule,
    ComplaintsModule,
    NotificationsModule,
    FilesModule,
    CertificatesModule,
    DashboardsModule,
    TransportModule,
    LibraryModule,
    AssetsModule,
    SyncModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
