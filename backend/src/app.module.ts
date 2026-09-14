import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './common/auth/auth.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    AuthModule,
    DatabaseModule,
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
  ],
  controllers: [AppController],
})
export class AppModule {}
