-- Each section keeps its own copy of its subjects; class teachers move to their own table.

-- DropIndex
DROP INDEX "subjects_school_id_academic_year_id_code_key";

-- AlterTable
ALTER TABLE "subjects" ADD COLUMN     "is_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "is_optional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "section_id" UUID,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "class_teachers" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_teachers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "class_teachers_section_id_key" ON "class_teachers"("section_id");

-- CreateIndex
CREATE INDEX "class_teachers_school_id_staff_id_idx" ON "class_teachers"("school_id", "staff_id");

-- CreateIndex
CREATE INDEX "subjects_school_id_academic_year_id_idx" ON "subjects"("school_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "subjects_section_id_code_key" ON "subjects"("section_id", "code");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_academic_year_id_fkey" FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_teachers" ADD CONSTRAINT "class_teachers_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Year-level subjects (no section) stay unique per school, year and code, as before.
CREATE UNIQUE INDEX "subjects_year_level_code_key"
  ON "subjects"("school_id", "academic_year_id", "code")
  WHERE "section_id" IS NULL;

-- Copy existing class teachers. Where a section had more than one, keep the most recent.
INSERT INTO "class_teachers" ("id", "school_id", "academic_year_id", "section_id", "staff_id", "created_at", "updated_at")
SELECT DISTINCT ON ("section_id")
  gen_random_uuid(), "school_id", "academic_year_id", "section_id", "staff_id", "created_at", "updated_at"
FROM "staff_assignments"
WHERE "is_class_teacher" AND "section_id" IS NOT NULL
ORDER BY "section_id", "updated_at" DESC;

ALTER TABLE "staff_assignments" DROP COLUMN "is_class_teacher";

-- Same rule as every other table: no direct access through the Supabase Data API.
ALTER TABLE "class_teachers" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "class_teachers" FROM anon, authenticated;
