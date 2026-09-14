CREATE TABLE "staff_assignments" (
    "id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "staff_assignments_staff_id_class_id_subject_id_academic_year_id_key"
ON "staff_assignments"("staff_id", "class_id", "subject_id", "academic_year_id");

CREATE INDEX "staff_assignments_school_id_academic_year_id_class_id_idx"
ON "staff_assignments"("school_id", "academic_year_id", "class_id");

CREATE INDEX "staff_assignments_school_id_staff_id_idx"
ON "staff_assignments"("school_id", "staff_id");

ALTER TABLE "staff_assignments"
ADD CONSTRAINT "staff_assignments_school_id_fkey"
FOREIGN KEY ("school_id") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "staff_assignments_academic_year_id_fkey"
FOREIGN KEY ("academic_year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "staff_assignments_staff_id_fkey"
FOREIGN KEY ("staff_id") REFERENCES "staff_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "staff_assignments_class_id_fkey"
FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "staff_assignments_subject_id_fkey"
FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
