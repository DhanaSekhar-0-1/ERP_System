/**
 * The first password the school hands to a family: the first 4 letters of the family name
 * (first letter capital, the rest small), "@", and the last 4 digits of the parent's mobile.
 * Reddy and 94401 23456 give "Redd@3456"; Rao and 98765 43210 give "Rao@3210".
 *
 * It is easy to guess for anyone who knows the family, so the account is always marked to
 * change it at first login; that forced change is what keeps it safe.
 */
export function studentFirstPassword(familyName: string, parentMobile: string): string {
  const letters = familyName.replace(/[^A-Za-z]/g, '');
  const digits = parentMobile.replace(/\D/g, '');
  if (!letters) {
    throw new Error('The family name needs at least one letter to make the first password');
  }
  if (digits.length < 4) {
    throw new Error("The parent's mobile needs at least 4 digits to make the first password");
  }
  const part = letters.slice(0, 4);
  return `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}@${digits.slice(-4)}`;
}

/** A 10-digit Indian mobile number, allowing spaces, dashes and a +91 or 0 prefix. */
export function normaliseMobile(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}
