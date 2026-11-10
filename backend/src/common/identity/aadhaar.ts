import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * Aadhaar numbers are never stored in plain text. Each one is kept as:
 * - an AES-256-GCM encrypted value, readable only by the server with PII_ENCRYPTION_KEY;
 * - its last 4 digits, for the masked display XXXX XXXX 1234;
 * - a keyed HMAC, so the same number cannot be registered twice in a school without the
 *   database ever holding something that can be reversed or looked up in a table.
 */

const VERSION = 'v1';

// Verhoeff tables: every real Aadhaar number passes this checksum.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Digits only, so "2345 6789 0123" and "234567890123" are the same number. */
export function normaliseAadhaar(value: string): string {
  return value.replace(/\D/g, '');
}

/** 12 digits, not starting with 0 or 1, and a valid Verhoeff checksum. */
export function isValidAadhaar(value: string): boolean {
  const digits = normaliseAadhaar(value);
  if (!/^[2-9]\d{11}$/.test(digits)) return false;
  let check = 0;
  [...digits].reverse().forEach((digit, index) => {
    check = D[check][P[index % 8][Number(digit)]];
  });
  return check === 0;
}

export function maskAadhaar(last4: string | null | undefined): string | null {
  return last4 ? `XXXX XXXX ${last4}` : null;
}

interface Keys {
  encryption: Buffer;
  hashing: Buffer;
}

let cached: Keys | null = null;

/** Two separate keys derived from PII_ENCRYPTION_KEY (32 random bytes, base64). */
function keys(): Keys {
  if (cached) return cached;
  const raw = process.env.PII_ENCRYPTION_KEY;
  const secret = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (secret.length !== 32) {
    throw new Error('PII_ENCRYPTION_KEY must be set to 32 random bytes in base64 to store Aadhaar numbers');
  }
  const derive = (info: string) =>
    Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), info, 32));
  cached = { encryption: derive('aadhaar-encryption'), hashing: derive('aadhaar-hash') };
  return cached;
}

export function hasPiiKey(): boolean {
  try {
    keys();
    return true;
  } catch {
    return false;
  }
}

/** The stored form of an Aadhaar number. Throws if the number is invalid. */
export function protectAadhaar(value: string, schoolId: string) {
  const digits = normaliseAadhaar(value);
  if (!isValidAadhaar(digits)) {
    throw new Error('Invalid Aadhaar number');
  }
  const { encryption } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryption, iv);
  const encrypted = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    aadhaarEncrypted: [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':'),
    aadhaarLast4: digits.slice(-4),
    aadhaarHash: aadhaarHash(digits, schoolId),
  };
}

/** Keyed hash scoped to the school, used only to find duplicates. */
export function aadhaarHash(value: string, schoolId: string): string {
  return createHmac('sha256', keys().hashing)
    .update(`${schoolId}:${normaliseAadhaar(value)}`)
    .digest('base64');
}

export function revealAadhaar(stored: string): string {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !iv || !tag || !data) {
    throw new Error('Unknown Aadhaar storage format');
  }
  const decipher = createDecipheriv('aes-256-gcm', keys().encryption, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
