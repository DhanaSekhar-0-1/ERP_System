-- Half-day teacher leave (MVP1 step 7): a session (full day, morning, afternoon) and
-- fractional days (0.5 for a half day). Existing leave stays full days.

-- CreateEnum
CREATE TYPE "LeaveSession" AS ENUM ('FULL_DAY', 'MORNING', 'AFTERNOON');

-- AlterTable
ALTER TABLE "staff_leaves" ADD COLUMN     "session" "LeaveSession" NOT NULL DEFAULT 'FULL_DAY',
ALTER COLUMN "days" SET DATA TYPE DOUBLE PRECISION;

