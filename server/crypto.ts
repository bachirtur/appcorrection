import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Clé HMAC générée aléatoirement au démarrage si non fournie dans l'environnement serveur
const RUNTIME_HMAC_SECRET =
  process.env.SESSION_HMAC_SECRET || crypto.randomBytes(48).toString('hex');

export function generateSecureReadableCode(groups = 3, groupLen = 4): string {
  const total = groups * groupLen;
  const bytes = crypto.randomBytes(total * 2);
  let chars = '';
  let idx = 0;
  const maxUnbiased = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (chars.length < total && idx < bytes.length) {
    const val = bytes[idx++];
    if (val < maxUnbiased) {
      chars += ALPHABET[val % ALPHABET.length];
    }
  }
  while (chars.length < total) {
    chars += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) {
    parts.push(chars.slice(i * groupLen, (i + 1) * groupLen));
  }
  return parts.join('-');
}

export function generateExamPublicId(): string {
  const year = new Date().getUTCFullYear();
  return `EXM-${year}-${generateSecureReadableCode(1, 6)}`;
}

export function generateSubmissionPublicId(): string {
  const year = new Date().getUTCFullYear();
  return `SUB-${year}-${generateSecureReadableCode(1, 6)}`;
}

export function hashPasswordOrCode(plain: string, normalizeUpper = false, existingSalt?: string): {
  hash: string;
  salt: string;
} {
  const normalized = normalizeUpper
    ? plain.trim().toUpperCase().replace(/\s+/g, '')
    : plain;
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return { hash, salt };
}

export function verifyPasswordOrCode(
  plain: string,
  expectedHash: string,
  salt: string,
  normalizeUpper = false
): boolean {
  if (!plain || !expectedHash || !salt) return false;
  const { hash } = hashPasswordOrCode(plain, normalizeUpper, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface SignedTokenPayload {
  kind: 'teacher' | 'student_session' | 'pdf_access' | 'password_reset';
  sub: string;
  scope?: string;
  exp: number;
}

export function signToken(payload: SignedTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', RUNTIME_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyToken(token: string | undefined, expectedKind: SignedTokenPayload['kind']): SignedTokenPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', RUNTIME_HMAC_SECRET)
    .update(encoded)
    .digest('base64url');
  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedTokenPayload;
    if (parsed.kind !== expectedKind) return null;
    if (!Number.isFinite(parsed.exp) || Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function computeStudentFingerprint(
  firstName: string,
  lastName: string,
  className: string,
  email?: string
): string {
  const raw = [
    (lastName || '').trim().toLowerCase(),
    (firstName || '').trim().toLowerCase(),
    (className || '').trim().toLowerCase(),
    (email || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}
