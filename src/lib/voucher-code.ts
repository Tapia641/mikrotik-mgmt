/**
 * Generacion de codigos de voucher.
 *
 * Funciones puras, sin I/O ni aleatoriedad no determinista: el llamador inyecta
 * el RNG (`random`) para que los tests sean reproducibles. En produccion se
 * usa `Math.random` por defecto.
 */

const ALPHABETS: Readonly<Record<string, string>> = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  mixed: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numeric: '0123456789',
  alphanumeric: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
};

export type VoucherCharset = 'lower' | 'upper' | 'mixed' | 'numeric' | 'alphanumeric' | 'custom';

export interface VoucherCodeOptions {
  readonly length: number;
  readonly charset: VoucherCharset;
  readonly custom?: string;
}

/** Alfabeto resultante del charset pedido. */
export function resolveAlphabet(options: VoucherCodeOptions): string {
  if (options.charset === 'custom') {
    const custom = options.custom ?? '';

    if (custom.length === 0) throw new Error('El charset "custom" requiere un alfabeto.');

    // Se eliminan duplicados para que cada simbodo tenga peso uniforme.
    return [...new Set(custom)].join('');
  }

  const alphabet = ALPHABETS[options.charset];

  if (alphabet === undefined) throw new Error(`Charset desconocido: ${options.charset}.`);

  return alphabet;
}

/** Un codigo aleatorio de `length` simbolos del alfabeto dado. */
export function generateCode(options: VoucherCodeOptions, random: () => number = Math.random): string {
  const alphabet = resolveAlphabet(options);
  const { length } = options;

  if (!Number.isInteger(length) || length < 1) throw new Error('La longitud debe ser un entero positivo.');

  let code = '';

  for (let index = 0; index < length; index += 1) {
    const position = Math.floor(random() * alphabet.length);
    code += alphabet[position] ?? '';
  }

  return code;
}

export interface VoucherPair {
  readonly code: string;
  readonly password: string | null;
}

/**
 * Genera `quantity` pares (codigo, contrasena) segun el modo.
 *
 * Garantiza unicidad de los codigos dentro del lote (reintenta si colisiona).
 * `maxAttempts` evita un bucle infinito si el espacio es demasiado pequeno.
 */
export function generateVoucherPairs(
  input: {
    readonly mode: 'username-password' | 'username-only' | 'password-only';
    readonly quantity: number;
    readonly codeLength: number;
    readonly charset: VoucherCharset;
    readonly customCharset?: string;
    readonly passwordLength?: number;
    readonly passwordCharset?: VoucherCharset;
    readonly passwordCustomCharset?: string;
    readonly prefix?: string;
    readonly sharedUsername?: string;
  },
  random: () => number = Math.random,
  maxAttempts = 10_000,
): VoucherPair[] {
  const { mode, quantity, codeLength, charset, customCharset, prefix = '', sharedUsername } = input;

  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('La cantidad debe ser un entero positivo.');

  const codeOptions: VoucherCodeOptions = { length: codeLength, charset, custom: customCharset };
  const passwordOptions: VoucherCodeOptions = {
    length: input.passwordLength ?? codeLength,
    charset: input.passwordCharset ?? charset,
    custom: input.passwordCustomCharset ?? customCharset,
  };

  const pairs: VoucherPair[] = [];
  const seen = new Set<string>();
  let attempts = 0;

  while (pairs.length < quantity && attempts < maxAttempts) {
    attempts += 1;

    if (mode === 'password-only') {
      const generated = generateCode(passwordOptions, random);
      const code = `${prefix}${generated}`;

      if (seen.has(code)) continue;
      seen.add(code);
      pairs.push({ code, password: null });
      continue;
    }

    const code = `${prefix}${generateCode(codeOptions, random)}`;

    if (seen.has(code)) continue;
    seen.add(code);

    const password = mode === 'username-only' ? code : generateCode(passwordOptions, random);

    pairs.push({ code, password: mode === 'username-only' ? null : password });
  }

  if (pairs.length < quantity) {
    throw new Error(`No se pudieron generar ${quantity} codigos unicos con el espacio disponible.`);
  }

  return pairs;
}