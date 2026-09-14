CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED');

CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "attendance_date" DATE NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "remarks" TEXT,
    "marked_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "attendance_records_enrollment_id_attendance_date_key"
ON "attendance_records"("enrollment_id", "attendance_date");
CREATE INDEX "attendance_records_school_id_attendance_date_idx"
ON "attendance_records"("school_id", "attendance_date");
CREATE INDEX "attendance_records_school_id_enrollment_id_attendance_date_idx"
ON "attendance_records"("school_id", "enrollment_id", "attendance_date");

ALTER TABLE "attendance_records"
ADD CONSTRAINT "attendance_records_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "attendance_records_enrollment_id_fkey"
FOREIGN KEY ("enrollment_id") REFERENCES "student_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "attendance_records_marked_by_id_fkey"
FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
