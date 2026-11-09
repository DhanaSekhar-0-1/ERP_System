import type { ClassDetail, SectionSubject, Staff } from '@erp/shared';
import { fullName } from '@erp/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ConfirmDialog, Dialog, DialogButtons, Field, FormError } from '../components/Dialog';
import { Card, errorText, ghostButtonClass, inputClass, Message, PageHeader } from '../components/ui';

type Section = ClassDetail['sections'][number];
const TABS = ['Sections', 'Subjects', 'Teacher assignments', 'Students'] as const;
type Tab = (typeof TABS)[number];

function useRefresh() {
  const client = useQueryClient();
  return async () => {
    await client.invalidateQueries({ queryKey: ['class-detail'] });
    await client.invalidateQueries({ queryKey: ['class-cards'] });
    await client.invalidateQueries({ queryKey: ['teacher-assignments'] });
  };
}

function nextSectionName(sections: Section[]) {
  const used = new Set(sections.map((section) => section.name));
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (!used.has(letter)) return letter;
  }
  return '';
}

function SectionDialog({ detail, existing, onClose }: { detail: ClassDetail; existing?: Section; onClose(): void }) {
  const refresh = useRefresh();
  const [name, setName] = useState(existing?.name ?? nextSectionName(detail.sections));
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.renameSection(existing.id, name.trim())
        : api.createSection({ academicYearId: detail.academicYearId, classId: detail.id, name: name.trim() }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Dialog
      title={existing ? `Rename Section ${existing.name}` : `Add a section to ${detail.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      footer={<DialogButtons onClose={onClose} pending={save.isPending} label={existing ? 'Rename' : 'Add section'} />}
    >
      <Field label="Section name">
        <input required autoFocus maxLength={10} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
      </Field>
      {!existing && <p className="text-xs text-muted">The section gets its own copy of the default subjects.</p>}
      <FormError error={save.error} />
    </Dialog>
  );
}

function SubjectDialog({ section, existing, onClose }: { section: Section; existing?: SectionSubject; onClose(): void }) {
  const refresh = useRefresh();
  const [name, setName] = useState(existing?.name ?? '');
  const [code, setCode] = useState(existing?.code ?? '');
  const [isOptional, setIsOptional] = useState(existing?.isOptional ?? false);
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.updateSubject(existing.id, { name: name.trim(), code: code.trim() || undefined, isOptional })
        : api.addSectionSubject(section.id, { name: name.trim(), code: code.trim() || undefined, isOptional }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
  });
  return (
    <Dialog
      title={existing ? `Edit ${existing.name}` : `Add a subject to Section ${section.name}`}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      footer={<DialogButtons onClose={onClose} pending={save.isPending} label={existing ? 'Save' : 'Add subject'} />}
    >
      <Field label="Subject name">
        <input required autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
      </Field>
      <Field label="Code (optional)">
        <input maxLength={12} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Made from the name" className={`${inputClass} font-mono uppercase`} />
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={isOptional} onChange={(event) => setIsOptional(event.target.checked)} className="size-4" />
        Optional subject (can be switched off, like Sanskrit)
      </label>
      <p className="text-xs text-muted">Changes apply to Section {section.name} only.</p>
      <FormError error={save.error} />
    </Dialog>
  );
}

function SectionsTab({ detail, canManage }: { detail: ClassDetail; canManage: boolean }) {
  const refresh = useRefresh();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Section | null>(null);
  const [deleting, setDeleting] = useState<Section | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSection(id),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
    },
  });
  return (
    <Card
      title={`${detail.sections.length} section(s)`}
    >
      {canManage && (
        <button onClick={() => setAdding(true)} className={`${ghostButtonClass} mb-4`}>
          <Plus className="size-4" aria-hidden /> Add section
        </button>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {detail.sections.map((section) => (
          <div key={section.id} className="rounded-xl border border-line p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-extrabold">Section {section.name}</h3>
              {canManage && (
                <div className="flex gap-1">
                  <button onClick={() => setRenaming(section)} aria-label={`Rename Section ${section.name}`} className="rounded-lg p-1.5 text-muted hover:bg-page">
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    onClick={() => setDeleting(section)}
                    disabled={detail.sections.length === 1}
                    title={detail.sections.length === 1 ? 'A class must keep at least one section' : undefined}
                    aria-label={`Delete Section ${section.name}`}
                    className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </div>
            <dl className="mt-2 grid gap-1 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Students</dt><dd className="font-semibold">{section.students}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Subjects on</dt><dd className="font-semibold">{section.subjects.filter((s) => s.isEnabled).length}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Class teacher</dt><dd className="truncate font-semibold">{section.classTeacher?.displayName ?? 'Not set'}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      {adding && <SectionDialog detail={detail} onClose={() => setAdding(false)} />}
      {renaming && <SectionDialog detail={detail} existing={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete Section ${deleting.name}?`}
          message="This removes the section with its subjects, subject teachers and class teacher. Sections with students, exams, homework or a timetable cannot be deleted."
          confirmLabel="Delete section"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => {
            remove.reset();
            setDeleting(null);
          }}
        />
      )}
    </Card>
  );
}

function SectionPicker({ sections, value, onChange }: { sections: Section[]; value: string; onChange(id: string): void }) {
  return (
    <div role="tablist" aria-label="Section" className="mb-4 flex flex-wrap gap-2">
      {sections.map((section) => (
        <button
          key={section.id}
          role="tab"
          aria-selected={value === section.id}
          onClick={() => onChange(section.id)}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${value === section.id ? 'bg-ink text-white' : 'border border-line bg-white'}`}
        >
          Section {section.name}
        </button>
      ))}
    </div>
  );
}

function SubjectsTab({ detail, canManage }: { detail: ClassDetail; canManage: boolean }) {
  const refresh = useRefresh();
  const [sectionId, setSectionId] = useState(detail.sections[0]?.id ?? '');
  const section = detail.sections.find((item) => item.id === sectionId) ?? detail.sections[0];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SectionSubject | null>(null);
  const [deleting, setDeleting] = useState<SectionSubject | null>(null);
  const toggle = useMutation({
    mutationFn: (subject: SectionSubject) => api.updateSubject(subject.id, { isEnabled: !subject.isEnabled }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSubject(id),
    onSuccess: async () => {
      await refresh();
      setDeleting(null);
    },
  });
  if (!section) return <Message>No sections.</Message>;
  return (
    <Card>
      <SectionPicker sections={detail.sections} value={section.id} onChange={setSectionId} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Subjects of Section {section.name}. Changes here do not affect other sections.</p>
        {canManage && (
          <button onClick={() => setAdding(true)} className={ghostButtonClass}>
            <Plus className="size-4" aria-hidden /> Add subject
          </button>
        )}
      </div>
      {toggle.isError && <p role="alert" className="mb-2 text-sm text-red-600">{errorText(toggle.error)}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr><th className="pb-2">Subject</th><th className="pb-2">Code</th><th className="pb-2">Type</th><th className="pb-2">Status</th><th className="pb-2">Teacher</th><th className="pb-2" /></tr>
          </thead>
          <tbody>
            {section.subjects.map((subject) => (
              <tr key={subject.id} className={`border-t border-line ${subject.isEnabled ? '' : 'text-muted'}`}>
                <td className="py-2.5 font-semibold">{subject.name}</td>
                <td className="py-2.5 font-mono text-xs">{subject.code}</td>
                <td className="py-2.5">{subject.isOptional ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Optional</span> : 'Core'}</td>
                <td className="py-2.5">
                  {subject.isOptional && canManage ? (
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input type="checkbox" aria-label={`${subject.name} switched on for Section ${section.name}`} checked={subject.isEnabled} disabled={toggle.isPending} onChange={() => toggle.mutate(subject)} className="size-4" />
                      {subject.isEnabled ? 'On' : 'Off'}
                    </label>
                  ) : subject.isEnabled ? 'On' : 'Off'}
                </td>
                <td className="py-2.5">{subject.teachers.map((t) => t.displayName).join(', ') || '—'}</td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  {canManage && (
                    <>
                      <button onClick={() => setEditing(subject)} aria-label={`Edit ${subject.name}`} className="rounded-lg p-1.5 text-muted hover:bg-page"><Pencil className="size-4" aria-hidden /></button>
                      <button onClick={() => setDeleting(subject)} aria-label={`Remove ${subject.name}`} className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" aria-hidden /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <SubjectDialog section={section} onClose={() => setAdding(false)} />}
      {editing && <SubjectDialog section={section} existing={editing} onClose={() => setEditing(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Remove ${deleting.name} from Section ${section.name}?`}
          message="Its teacher assignment is removed too. Subjects already used by exams, homework or a timetable cannot be removed; switch optional ones off instead."
          confirmLabel="Remove subject"
          pending={remove.isPending}
          error={remove.error}
          onConfirm={() => remove.mutate(deleting.id)}
          onClose={() => {
            remove.reset();
            setDeleting(null);
          }}
        />
      )}
    </Card>
  );
}

export function TeacherSelect({ staff, value, onChange, disabled, label }: {
  staff: Staff[];
  value: string;
  onChange(staffId: string): void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={`${inputClass} w-full min-w-44 py-2`}>
      <option value="">— Not assigned —</option>
      {staff.filter((member) => member.user.status === 'ACTIVE').map((member) => (
        <option key={member.id} value={member.id}>{member.user.displayName} ({member.employeeNo})</option>
      ))}
    </select>
  );
}

/** Class teacher plus one teacher per switched-on subject, for one section. */
export function SectionAssignmentEditor({ sectionId, sectionLabel, classTeacherId, subjects, canAssign }: {
  sectionId: string;
  sectionLabel: string;
  classTeacherId: string;
  subjects: { subjectId: string; name: string; isOptional: boolean; teacherId: string }[];
  canAssign: boolean;
}) {
  const refresh = useRefresh();
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  const classTeacher = useMutation({ mutationFn: (staffId: string) => api.setClassTeacher(sectionId, staffId || null), onSuccess: refresh });
  const subjectTeacher = useMutation({
    mutationFn: ({ subjectId, staffId }: { subjectId: string; staffId: string }) => api.setSubjectTeacher(subjectId, staffId || null),
    onSuccess: refresh,
  });
  const error = classTeacher.error ?? subjectTeacher.error;
  return (
    <div>
      <div className="mb-3 grid items-center gap-2 rounded-xl bg-brand-soft p-3 sm:grid-cols-[1fr_minmax(14rem,20rem)]">
        <span className="text-sm font-bold text-brand">Class teacher of {sectionLabel}</span>
        <TeacherSelect label={`Class teacher of ${sectionLabel}`} staff={staff.data ?? []} value={classTeacherId} disabled={!canAssign || classTeacher.isPending} onChange={(id) => classTeacher.mutate(id)} />
      </div>
      <div className="grid gap-2">
        {subjects.map((subject) => (
          <div key={subject.subjectId} className="grid items-center gap-2 border-t border-line pt-2 sm:grid-cols-[1fr_minmax(14rem,20rem)]">
            <span className="text-sm font-semibold">
              {subject.name}
              {subject.isOptional && <span className="ml-2 text-xs text-muted">optional</span>}
            </span>
            <TeacherSelect
              label={`${subject.name} teacher for ${sectionLabel}`}
              staff={staff.data ?? []}
              value={subject.teacherId}
              disabled={!canAssign || subjectTeacher.isPending}
              onChange={(staffId) => subjectTeacher.mutate({ subjectId: subject.subjectId, staffId })}
            />
          </div>
        ))}
        {subjects.length === 0 && <p className="text-sm text-muted">No subjects switched on.</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{errorText(error)}</p>}
    </div>
  );
}

function AssignmentsTab({ detail, canAssign }: { detail: ClassDetail; canAssign: boolean }) {
  const [sectionId, setSectionId] = useState(detail.sections[0]?.id ?? '');
  const section = detail.sections.find((item) => item.id === sectionId) ?? detail.sections[0];
  if (!section) return <Message>No sections.</Message>;
  return (
    <Card>
      <SectionPicker sections={detail.sections} value={section.id} onChange={setSectionId} />
      <SectionAssignmentEditor
        key={section.id}
        sectionId={section.id}
        sectionLabel={`${detail.name}-${section.name}`}
        canAssign={canAssign}
        classTeacherId={section.classTeacher?.staffId ?? ''}
        subjects={section.subjects
          .filter((subject) => subject.isEnabled)
          .map((subject) => ({ subjectId: subject.id, name: subject.name, isOptional: subject.isOptional, teacherId: subject.teachers[0]?.staffId ?? '' }))}
      />
    </Card>
  );
}

function StudentsTab({ detail }: { detail: ClassDetail }) {
  const [sectionId, setSectionId] = useState(detail.sections[0]?.id ?? '');
  const section = detail.sections.find((item) => item.id === sectionId) ?? detail.sections[0];
  const students = useQuery({
    queryKey: ['section-students', section?.id],
    queryFn: () => api.sectionStudents(section!.id),
    enabled: Boolean(section),
  });
  if (!section) return <Message>No sections.</Message>;
  return (
    <Card>
      <SectionPicker sections={detail.sections} value={section.id} onChange={setSectionId} />
      {students.isLoading && <Message>Loading students…</Message>}
      {students.isError && <Message tone="error">{errorText(students.error)}</Message>}
      {students.data?.length === 0 && <Message>No students enrolled in Section {section.name}.</Message>}
      {Boolean(students.data?.length) && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted"><tr><th className="pb-2">Roll</th><th className="pb-2">Name</th><th className="pb-2">Admission no.</th></tr></thead>
          <tbody>
            {students.data?.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="py-2">{row.rollNumber ?? '—'}</td>
                <td className="py-2 font-semibold">{fullName(row.student)}</td>
                <td className="py-2 font-mono text-xs">{row.student.admissionNo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function ClassDetailPage() {
  const { classId = '' } = useParams();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const [tab, setTab] = useState<Tab>('Sections');
  const detail = useQuery({ queryKey: ['class-detail', classId], queryFn: () => api.classDetail(classId) });
  const panels: Record<Tab, (data: ClassDetail) => ReactNode> = {
    Sections: (data) => <SectionsTab detail={data} canManage={permissions.includes('sections:manage')} />,
    Subjects: (data) => <SubjectsTab detail={data} canManage={permissions.includes('subjects:manage')} />,
    'Teacher assignments': (data) => <AssignmentsTab detail={data} canAssign={permissions.includes('staff-assignments:manage')} />,
    Students: (data) => <StudentsTab detail={data} />,
  };

  return (
    <>
      <Link to="/classes" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All classes
      </Link>
      <PageHeader title={detail.data?.name ?? 'Class'} subtitle="Sections, subjects, teachers and students" />
      {detail.isLoading && <Message>Loading class…</Message>}
      {detail.isError && <Message tone="error">{errorText(detail.error)}</Message>}
      {detail.data && (
        <>
          <div role="tablist" aria-label="Class details" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
            {TABS.map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={tab === name}
                onClick={() => setTab(name)}
                className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-bold ${tab === name ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'}`}
              >
                {name}
              </button>
            ))}
          </div>
          {panels[tab](detail.data)}
        </>
      )}
    </>
  );
}
