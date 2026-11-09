import { Prisma } from '@prisma/client';

export interface DefaultSubject {
  name: string;
  code: string;
  /** Optional subjects are created switched off; the school turns them on per section. */
  isOptional: boolean;
}

/** Used until a school saves its own list in its settings. */
export const DEFAULT_SUBJECTS: DefaultSubject[] = [
  { name: 'Mathematics', code: 'MATH', isOptional: false },
  { name: 'Physics', code: 'PHY', isOptional: false },
  { name: 'Chemistry', code: 'CHEM', isOptional: false },
  { name: 'English', code: 'ENG', isOptional: false },
  { name: 'Science', code: 'SCI', isOptional: false },
  { name: 'Social Studies', code: 'SST', isOptional: false },
  { name: 'Hindi', code: 'HIN', isOptional: false },
  { name: 'Sanskrit', code: 'SKT', isOptional: true },
];

type Client = Prisma.TransactionClient;

/** Upper-case letters and digits from the name, at most 8 characters, such as "SOCIALST". */
export function subjectCode(name: string): string {
  const code = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return code || 'SUBJECT';
}

/** The school's saved default list, or the built-in one. */
export async function defaultSubjects(client: Client, schoolId: string): Promise<DefaultSubject[]> {
  const settings = await client.schoolSettings.findUnique({
    where: { schoolId },
    select: { metadata: true },
  });
  const saved = (settings?.metadata as { defaultSubjects?: unknown } | null)?.defaultSubjects;
  if (!Array.isArray(saved) || !saved.length) return DEFAULT_SUBJECTS;
  return saved
    .filter((item): item is DefaultSubject => typeof item?.name === 'string' && typeof item?.code === 'string')
    .map((item) => ({ name: item.name, code: item.code, isOptional: Boolean(item.isOptional) }));
}

/** Gives a new section its own copy of the default subjects. Optional ones start switched off. */
export async function createSectionSubjects(
  client: Client,
  section: { id: string; schoolId: string; academicYearId: string },
) {
  const subjects = await defaultSubjects(client, section.schoolId);
  await client.subject.createMany({
    data: subjects.map((subject, index) => ({
      schoolId: section.schoolId,
      academicYearId: section.academicYearId,
      sectionId: section.id,
      name: subject.name,
      code: subject.code,
      isOptional: subject.isOptional,
      isEnabled: !subject.isOptional,
      sortOrder: index,
    })),
    skipDuplicates: true,
  });
  return subjects.length;
}
