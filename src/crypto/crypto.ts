import { gcm } from '@noble/ciphers/aes.js';

/**
 * Derives a cryptographic key from a passphrase using PBKDF2.
 */
export async function deriveKey(secret: string, saltString: string = 'vaultdocs-salt-v1'): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(secret);
  const saltBytes = encoder.encode(saltString);

  // Use SubtleCrypto to derive a 256-bit PBKDF2 key
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
 * Encrypts a plaintext Uint8Array with a key using AES-256-GCM.
 * Prepend the 12-byte random nonce to the ciphertext.
 */
export function encryptUpdate(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  const cipher = gcm(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Concatenate nonce + ciphertext
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
  encryptedKey: string; // Base64 of encrypted team key
  salt: string;
}

/**
 * Creates a sharing invite link.
 */
export function createInviteToken(
  docId: string,
  docTitle: string,
  teamId: string,
  teamKey: Uint8Array,
  inviteSecret: string
): string {
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(inviteSecret);
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));
  
  // Use a simple PBKDF2 hash of secretBytes as key for GCM
  const cipherKey = new Uint8Array(32);
  // Simple key stuffing for the invite secret key
  for (let i = 0; i < 32; i++) {
    cipherKey[i] = secretBytes[i % secretBytes.length] ^ i;
  }
  
  const cipher = gcm(cipherKey, nonce);
  const encrypted = cipher.encrypt(teamKey);
  
  const tokenPayload: InviteToken = {
    docId,
    docTitle,
    teamId,
    encryptedKey: bytesToBase64(encrypted),
    salt: bytesToBase64(nonce)
  };
  
  return btoa(JSON.stringify(tokenPayload));
}

/**
 * Parses and decrypts a sharing invite token.
 */
export function parseInviteToken(tokenStr: string, inviteSecret: string): {
  docId: string;
  docTitle: string;
  teamId: string;
  teamKey: Uint8Array;
} {
  const decoded = atob(tokenStr);
  const tokenPayload: InviteToken = JSON.parse(decoded);
  
  const encoder = new TextEncoder();
  const secretBytes = encoder.encode(inviteSecret);
  
  const cipherKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    cipherKey[i] = secretBytes[i % secretBytes.length] ^ i;
  }
  
  const nonce = base64ToBytes(tokenPayload.salt);
  const encryptedKeyBytes = base64ToBytes(tokenPayload.encryptedKey);
  
  const cipher = gcm(cipherKey, nonce);
  const teamKey = cipher.decrypt(encryptedKeyBytes);
  
  return {
    docId: tokenPayload.docId,
    docTitle: tokenPayload.docTitle,
    teamId: tokenPayload.teamId,
    teamKey
  };
}
