import argon2 from "argon2";

export async function hashPassword(password: string) {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(password: string, storedHash: string) {
  return await argon2.verify(storedHash, password);
}
