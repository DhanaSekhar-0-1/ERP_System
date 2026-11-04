-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'SENDING';
ALTER TYPE "DeliveryStatus" ADD VALUE 'SKIPPED';

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "recipient" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");
