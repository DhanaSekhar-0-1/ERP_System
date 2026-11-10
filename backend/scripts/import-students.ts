/**
 * Imports students from the school's Excel sheet through the API, using the same rules as the
 * registration form (docs/mvp-plan.md, section 6).
 *
 *   npm run import:students -- --template students-template.xlsx
 *       Writes an empty template with the right columns, two example rows and instructions.
 *
 *   npm run import:students -- --file students.xlsx
 *       Dry run: checks every row and lists problems by sheet row. Saves nothing.
 *
 *   npm run import:students -- --file students.xlsx --commit --out logins.csv
 *       Imports, if every row passes, and writes each student's login and first password.
 *
 * Options: --sheet <name> (default: the first sheet), --year <academicYearId> (default: the
 * school's active year). Sign-in comes from the environment, never the command line:
 * IMPORT_LOGIN and IMPORT_PASSWORD (a School Admin or Super Admin), and API_URL (default
 * http://localhost:3000/api/v1). A .csv file works as well as .xlsx.
 */
import * as ExcelJS from 'exceljs';
import { existsSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

// Read backend/.env when present (Node's built-in loader), so IMPORT_LOGIN can live there.
try {
  process.loadEnvFile();
} catch {
  // No .env file: use the shell environment only.
}

const API = (process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const BATCH = 500;

/** Template columns, in order. Required ones are marked * in the template header. */
const COLUMNS: { key: string; title: string; required: boolean; note: string }[] = [
  { key: 'admission_no', title: 'Admission No', required: true, note: "The school's admission number. Also the student's login ID." },
  { key: 'admission_date', title: 'Admission Date', required: true, note: 'For example 12/06/2026 (day first).' },
  { key: 'admission_type', title: 'Admission Type', required: false, note: 'Existing (already studying here) or New. Blank means Existing.' },
  { key: 'class', title: 'Class', required: true, note: 'For example 8 or Class 8. Must already exist in the app for the year.' },
  { key: 'section', title: 'Section', required: true, note: 'For example A.' },
  { key: 'roll_number', title: 'Roll Number', required: false, note: 'Leave blank to use the next free number.' },
  { key: 'first_name', title: 'First Name', required: true, note: '' },
  { key: 'family_name', title: 'Family Name', required: true, note: 'Surname. Used for the first password.' },
  { key: 'gender', title: 'Gender', required: true, note: 'M or F (or Other).' },
  { key: 'date_of_birth', title: 'Date of Birth', required: true, note: 'For example 22/03/2013.' },
  { key: 'parent_name', title: 'Parent Name', required: true, note: '' },
  { key: 'parent_relation', title: 'Parent Relation', required: false, note: 'Father, Mother or Guardian.' },
  { key: 'parent_mobile', title: 'Parent Mobile', required: true, note: '10 digits. Gets the first password and alerts.' },
  { key: 'aadhaar_or_enrolment_no', title: 'Aadhaar or Enrolment No', required: true, note: '12-digit Aadhaar, or the enrolment slip number if not issued yet. Required unless the school turned it off.' },
  { key: 'nfc_card_id', title: 'NFC Card ID', required: true, note: 'Printed or read card number. Required unless the school turned it off.' },
  { key: 'other_parent_name', title: 'Other Parent Name', required: false, note: '' },
  { key: 'other_parent_mobile', title: 'Other Parent Mobile', required: false, note: '' },
  { key: 'email', title: 'Email', required: false, note: '' },
  { key: 'blood_group', title: 'Blood Group', required: false, note: 'For example B+.' },
  { key: 'mother_tongue', title: 'Mother Tongue', required: false, note: '' },
  { key: 'address', title: 'Address', required: false, note: '' },
  { key: 'pin_code', title: 'PIN Code', required: false, note: '6 digits.' },
  { key: 'previous_school', title: 'Previous School', required: false, note: 'Needed when Admission Type is New.' },
  { key: 'last_class_passed', title: 'Last Class Passed', required: false, note: 'Needed when Admission Type is New.' },
  { key: 'previous_percentage', title: 'Previous Percentage', required: false, note: 'Needed when Admission Type is New. 0 to 100.' },
  { key: 'previous_tc_number', title: 'Previous TC Number', required: false, note: '' },
];

/** Other ways schools write the same headings. */
const ALIASES: Record<string, string> = {
  admission_number: 'admission_no', adm_no: 'admission_no', admn_no: 'admission_no',
  date_of_admission: 'admission_date', doa: 'admission_date',
  dob: 'date_of_birth', birth_date: 'date_of_birth',
  surname: 'family_name', last_name: 'family_name',
  father_name: 'parent_name', fathers_name: 'parent_name', guardian_name: 'parent_name',
  mobile: 'parent_mobile', phone: 'parent_mobile', parent_phone: 'parent_mobile', mobile_number: 'parent_mobile',
  aadhaar: 'aadhaar_or_enrolment_no', aadhaar_no: 'aadhaar_or_enrolment_no', aadhar: 'aadhaar_or_enrolment_no', aadhar_no: 'aadhaar_or_enrolment_no',
  card_id: 'nfc_card_id', nfc: 'nfc_card_id', nfc_id: 'nfc_card_id',
  roll_no: 'roll_number', sex: 'gender', pincode: 'pin_code', pin: 'pin_code',
};

interface Args {
  file?: string;
  template?: string;
  sheet?: string;
  year?: string;
  out?: string;
  commit: boolean;
}

interface SheetRow {
  sheetRow: number;
  values: Record<string, string>;
}

interface ImportResult {
  totalRows: number;
  readyToImport: number;
  imported: number;
  alreadyRegistered: { row: number; admissionNo: string }[];
  problems: { row: number; admissionNo: string | null; errors: string[] }[];
  logins: { row: number; admissionNo: string; name: string; section: string; firstPassword: string }[];
  failed: { row: number; admissionNo: string; error: string }[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === '--file') args.file = next();
    else if (flag === '--template') args.template = next();
    else if (flag === '--sheet') args.sheet = next();
    else if (flag === '--year') args.year = next();
    else if (flag === '--out') args.out = next();
    else if (flag === '--commit') args.commit = true;
    else throw new Error(`Unknown option ${flag}`);
  }
  return args;
}

/** "Admission No *", "admission-no" and "ADMISSION NO" all become admission_no. */
function headerKey(title: string): string {
  const key = title
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[''`.]/g, '')
    .trim()
    .replace(/[\s/-]+/g, '_')
    .replace(/_+/g, '_');
  return ALIASES[key] ?? key;
}

/** Cell value as the text the API expects; dates become YYYY-MM-DD. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Excel dates carry no time zone; exceljs gives them as UTC midnight.
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  }
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
  }
  return String(value).trim();
}

async function readSheet(file: string, sheetName?: string): Promise<SheetRow[]> {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const workbook = new ExcelJS.Workbook();
  const worksheet =
    extname(path).toLowerCase() === '.csv'
      ? await workbook.csv.readFile(path)
      : (await workbook.xlsx.readFile(path), sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0]);
  if (!worksheet) throw new Error(sheetName ? `No sheet named ${sheetName}` : 'The workbook has no sheets');

  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
    headers[column] = headerKey(cellText(cell.value));
  });
  const known = new Set(COLUMNS.map((c) => c.key));
  const unknown = headers.filter((h) => h && !known.has(h));
  if (unknown.length) {
    console.log(`Ignoring columns the app does not use: ${unknown.join(', ')}`);
  }
  const missing = COLUMNS.filter((c) => c.required && !headers.includes(c.key)).map((c) => c.title);
  if (missing.length) {
    throw new Error(`The sheet is missing required columns: ${missing.join(', ')}. Run with --template to get the right headings.`);
  }

  const rows: SheetRow[] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const key = headers[column];
      if (key && known.has(key)) values[key] = cellText(cell.value);
    });
    if (Object.values(values).some((v) => v !== '')) rows.push({ sheetRow: rowNumber, values });
  });
  // The template's example rows use EXAMPLE-1 and EXAMPLE-2: never import them, even if left in.
  const examples = rows.filter((r) => /^example/i.test(r.values.admission_no ?? ''));
  if (examples.length) {
    console.log(`Leaving out example rows ${examples.map((r) => r.sheetRow).join(', ')} (admission number starts with EXAMPLE)`);
  }
  return rows.filter((r) => !examples.includes(r));
}

/** Duplicates across the whole file (the API checks within each batch of 500). */
function fileDuplicates(rows: SheetRow[]) {
  const problems: { row: number; message: string }[] = [];
  for (const column of ['admission_no', 'aadhaar_or_enrolment_no', 'nfc_card_id']) {
    const seen = new Map<string, number>();
    for (const { sheetRow, values } of rows) {
      const raw = values[column];
      if (!raw) continue;
      const key = column === 'aadhaar_or_enrolment_no' ? raw.replace(/\D/g, '') : raw.toUpperCase();
      const first = seen.get(key);
      if (first) problems.push({ row: sheetRow, message: `${column} ${raw} is also on row ${first}` });
      else seen.set(key, sheetRow);
    }
  }
  return problems;
}

async function api<T>(path: string, token: string | null, body: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string | string[] } };
  if (!response.ok) {
    const message = json.error?.message;
    throw new Error(`${path} failed (${response.status}): ${Array.isArray(message) ? message.join('; ') : message ?? response.statusText}`);
  }
  return json.data as T;
}

async function signIn(): Promise<string> {
  const identifier = process.env.IMPORT_LOGIN;
  const password = process.env.IMPORT_PASSWORD;
  if (!identifier || !password) {
    throw new Error('Set IMPORT_LOGIN and IMPORT_PASSWORD (a School Admin or Super Admin) in the environment or backend/.env');
  }
  const session = await api<{ session: { access_token: string }; mustChangePassword: boolean }>('/auth/login', null, { identifier, password });
  if (session.mustChangePassword) throw new Error('This account must change its first password before importing');
  return session.session.access_token;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function writeTemplate(path: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  sheet.addRow(COLUMNS.map((c) => (c.required ? `${c.title} *` : c.title)));
  sheet.addRow(['EXAMPLE-1', '12/06/2026', 'Existing', '8', 'A', '', 'Sai Charan', 'Reddy', 'M', '22/03/2013', 'Venkata Reddy', 'Father', '9440123456', '', 'A1B2C3D4', 'Padmavathi', '9440165432', '', 'B+', 'Telugu', '2-45, Main Road, Tenali', '522201', '', '', '', '']);
  sheet.addRow(['EXAMPLE-2', '12/06/2026', 'New', '8', 'A', '', 'Asha', 'Rao', 'F', '11/06/2013', 'Lakshmi Rao', 'Mother', '9876543210', 'Applied: slip 1234/56789/01234', 'A1B2C3D5', '', '', '', 'O+', 'Telugu', '', '', 'ZPHS Tenali', 'Class 7', '82.5', 'TC/2026/118']);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  COLUMNS.forEach((column, index) => {
    const excelColumn = sheet.getColumn(index + 1);
    excelColumn.width = Math.max(14, column.title.length + 4);
    // Keep numbers like mobiles, Aadhaar and admission numbers as text so Excel does not round them.
    if (['admission_no', 'parent_mobile', 'other_parent_mobile', 'aadhaar_or_enrolment_no', 'nfc_card_id', 'pin_code', 'roll_number'].includes(column.key)) {
      excelColumn.numFmt = '@';
    }
  });
  const help = workbook.addWorksheet('How to fill');
  help.addRow(['Column', 'Required', 'How to fill it']).font = { bold: true };
  COLUMNS.forEach((c) => help.addRow([c.title, c.required ? 'Yes' : 'No', c.note]));
  help.addRow([]);
  help.addRow(['Rows 2 and 3 of the Students sheet are examples (admission numbers EXAMPLE-1 and EXAMPLE-2). Delete them; if left in, the import ignores them.']);
  help.getColumn(1).width = 26;
  help.getColumn(2).width = 10;
  help.getColumn(3).width = 90;
  await workbook.xlsx.writeFile(resolve(path));
  console.log(`Template written to ${resolve(path)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.template) return writeTemplate(args.template);
  if (!args.file) {
    throw new Error('Pass --file <students.xlsx> (or --template <file.xlsx> to get a blank template)');
  }

  const rows = await readSheet(args.file, args.sheet);
  console.log(`Read ${rows.length} student rows from ${args.file}`);
  if (!rows.length) return;
  const duplicates = fileDuplicates(rows);

  const token = await signIn();
  const batches: SheetRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

  // Always check everything first; the API row number (index + 2) is mapped back to the sheet row.
  const toSheetRow = (batch: SheetRow[], apiRow: number) => batch[apiRow - 2]?.sheetRow ?? apiRow;
  let ready = 0;
  const skipped: { row: number; admissionNo: string }[] = [];
  const problems: { row: number; admissionNo: string | null; errors: string[] }[] = [];
  for (const batch of batches) {
    const result = await api<ImportResult>('/students/import', token, {
      dryRun: true,
      academicYearId: args.year,
      rows: batch.map((r) => r.values),
    });
    ready += result.readyToImport;
    skipped.push(...result.alreadyRegistered.map((s) => ({ ...s, row: toSheetRow(batch, s.row) })));
    problems.push(...result.problems.map((p) => ({ ...p, row: toSheetRow(batch, p.row) })));
  }
  for (const d of duplicates) {
    const existing = problems.find((p) => p.row === d.row);
    if (existing) existing.errors.push(d.message);
    else problems.push({ row: d.row, admissionNo: rows.find((r) => r.sheetRow === d.row)?.values.admission_no ?? null, errors: [d.message] });
  }
  problems.sort((a, b) => a.row - b.row);

  console.log(`\nReady to import: ${ready}`);
  console.log(`Already registered (will be skipped): ${skipped.length}${skipped.length ? ` (rows ${skipped.map((s) => s.row).join(', ')})` : ''}`);
  console.log(`Rows with problems: ${problems.length}`);
  for (const problem of problems) {
    console.log(`  Row ${problem.row}${problem.admissionNo ? ` (${problem.admissionNo})` : ''}: ${problem.errors.join('; ')}`);
  }
  if (problems.length) {
    console.log('\nFix these rows in the sheet and run again. Nothing was saved.');
    process.exitCode = 1;
    return;
  }
  if (!args.commit) {
    console.log('\nDry run only: nothing was saved. Run again with --commit to import.');
    return;
  }

  const logins: ImportResult['logins'] = [];
  const failed: ImportResult['failed'] = [];
  for (const batch of batches) {
    const result = await api<ImportResult>('/students/import', token, {
      dryRun: false,
      academicYearId: args.year,
      rows: batch.map((r) => r.values),
    });
    logins.push(...result.logins.map((l) => ({ ...l, row: toSheetRow(batch, l.row) })));
    failed.push(...result.failed.map((f) => ({ ...f, row: toSheetRow(batch, f.row) })));
    if (result.problems.length) {
      console.log(`A batch changed between the check and the import; ${result.problems.length} rows were not saved. Run the dry run again.`);
    }
  }
  console.log(`\nImported: ${logins.length}. Failed: ${failed.length}.`);
  for (const f of failed) console.log(`  Row ${f.row} (${f.admissionNo}): ${f.error}`);

  if (logins.length) {
    const out = resolve(args.out ?? `student-logins-${new Date().toISOString().slice(0, 10)}.csv`);
    const lines = ['Row,Admission No (login),Name,Class,First Password'];
    for (const l of logins) {
      lines.push([String(l.row), l.admissionNo, l.name, l.section, l.firstPassword].map(csvCell).join(','));
    }
    writeFileSync(out, `${lines.join('\n')}\n`, 'utf8');
    console.log(`\nLogins written to ${out}`);
    console.log('This file holds first passwords: give each family theirs, then delete the file. Every student must change the password at first login.');
  }
  if (failed.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
