import bcrypt from 'bcryptjs';

// bcrypt (via the pure-JS bcryptjs) rather than argon2/native bcrypt: this
// backend is bundled inside an Electron desktop installer, and pure-JS
// avoids native-binding/node-gyp rebuild mismatches across dev machines and
// the packaged app's bundled Node/Electron ABI, with no extra build tooling.
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
