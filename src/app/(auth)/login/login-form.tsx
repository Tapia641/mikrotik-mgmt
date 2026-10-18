'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import type { ApiResponse, LoginPayload } from '@/types';

/**
 * Formulario de acceso. Habla con `POST /api/auth/login`, que es quien deposita
 * la cookie httpOnly: aqui nunca se ve el token.
 *
 * Accesibilidad: cada campo tiene su `<label>`, los errores se anuncian con
 * `role="alert"` y se enlazan al campo con `aria-describedby`.
 */

export interface LoginFormProps {
  /** Ruta a la que volver tras entrar (ya saneada por el servidor). */
  readonly next: string;
}

type FieldErrors = Readonly<Record<string, readonly string[] | undefined>>;

export function LoginForm({ next }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const usernameError = fieldErrors.username?.[0];
  const passwordError = fieldErrors.password?.[0];

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const payload = (await response.json()) as ApiResponse<LoginPayload>;

      if (!payload.ok) {
        setMessage(payload.error.message);
        setFieldErrors(payload.error.fieldErrors ?? {});
        setPending(false);
        return;
      }

      // El usuario ya existe: recarga desde el servidor con la cookie puesta.
      router.replace(next);
      router.refresh();
    } catch {
      setMessage('No se pudo contactar con el servidor. Revisa tu conexion.');
      setPending(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
      {message !== null && (
        <p
          className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {message}
        </p>
      )}

      <div className="space-y-1">
        <label className="block text-sm font-medium text-slate-700" htmlFor="username">
          Usuario
        </label>
        <input
          aria-describedby={usernameError === undefined ? undefined : 'username-error'}
          aria-invalid={usernameError !== undefined}
          autoComplete="username"
          autoFocus
          className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          disabled={pending}
          id="username"
          name="username"
          onChange={(event) => setUsername(event.target.value)}
          required
          type="text"
          value={username}
        />
        {usernameError !== undefined && (
          <p className="text-xs text-danger" id="username-error">
            {usernameError}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium text-slate-700" htmlFor="password">
          Contrasena
        </label>
        <input
          aria-describedby={passwordError === undefined ? undefined : 'password-error'}
          aria-invalid={passwordError !== undefined}
          autoComplete="current-password"
          className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          disabled={pending}
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {passwordError !== undefined && (
          <p className="text-xs text-danger" id="password-error">
            {passwordError}
          </p>
        )}
      </div>

      <button
        className="w-full rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
