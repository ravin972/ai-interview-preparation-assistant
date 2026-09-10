import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  parseStoredHash,
  DEFAULT_SCRYPT_PARAMS,
} from '../src/auth/password.js';

describe('Password storage and verification (D-018 scrypt)', () => {
  it('hashes a valid password into a structured, versioned scrypt string', async () => {
    const password = 'SuperSecretPassword123!';
    const hash = await hashPassword(password);

    expect(hash).toMatch(
      /^scrypt\$v=1\$N=\d+,r=\d+,p=\d+,keylen=\d+\$[0-9a-fA-F]{64}\$[0-9a-fA-F]{128}$/,
    );

    const parsed = parseStoredHash(hash);
    expect(parsed).not.toBeNull();
    expect(parsed!.algorithm).toBe('scrypt');
    expect(parsed!.version).toBe('1');
    expect(parsed!.params).toEqual(DEFAULT_SCRYPT_PARAMS);
    expect(parsed!.salt.length).toBe(32);
    expect(parsed!.hash.length).toBe(64);
  });

  it('successfully verifies a valid password against its stored hash', async () => {
    const password = 'CorrectHorseBatteryStaple42$';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const password = 'CorrectPassword123!';
    const hash = await hashPassword(password);

    const isValid = await verifyPassword('WrongPassword456?', hash);
    expect(isValid).toBe(false);
  });

  it('generates different hashes for identical passwords due to per-user salt', async () => {
    const password = 'IdenticalPassword123';
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    expect(hash1).not.toBe(hash2);

    const parsed1 = parseStoredHash(hash1);
    const parsed2 = parseStoredHash(hash2);
    expect(parsed1!.salt.equals(parsed2!.salt)).toBe(false);
    expect(parsed1!.hash.equals(parsed2!.hash)).toBe(false);

    expect(await verifyPassword(password, hash1)).toBe(true);
    expect(await verifyPassword(password, hash2)).toBe(true);
  });

  it('rejects corrupted or truncated hash bytes', async () => {
    const password = 'MySecurePassword!';
    const hash = await hashPassword(password);

    // Corrupt one character in the hash portion
    const parts = hash.split('$');
    const corruptedHex = parts[4]!.replace(/^[0-9a-f]/, (c) => (c === 'a' ? 'b' : 'a'));
    const corruptedHash = `${parts[0]}$${parts[1]}$${parts[2]}$${parts[3]}$${corruptedHex}`;

    expect(await verifyPassword(password, corruptedHash)).toBe(false);
  });

  it('gracefully handles malformed stored representations', async () => {
    const malformedInputs = [
      '',
      'invalid-string',
      'bcrypt$v=1$N=16384$salt$hash',
      'scrypt$v=bad$N=16384,r=8,p=1,keylen=64$salt$hash',
      'scrypt$v=1$N=abc,r=8,p=1,keylen=64$aabbcc$ddeeff',
      'scrypt$v=1$N=16384,r=8,p=1,keylen=64$not-hex$aabbcc',
      'scrypt$v=1$N=16384,r=8,p=1,keylen=64$aabbcc', // Missing hash part
      null as unknown as string,
      undefined as unknown as string,
    ];

    for (const input of malformedInputs) {
      expect(parseStoredHash(input)).toBeNull();
      expect(await verifyPassword('password', input)).toBe(false);
    }
  });

  it('handles derived key buffer length mismatch before timingSafeEqual', async () => {
    const password = 'TestPassword';
    // Artificially create a hash with wrong keylen (e.g. 32 instead of 64)
    const shortSalt = Buffer.alloc(32, 1).toString('hex');
    const shortHash = Buffer.alloc(32, 2).toString('hex'); // 32 bytes instead of 64
    const mismatchedHash = `scrypt$v=1$N=16384,r=8,p=1,keylen=64$${shortSalt}$${shortHash}`;

    // Derived key for keylen=64 is 64 bytes, but stored hash is 32 bytes
    const result = await verifyPassword(password, mismatchedHash);
    expect(result).toBe(false);
  });
});
