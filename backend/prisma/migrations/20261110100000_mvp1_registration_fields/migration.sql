-- MVP1 registration fields for students and teachers, forced first-password change, and
-- per-school ID counters (Teacher ID T26A05). Additive only: existing rows keep working.

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AdmissionType" AS ENUM ('NEW_TO_SCHOOL', 'EXISTING');

-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "address" TEXT,
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "joining_date" DATE,
ADD COLUMN     "teaching_subjects" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "aadhaar_encrypted" TEXT,
ADD COLUMN     "aadhaar_enrolment_no" TEXT,
ADD COLUMN     "aadhaar_hash" TEXT,
ADD COLUMN     "aadhaar_last4" TEXT,
ADD COLUMN     "admission_date" DATE,
ADD COLUMN     "admission_type" "AdmissionType",
ADD COLUMN     "blood_group" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "last_class_passed" TEXT,
ADD COLUMN     "mother_tongue" TEXT,
ADD COLUMN     "pin_code" TEXT,
ADD COLUMN     "previous_percentage" DECIMAL(5,2),
ADD COLUMN     "previous_school" TEXT,
ADD COLUMN     "previous_tc_number" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "id_sequences" (
    "school_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "id_sequences_pkey" PRIMARY KEY ("school_id","kind")
);

-- CreateIndex
CREATE UNIQUE INDEX "students_school_id_aadhaar_hash_key" ON "students"("school_id", "aadhaar_hash");

-- AddForeignKey
ALTER TABLE "id_sequences" ADD CONSTRAINT "id_sequences_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security, as on every other table: the Supabase Data API cannot reach it.
ALTER TABLE "id_sequences" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "id_sequences" FROM anon, authenticated;

-- Students already in the system were studying here when they were added.
UPDATE "students" SET "admission_type" = 'EXISTING' WHERE "admission_type" IS NULL;

-- Start each school's teacher counter after the staff it already has, so the first new
-- Teacher ID follows on from them and never repeats a number.
INSERT INTO "id_sequences" ("school_id", "kind", "last_value", "updated_at")
SELECT "school_id", 'teacher', COUNT(*), CURRENT_TIMESTAMP
FROM "staff_profiles"
GROUP BY "school_id"
ON CONFLICT ("school_id", "kind") DO NOTHING;
