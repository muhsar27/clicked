/**
 * Centralised public-key material validator.
 *
 * Every endpoint that accepts identity keys, signed prekeys, one-time prekeys,
 * or MLS key packages must run incoming values through these helpers before
 * touching the database or running crypto operations.
 *
 * Byte-length constants follow the Signal / X3DH / MLS specs:
 *   - Ed25519 raw public key          : 32 bytes
 *   - Ed25519 SPKI DER wrapper        : 44 bytes (12-byte header + 32-byte key)
 *   - Ed25519 signature               : 64 bytes
 *   - X25519 / Curve25519 public key  : 32 bytes
 *   - MLS key package (variable)      : 32 – 4096 bytes
 */

import { createVerify } from 'node:crypto';
import { z } from 'zod';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Raw Ed25519 public key: 32 bytes → 44 base64 chars (with padding). */
export const ED25519_RAW_KEY_B64_LENGTH = 44;

/**
 * Ed25519 SPKI DER public key: 44 bytes → 64 base64 chars (with padding).
 * This is the format Node's createVerify expects via { format: 'der', type: 'spki' }.
 */
export const ED25519_SPKI_B64_LENGTH = 64;

/** Ed25519 signature: 64 bytes → 88 base64 chars (with padding). */
export const ED25519_SIG_B64_LENGTH = 88;

/** Minimum / maximum byte lengths for an MLS KeyPackage TLS encoding. */
export const MLS_KEY_PACKAGE_MIN_BYTES = 32;
export const MLS_KEY_PACKAGE_MAX_BYTES = 4096;

// ─── Low-level helpers ────────────────────────────────────────────────────────

export function isValidBase64(s: string): boolean {
  if (!s) return false;
  return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && s.length % 4 === 0;
}

export function base64ByteLength(s: string): number {
  if (!isValidBase64(s)) return -1;
  const padding = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length * 3) / 4 - padding;
}

// ─── Zod refinements ─────────────────────────────────────────────────────────

function b64LengthRefinement(expectedBytes: number, label: string) {
  return (val: string, ctx: z.RefinementCtx) => {
    if (!isValidBase64(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be valid base64` });
      return;
    }
    const len = base64ByteLength(val);
    if (len !== expectedBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} must be ${expectedBytes} bytes (got ${len})`,
      });
    }
  };
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

export const IdentityPublicKeySchema = z
  .string()
  .min(1, 'identityPublicKey is required')
  .superRefine(b64LengthRefinement(ED25519_SPKI_B64_LENGTH, 'identityPublicKey'));

export const PreKeyPublicKeySchema = z
  .string()
  .min(1, 'publicKey is required')
  .superRefine(b64LengthRefinement(ED25519_RAW_KEY_B64_LENGTH, 'publicKey'));

export const SignatureSchema = z
  .string()
  .min(1, 'signature is required')
  .superRefine(b64LengthRefinement(ED25519_SIG_B64_LENGTH, 'signature'));

/**
 * No endpoint currently accepts MLS key packages — this schema exists so one
 * is ready to route through it as soon as such an endpoint is added.
 */
export const MlsKeyPackageSchema = z
  .string()
  .min(1, 'keyPackage is required')
  .superRefine((val, ctx) => {
    if (!isValidBase64(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'keyPackage must be valid base64' });
      return;
    }
    const len = base64ByteLength(val);
    if (len < MLS_KEY_PACKAGE_MIN_BYTES || len > MLS_KEY_PACKAGE_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `keyPackage must be ${MLS_KEY_PACKAGE_MIN_BYTES}–${MLS_KEY_PACKAGE_MAX_BYTES} bytes (got ${len})`,
      });
    }
  });

// ─── Composite schemas ────────────────────────────────────────────────────────

export const PreKeyEntrySchema = z.object({
  keyId: z.number().int().nonnegative(),
  publicKey: PreKeyPublicKeySchema,
});

export const SignedPreKeyEntrySchema = PreKeyEntrySchema.extend({
  signature: SignatureSchema,
});

// ─── Signature verification ───────────────────────────────────────────────────

export function verifyEd25519Signature(
  identityPublicKeyB64: string,
  publicKeyB64: string,
  signatureB64: string,
): boolean {
  try {
    const identityKeyDer = Buffer.from(identityPublicKeyB64, 'base64');
    const publicKeyBytes = Buffer.from(publicKeyB64, 'base64');
    const signatureBytes = Buffer.from(signatureB64, 'base64');
    const verifier = createVerify('Ed25519');
    verifier.update(publicKeyBytes);
    return verifier.verify({ key: identityKeyDer, format: 'der', type: 'spki' }, signatureBytes);
  } catch {
    return false;
  }
}
