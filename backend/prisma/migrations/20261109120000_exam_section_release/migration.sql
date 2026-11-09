-- Exams are approved and released per section; each mark records when it became visible.

-- AlterTable
ALTER TABLE "marks" ADD COLUMN     "released_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "exam_sections" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "examination_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'DRAFT',
    "verified_at" TIMESTAMP(3),
    "verified_by_id" UUID,
    "released_at" TIMESTAMP(3),
    "released_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "exam_sections_school_id_section_id_idx" ON "exam_sections"("school_id", "section_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_sections_examination_id_section_id_key" ON "exam_sections"("examination_id", "section_id");

-- AddForeignKey
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_examination_id_fkey" FOREIGN KEY ("examination_id") REFERENCES "examinations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_sections" ADD CONSTRAINT "exam_sections_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Marks of exams already released stay visible to students and parents.
UPDATE "marks" m
SET "released_at" = COALESCE(e."released_at", e."updated_at")
FROM "assessments" a
JOIN "examinations" e ON e."id" = a."examination_id"
WHERE m."assessment_id" = a."id" AND e."status" = 'RELEASED';

CREATE INDEX "marks_student_id_released_at_idx" ON "marks"("student_id", "released_at");

-- Same rule as every other table: no direct access through the Supabase Data API.
ALTER TABLE "exam_sections" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "exam_sections" FROM anon, authenticated;
