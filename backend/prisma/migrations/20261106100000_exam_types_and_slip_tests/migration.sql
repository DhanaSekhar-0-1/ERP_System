-- CreateEnum
CREATE TYPE "ExamType" AS ENUM ('FA1', 'FA2', 'FA3', 'FA4', 'Q1', 'Q2', 'Q3', 'PRE_PUBLIC', 'SLIP_TEST', 'OTHER');

-- AlterTable
ALTER TABLE "examinations" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "type" "ExamType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "assessments" ADD COLUMN     "section_id" UUID;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

