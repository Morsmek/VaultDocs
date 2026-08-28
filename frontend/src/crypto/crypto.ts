import { gcm } from '@noble/ciphers/aes.js';

/**
 * Derives a cryptographic key from a passphrase using PBKDF2.
 */
export async function deriveKey(secret: string, saltString: string = 'vaultdocs-salt-v1'): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  const saltBytes = encoder.encode(saltString);

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await window.crypto.subtle.exportKey('raw', derivedKey);
  return new Uint8Array(rawKey);
}

/**
 * Derive a key using raw salt bytes (for invite tokens).
 */
export async function deriveKeyWithSalt(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  const saltCopy = new Uint8Array(salt);
  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltCopy,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const rawKey = await window.crypto.subtle.exportKey('raw', derivedKey);
  return new Uint8Array(rawKey);
}

/**
 * Encrypts a plaintext Uint8Array with a key using AES-256-GCM.
 * Prepend the 12-byte random nonce to the ciphertext.
 */
export function encryptUpdate(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const cipher = gcm(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  const result = new Uint8Array(nonce.length + ciphertext.length);
  result.set(nonce, 0);
  result.set(ciphertext, nonce.length);
  return result;
}

/**
 * Decrypts a nonce-prepend AES-256-GCM ciphertext using the given key.
 */
export function decryptUpdate(nonceAndCiphertext: Uint8Array, key: Uint8Array): Uint8Array {
  if (nonceAndCiphertext.length < 12) {
    throw new Error('Ciphertext too short (must include 12-byte nonce)');
  }
  const nonce = nonceAndCiphertext.subarray(0, 12);
  const ciphertext = nonceAndCiphertext.subarray(12);

  const cipher = gcm(key, nonce);
  return cipher.decrypt(ciphertext);
}

/**
 * Utility: Converts a Uint8Array to a Base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binString);
}

/**
 * Utility: Converts a Base64 string to a Uint8Array.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binString = atob(base64);
  return Uint8Array.from(binString, (char) => char.charCodeAt(0));
}

/**
 * Generates a random team passphrase.
 */
export function generateRandomPassphrase(): string {
  const array = new Uint8Array(16);
  window.crypto.getRandomValues(array);
  return bytesToBase64(array).replace(/[^a-zA-Z0-9]/g, '').substring(0, 12);
}

/**
 * Interface representing a secure invite token
 */
export interface InviteToken {
  docId: string;
  docTitle: string;
  teamId: string;
  encryptedKey: string; // Base64 of encrypted team key (GCM ciphertext only for v2)
  salt: string; // Base64: v1 = GCM nonce; v2 = PBKDF2 salt
  nonce?: string; // Base64 GCM nonce (v2 only)
  v?: number;
}

/**
 * Creates a sharing invite token (async — uses PBKDF2 to wrap the team key).
 */
export async function createInviteToken(
  docId: string,
  docTitle: string,
  teamId: string,
  teamKey: Uint8Array,
  inviteSecret: string
): Promise<string> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const cipherKey = await deriveKeyWithSalt(inviteSecret, salt);
  const cipher = gcm(cipherKey, nonce);
  const encrypted = cipher.encrypt(teamKey);

  const tokenPayload: InviteToken = {
    docId,
    docTitle,
    teamId,
    encryptedKey: bytesToBase64(encrypted),
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    v: 2
  };

  return btoa(JSON.stringify(tokenPayload));
}

/**
 * Legacy XOR key stuffing used by v1 invite tokens.
 */
function legacyInviteCipherKey(inviteSecret: string): Uint8Array {
  const secretBytes = new TextEncoder().encode(inviteSecret);
  const cipherKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    cipherKey[i] = secretBytes[i % secretBytes.length] ^ i;
  }
  return cipherKey;
}

/**
 * Parses and decrypts a sharing invite token.
 * Supports v2 (PBKDF2) and legacy v1 (XOR stuffing) tokens.
 */
export async function parseInviteToken(tokenStr: string, inviteSecret: string): Promise<{
  docId: string;
  docTitle: string;
  teamId: string;
  teamKey: Uint8Array;
}> {
  const decoded = atob(tokenStr);
  const tokenPayload: InviteToken = JSON.parse(decoded);

  let teamKey: Uint8Array;

  if (tokenPayload.v === 2 && tokenPayload.nonce) {
    const salt = base64ToBytes(tokenPayload.salt);
    const nonce = base64ToBytes(tokenPayload.nonce);
    const encryptedKeyBytes = base64ToBytes(tokenPayload.encryptedKey);
    const cipherKey = await deriveKeyWithSalt(inviteSecret, salt);
    const cipher = gcm(cipherKey, nonce);
    teamKey = cipher.decrypt(encryptedKeyBytes);
  } else {
    // Legacy v1: salt field held the GCM nonce; weak XOR-derived key
    const cipherKey = legacyInviteCipherKey(inviteSecret);
    const nonce = base64ToBytes(tokenPayload.salt);
    const encryptedKeyBytes = base64ToBytes(tokenPayload.encryptedKey);
    const cipher = gcm(cipherKey, nonce);
    teamKey = cipher.decrypt(encryptedKeyBytes);
  }

  return {
    docId: tokenPayload.docId,
    docTitle: tokenPayload.docTitle,
    teamId: tokenPayload.teamId,
    teamKey
  };
}
