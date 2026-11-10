import { randomInt } from 'node:crypto';

/**
 * The app-made Teacher ID: "T", the 2-digit joining year, then a running count of every teacher
 * the school has registered: A01 to A99, then B01. T26A05 is the 5th teacher, joined 2026.
 * The count never goes back, so an ID is never reused, even after a teacher leaves.
 */
export function teacherCode(joiningYear: number, count: number): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('The teacher count starts at 1');
  }
  const block = Math.floor((count - 1) / 99);
  if (block > 25) {
    throw new Error('This school has used every Teacher ID from A01 to Z99');
  }
  const letter = String.fromCharCode(65 + block);
  const number = String(((count - 1) % 99) + 1).padStart(2, '0');
  return `T${String(joiningYear % 100).padStart(2, '0')}${letter}${number}`;
}

/** Letters and digits that cannot be mistaken for each other when read aloud or written. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * A random first password such as "Kq7m-x3Tp", shown once to the Admin who hands it over.
 * The account must change it at first login.
 */
export function randomFirstPassword(): string {
  const pick = (length: number) =>
    Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${pick(4)}-${pick(4)}`;
}
