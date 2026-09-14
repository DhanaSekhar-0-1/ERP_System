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
  ],
  controllers: [AppController],
})
export class AppModule {}
