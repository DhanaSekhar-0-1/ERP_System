CREATE TYPE "HomeworkStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SubmissionStatus" AS ENUM ('SUBMITTED', 'GRADED', 'RETURNED');
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "homework" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "due_date" DATE,
    "max_marks" INTEGER,
    "status" "HomeworkStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "homework_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "homework_submissions" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "homework_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "content" TEXT,
    "attachment_url" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "homework_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "target_class_id" UUID,
    "target_section_id" UUID,
    "target_role" TEXT,
    "target_metadata" JSONB,
    "published_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "homework_school_id_academic_year_id_class_id_section_id_idx"
ON "homework"("school_id", "academic_year_id", "class_id", "section_id");
CREATE INDEX "homework_school_id_teacher_id_status_idx"
ON "homework"("school_id", "teacher_id", "status");
CREATE INDEX "homework_school_id_status_published_at_idx"
ON "homework"("school_id", "status", "published_at");
CREATE UNIQUE INDEX "homework_submissions_homework_id_student_id_key"
ON "homework_submissions"("homework_id", "student_id");
CREATE INDEX "homework_submissions_school_id_student_id_submitted_at_idx"
ON "homework_submissions"("school_id", "student_id", "submitted_at");
CREATE INDEX "announcements_school_id_status_published_at_idx"
ON "announcements"("school_id", "status", "published_at");
CREATE INDEX "announcements_school_id_target_class_id_target_section_id_idx"
ON "announcements"("school_id", "target_class_id", "target_section_id");

ALTER TABLE "homework"
ADD CONSTRAINT "homework_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_academic_year_id_fkey"
FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_class_id_fkey"
FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_section_id_fkey"
FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_subject_id_fkey"
FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_teacher_id_fkey"
FOREIGN KEY ("teacher_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "homework_submissions"
ADD CONSTRAINT "homework_submissions_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_submissions_homework_id_fkey"
FOREIGN KEY ("homework_id") REFERENCES "homework"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "homework_submissions_student_id_fkey"
FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "announcements"
ADD CONSTRAINT "announcements_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "announcements_target_class_id_fkey"
FOREIGN KEY ("target_class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "announcements_target_section_id_fkey"
FOREIGN KEY ("target_section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "announcements_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
