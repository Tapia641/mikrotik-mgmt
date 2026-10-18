import { describe, expect, it } from 'vitest';

import {
  CryptoError,
  decryptSecret,
  deriveEncryptionKey,
  encryptSecret,
  isEncryptedPayload,
} from './crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');

/** Cambia el primer caracter del tramo (mantiene la longitud base64 valida). */
function tamper(segment: string): string {
  const first = segment.slice(0, 1);
  return (first === 'A' ? 'B' : 'A') + segment.slice(1);
}

describe('deriveEncryptionKey', () => {
  it('acepta una clave hex de 64 caracteres', () => {
    const hex = 'ab'.repeat(32);

    const key = deriveEncryptionKey(hex);

    expect(key).toHaveLength(32);
    expect(key.toString('hex')).toBe(hex);
  });

  it('acepta una clave base64 que decodifica a 32 bytes', () => {
    const raw = Buffer.alloc(32, 3);

    expect(deriveEncryptionKey(raw.toString('base64'))).toEqual(raw);
  });

  it('deriva de forma determinista (SHA-256) para texto libre', () => {
    const first = deriveEncryptionKey('frase-de-paso');
    const second = deriveEncryptionKey('frase-de-paso');

    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(deriveEncryptionKey('otra-frase')).not.toEqual(first);
  });

  it('falla con un mensaje accionable si la clave esta vacia', () => {
    expect(() => deriveEncryptionKey('   ')).toThrow(CryptoError);
    expect(() => deriveEncryptionKey('')).toThrow(/ENCRYPTION_KEY/);
  });
});

describe('encryptSecret / decryptSecret', () => {
  it('hace round-trip del texto, incluidos acentos y emojis', () => {
    const plaintext = 'contraseña-Ünicode-🔐';

    expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('produce payloads distintos para el mismo texto (IV aleatorio)', () => {
    const first = encryptSecret('secreto', KEY);
    const second = encryptSecret('secreto', KEY);

    expect(first).not.toBe(second);
    expect(decryptSecret(first, KEY)).toBe('secreto');
    expect(decryptSecret(second, KEY)).toBe('secreto');
  });

  it('usa el formato versionado v1:iv:tag:data', () => {
    const parts = encryptSecret('x', KEY).split(':');

    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1] ?? '', 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2] ?? '', 'base64')).toHaveLength(16);
  });

  it('detecta un payload manipulado (GCM autenticado)', () => {
    const parts = encryptSecret('secreto', KEY).split(':');
    const payload = `${parts[0]}:${parts[1]}:${parts[2]}:${tamper(parts[3] ?? '')}`;

    expect(() => decryptSecret(payload, KEY)).toThrow(CryptoError);
  });

  it('falla con la clave incorrecta', () => {
    const payload = encryptSecret('secreto', KEY);
    const otherKey = Buffer.alloc(32, 9).toString('base64');

    expect(() => decryptSecret(payload, otherKey)).toThrow(CryptoError);
  });

  it('rechaza payloads con formato invalido', () => {
    expect(() => decryptSecret('no-es-un-payload', KEY)).toThrow(CryptoError);
    expect(() => decryptSecret('v1:solo:dos', KEY)).toThrow(CryptoError);
    expect(() => decryptSecret('v2:a:b:c', KEY)).toThrow(CryptoError);
  });
});

describe('isEncryptedPayload', () => {
  it('reconoce solo los payloads v1 de 4 tramos', () => {
    expect(isEncryptedPayload(encryptSecret('x', KEY))).toBe(true);
    expect(isEncryptedPayload('v1:a:b:c')).toBe(true);
    expect(isEncryptedPayload('texto-plano')).toBe(false);
    expect(isEncryptedPayload('v2:a:b:c')).toBe(false);
  });
});
