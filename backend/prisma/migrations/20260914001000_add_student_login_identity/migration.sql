-- Add a nullable link so existing students remain valid while new registrations
-- receive a managed ERP/Supabase login identity.
ALTER TABLE "students" ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "students_user_id_key" ON "students"("user_id");

ALTER TABLE "students"
ADD CONSTRAINT "students_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
