/**
 * Checks a new password before it is sent, so web and phone give the same messages.
 * The server also requires at least 8 characters and a password different from the current one.
 * Returns the problem to show, or null when the password is fine.
 */
export function newPasswordProblem(newPassword: string, confirm: string, current: string): string | null {
  if (newPassword.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return 'Use at least one letter and one number.';
  }
  if (newPassword === current) return 'Choose a password different from the first one.';
  if (newPassword !== confirm) return 'The two new passwords do not match.';
  return null;
}
