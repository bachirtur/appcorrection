import * as crypto from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Sans caractères ambigus (0, O, 1, I)

export function generateSecureReadableCode(groups = 3, groupLen = 4): string {
  const total = groups * groupLen;
  const bytes = crypto.randomBytes(total * 2);
  let chars = '';
  let idx = 0;
  while (chars.length < total && idx < bytes.length) {
    const val = bytes[idx++];
    const maxUnbiased = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
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

export function hashSecretCode(plainCode: string, existingSalt?: string): { hash: string; salt: string } {
  const normalized = plainCode.trim().toUpperCase().replace(/\s+/g, '');
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(normalized, salt, 64).toString('hex');
  return { hash: derived, salt };
}

export function verifySecretCode(plainCode: string, expectedHash: string, salt: string): boolean {
  if (!plainCode || !expectedHash || !salt) return false;
  const { hash } = hashSecretCode(plainCode, salt);
  const bufA = Buffer.from(hash, 'hex');
  const bufB = Buffer.from(expectedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSessionToken(sessionId: string, secretKey: string, expiresAtMs: number): string {
  const payload = `${sessionId}.${expiresAtMs}`;
  const sig = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string, expectedSessionId: string, secretKey: string): boolean {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return false;
  const [sid, expStr, sig] = parts;
  if (sid !== expectedSessionId) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expectedSig = crypto.createHmac('sha256', secretKey).update(`${sid}.${expStr}`).digest('hex');
  const bufA = Buffer.from(sig, 'hex');
  const bufB = Buffer.from(expectedSig, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
