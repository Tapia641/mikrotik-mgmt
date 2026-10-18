'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

import type { RouterFormValues } from './router-payload';

/**
 * Formulario de alta/edicion de router.
 *
 * Presentacional: no habla con la API. El contenedor (`RoutersClient`) es quien
 * envia el payload y devuelve los errores de campo.
 *
 * Accesibilidad: `<label>` por campo, errores con `role="alert"` y enlaces
 * `aria-describedby`/`aria-invalid`.
 */

export interface RouterFormProps {
  readonly mode: 'create' | 'edit';
  readonly values: RouterFormValues;
  readonly pending: boolean;
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly message: string | null;
  readonly onChange: (patch: Partial<RouterFormValues>) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 disabled:opacity-60';

const LABEL_CLASS = 'block text-sm font-medium text-slate-700';

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'password' | 'number';
  readonly placeholder?: string;
  readonly hint?: string;
}

function Field({
  id,
  label,
  value,
  error,
  disabled,
  onChange,
  type = 'text',
  placeholder,
  hint,
}: FieldProps) {
  const describedBy = [error === undefined ? null : `${id}-error`, hint === undefined ? null : `${id}-hint`]
    .filter((item): item is string => item !== null)
    .join(' ');

  return (
    <div className="space-y-1">
      <label className={LABEL_CLASS} htmlFor={id}>
        {label}
      </label>
      <input
        aria-describedby={describedBy === '' ? undefined : describedBy}
        aria-invalid={error !== undefined}
        className={INPUT_CLASS}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {hint !== undefined && (
        <p className="text-xs text-slate-500" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p className="text-xs text-danger" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function RouterForm({
  mode,
  values,
  pending,
  fieldErrors,
  message,
  onChange,
  onSubmit,
  onCancel,
}: RouterFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const first = (field: string): string | undefined => fieldErrors[field]?.[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-border-subtle bg-surface-elevated p-5"
      noValidate
      onSubmit={handleSubmit}
    >
      <h2 className="text-base font-semibold text-slate-900">
        {mode === 'create' ? 'Nuevo router' : 'Editar router'}
      </h2>

      {message !== null && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {message}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          disabled={pending}
          error={first('name')}
          id="router-name"
          label="Nombre"
          onChange={(value) => onChange({ name: value })}
          placeholder="Oficina central"
          value={values.name}
        />
        <Field
          disabled={pending}
          error={first('host')}
          hint="IP o nombre DNS del equipo"
          id="router-host"
          label="Host"
          onChange={(value) => onChange({ host: value })}
          placeholder="192.168.88.1"
          value={values.host}
        />
        <Field
          disabled={pending}
          error={first('port')}
          hint="8728 (api) o 8729 (api-ssl)"
          id="router-port"
          label="Puerto"
          onChange={(value) => onChange({ port: value })}
          type="number"
          value={values.port}
        />
        <div className="space-y-1">
          <label className={LABEL_CLASS} htmlFor="router-protocol">
            Protocolo
          </label>
          <select
            aria-describedby={first('protocol') === undefined ? undefined : 'router-protocol-error'}
            aria-invalid={first('protocol') !== undefined}
            className={INPUT_CLASS}
            disabled={pending}
            id="router-protocol"
            onChange={(event) => onChange({ protocol: event.target.value === 'api-ssl' ? 'api-ssl' : 'api' })}
            value={values.protocol}
          >
            <option value="api">api</option>
            <option value="api-ssl">api-ssl</option>
          </select>
          {first('protocol') !== undefined && (
            <p className="text-xs text-danger" id="router-protocol-error">
              {first('protocol')}
            </p>
          )}
        </div>
        <Field
          disabled={pending}
          error={first('username')}
          id="router-username"
          label="Usuario"
          onChange={(value) => onChange({ username: value })}
          value={values.username}
        />
        <Field
          disabled={pending}
          error={first('password')}
          hint={mode === 'edit' ? 'Dejala vacia para conservar la actual' : undefined}
          id="router-password"
          label="Contrasena"
          onChange={(value) => onChange({ password: value })}
          type={showPassword ? 'text' : 'password'}
          value={values.password}
        />
        <Field
          disabled={pending}
          error={first('timeoutMs')}
          hint="Vacio = valor del panel"
          id="router-timeout"
          label="Timeout (ms)"
          onChange={(value) => onChange({ timeoutMs: value })}
          type="number"
          value={values.timeoutMs}
        />
        <Field
          disabled={pending}
          error={first('currency')}
          hint="ISO-4217 (PEN, USD...)"
          id="router-currency"
          label="Moneda"
          onChange={(value) => onChange({ currency: value })}
          value={values.currency}
        />
        <Field
          disabled={pending}
          error={first('timezone')}
          id="router-timezone"
          label="Zona horaria"
          onChange={(value) => onChange({ timezone: value })}
          value={values.timezone}
        />
        <Field
          disabled={pending}
          error={first('description')}
          id="router-description"
          label="Descripcion"
          onChange={(value) => onChange({ description: value })}
          value={values.description}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={showPassword}
            className="h-4 w-4 rounded border-border-subtle"
            disabled={pending}
            onChange={(event) => setShowPassword(event.target.checked)}
            type="checkbox"
          />
          Mostrar contrasena
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={values.tlsInsecure}
            className="h-4 w-4 rounded border-border-subtle"
            disabled={pending}
            onChange={(event) => onChange({ tlsInsecure: event.target.checked })}
            type="checkbox"
          />
          Aceptar certificado TLS no verificado
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            checked={values.isActive}
            className="h-4 w-4 rounded border-border-subtle"
            disabled={pending}
            onChange={(event) => onChange({ isActive: event.target.checked })}
            type="checkbox"
          />
          Activo
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? 'Guardando...' : mode === 'create' ? 'Crear router' : 'Guardar cambios'}
        </button>
        <button
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:opacity-60"
          disabled={pending}
          onClick={onCancel}
          type="button"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
