import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado simetrico de secretos en reposo (contrasenas de router).
 *
 * Algoritmo: AES-256-GCM (cifrado autenticado: detecta manipulacion del
 * payload). La clave se deriva de `ENCRYPTION_KEY`; NUNCA se guarda en claro.
 *
 * Formato serializado (una linea, apta para una columna TEXT):
 *
 *      v1:<iv_base64>:<authTag_base64>:<ciphertext_base64>
 *
 * El prefijo `v1` permite rotar el algoritmo sin migrar datos de golpe.
 *
 * `src/lib` es capa hoja: este modulo no conoce el dominio.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class CryptoError extends Error {
  public override readonly name = 'CryptoError';
}

/**
 * Acepta la clave en el formato que produzca `openssl rand`:
 *  - 64 caracteres hex → 32 bytes exactos.
 *  - base64 que decodifica a 32 bytes exactos.
 *  - cualquier otro texto → SHA-256 (32 bytes) como ultimo recurso.
 */
export function deriveEncryptionKey(secret: string): Buffer {
  const trimmed = secret.trim();
  if (trimmed === '') {
    throw new CryptoError(
      'Falta ENCRYPTION_KEY. Genera una con `openssl rand -base64 32` y anadela a .env',
    );
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.length === KEY_BYTES) {
    return decoded;
  }

  return createHash('sha256').update(trimmed, 'utf8').digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveEncryptionKey(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

export function decryptSecret(payload: string, secret: string): string {
  const parts = payload.split(':');
  const [version, ivPart, tagPart, dataPart] = parts;

  if (parts.length !== 4 || version !== VERSION || !ivPart || !tagPart || !dataPart) {
    throw new CryptoError('Payload cifrado con formato invalido (se esperaba v1:iv:tag:data).');
  }

  const key = deriveEncryptionKey(secret);
  const iv = Buffer.from(ivPart, 'base64');
  const tag = Buffer.from(tagPart, 'base64');

  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError('Payload cifrado con IV o authTag de longitud invalida.');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    throw new CryptoError(
      'No se pudo descifrar: clave incorrecta o payload manipulado.',
      { cause: error },
    );
  }
}

/** `true` si el valor tiene la forma de un payload de este modulo. */
export function isEncryptedPayload(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 4 && parts[0] === VERSION;
}
