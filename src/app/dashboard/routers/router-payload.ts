import type { PublicRouter, RouterInput, RouterUpdateInput } from '@/types';

/**
 * Estado del formulario de router y su traduccion al payload de la API.
 *
 * Los `<input>` entregan strings, asi que la conversion a `number` (y la
 * omision de los campos opcionales vacios) se aisla aqui y se prueba sin React.
 */

export interface RouterFormValues {
  readonly name: string;
  readonly host: string;
  readonly port: string;
  readonly protocol: 'api' | 'api-ssl';
  readonly username: string;
  readonly password: string;
  readonly description: string;
  readonly timezone: string;
  readonly currency: string;
  readonly timeoutMs: string;
  readonly tlsInsecure: boolean;
  readonly isActive: boolean;
}

export type PayloadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export const EMPTY_ROUTER_FORM: RouterFormValues = {
  name: '',
  host: '',
  port: '8728',
  protocol: 'api',
  username: 'admin',
  password: '',
  description: '',
  timezone: 'UTC',
  currency: 'USD',
  timeoutMs: '',
  tlsInsecure: false,
  isActive: true,
};

/** Precarga del formulario en modo edicion (nunca incluye la contrasena). */
export function toFormValues(router: PublicRouter): RouterFormValues {
  return {
    name: router.name,
    host: router.host,
    port: String(router.port),
    protocol: router.protocol === 'api-ssl' ? 'api-ssl' : 'api',
    username: router.username,
    password: '',
    description: router.description ?? '',
    timezone: router.timezone,
    currency: router.currency,
    timeoutMs: String(router.timeoutMs),
    tlsInsecure: router.tlsInsecure,
    isActive: router.isActive,
  };
}

/** Entero positivo del input; `null` si esta vacio o no es un numero valido. */
function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = Number(trimmed);

  return Number.isInteger(parsed) ? parsed : null;
}

/** Campos comunes a alta y edicion (sin la contrasena ni el timeout). */
interface CommonFields {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly protocol: 'api' | 'api-ssl';
  readonly username: string;
  readonly description: string | null;
  readonly timezone: string;
  readonly currency: string;
  readonly tlsInsecure: boolean;
  readonly isActive: boolean;
}

function commonFields(values: RouterFormValues): PayloadResult<CommonFields> {
  const port = parseInteger(values.port);
  if (port === null) return { ok: false, message: 'El puerto debe ser un numero entero.' };

  return {
    ok: true,
    value: {
      name: values.name.trim(),
      host: values.host.trim(),
      port,
      protocol: values.protocol,
      username: values.username.trim(),
      description: values.description.trim() === '' ? null : values.description.trim(),
      timezone: values.timezone.trim(),
      currency: values.currency.trim().toUpperCase(),
      tlsInsecure: values.tlsInsecure,
      isActive: values.isActive,
    },
  };
}

/** `timeoutMs` solo viaja si el campo tiene un entero valido. */
function optionalTimeout(values: RouterFormValues): { readonly timeoutMs?: number } {
  const parsed = parseInteger(values.timeoutMs);

  return parsed === null ? {} : { timeoutMs: parsed };
}

/** Payload de alta: la contrasena es obligatoria. */
export function toCreatePayload(values: RouterFormValues): PayloadResult<RouterInput> {
  const common = commonFields(values);
  if (!common.ok) return common;

  if (values.password === '') {
    return { ok: false, message: 'La contrasena del router es obligatoria.' };
  }

  return {
    ok: true,
    value: { ...common.value, ...optionalTimeout(values), password: values.password },
  };
}

/** Payload de edicion: la contrasena solo viaja si el usuario escribio una nueva. */
export function toUpdatePayload(values: RouterFormValues): PayloadResult<RouterUpdateInput> {
  const common = commonFields(values);
  if (!common.ok) return common;

  return {
    ok: true,
    value: {
      ...common.value,
      ...optionalTimeout(values),
      ...(values.password === '' ? {} : { password: values.password }),
    },
  };
}
