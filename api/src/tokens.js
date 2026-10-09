import { createHmac, timingSafeEqual } from "node:crypto";

export function signToken(secret, record, purpose, expires) {
  const payload = Buffer.from(JSON.stringify({
    id: record.rowKey,
    generation: record.generation,
    purpose,
    expires,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyToken(secret, token, purpose, now) {
  if (typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const signature = Buffer.from(parts[1], "base64url");
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || !/^[a-f0-9]{64}$/.test(payload.id) ||
      !/^[a-f0-9]{64}$/.test(payload.generation) ||
      payload.purpose !== purpose || !Number.isSafeInteger(payload.expires) ||
      payload.expires <= now) return null;
  return payload;
}
