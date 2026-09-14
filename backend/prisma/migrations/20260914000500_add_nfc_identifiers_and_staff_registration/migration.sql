-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "nfc_id" TEXT;

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "nfc_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_nfc_id_key" ON "staff_profiles"("nfc_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_nfc_id_key" ON "students"("nfc_id");

