import crypto from 'node:crypto';

function scryptPromise(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
}

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keylen: number;
}

export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 16384,
  r: 8,
  p: 1,
  keylen: 64,
};

export const SALT_BYTES = 32;

export interface ParsedHash {
  algorithm: string;
  version: string;
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

/**
 * Parse a structured, versioned scrypt hash string:
 * scrypt$v=1$N=16384,r=8,p=1,keylen=64$<salt_hex>$<hash_hex>
 */
export function parseStoredHash(stored: string): ParsedHash | null {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 5) return null;

  const [algorithm, versionPart, paramsPart, saltHex, hashHex] = parts;
  if (algorithm !== 'scrypt' || !versionPart || !paramsPart || !saltHex || !hashHex) {
    return null;
  }

  const versionMatch = /^v=(\d+)$/.exec(versionPart);
  if (!versionMatch) return null;
  const version = versionMatch[1]!;

  const params: Partial<ScryptParams> = {};
  for (const pair of paramsPart.split(',')) {
    const [k, v] = pair.split('=');
    if (!k || !v) return null;
    const num = Number(v);
    if (!Number.isFinite(num) || num <= 0) return null;
    if (k === 'N') params.N = num;
    else if (k === 'r') params.r = num;
    else if (k === 'p') params.p = num;
    else if (k === 'keylen') params.keylen = num;
  }

  if (!params.N || !params.r || !params.p || !params.keylen) {
    return null;
  }

  // Verify hex strings
  if (!/^[0-9a-fA-F]+$/.test(saltHex) || !/^[0-9a-fA-F]+$/.test(hashHex)) {
    return null;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const hash = Buffer.from(hashHex, 'hex');

  return {
    algorithm,
    version,
    params: params as ScryptParams,
    salt,
    hash,
  };
}

/**
 * Hash a plaintext password using scrypt with per-user random salt.
 * Encodes all parameters into a versioned, reproducible string.
 */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
  saltOverride?: Buffer,
): Promise<string> {
  const salt = saltOverride ?? crypto.randomBytes(SALT_BYTES);
  const derivedKey = await scryptPromise(password, salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
  });

  const paramStr = `N=${params.N},r=${params.r},p=${params.p},keylen=${params.keylen}`;
  return `scrypt$v=1$${paramStr}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Verify a password against a stored versioned scrypt hash.
 * Constant-time comparison with length checks.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;

  try {
    const derivedKey = await scryptPromise(password, parsed.salt, parsed.params.keylen, {
      N: parsed.params.N,
      r: parsed.params.r,
      p: parsed.params.p,
    });

    // Invariant: Buffers must be equal length before timingSafeEqual
    if (derivedKey.length !== parsed.hash.length) {
      return false;
    }

    return crypto.timingSafeEqual(derivedKey, parsed.hash);
  } catch {
    return false;
  }
}
