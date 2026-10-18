'use client';

import { useCallback, useEffect, useState } from 'react';

import type { HotspotUser, Paginated, PublicRouter } from '@/types';

import { apiRequest, fieldErrorsOf, messageOf } from '@/app/_lib/api-client';
import { formatBytes, formatDateTime } from '@/app/_lib/format';

interface Flash {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const SECONDARY_BUTTON =
  'rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const DANGER_BUTTON =
  'rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/5 focus:ring-2 focus:ring-danger/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface HotspotUsersClientProps {
  readonly routers: readonly PublicRouter[];
  readonly initialRouterId: string;
}

export function HotspotUsersClient({ routers, initialRouterId }: HotspotUsersClientProps) {
  const [selectedId, setSelectedId] = useState(initialRouterId);
  const [page, setPage] = useState<Paginated<HotspotUser> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);

  // Alta
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [profile, setProfile] = useState('');
  const [comment, setComment] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (selectedId === '') return;
    await Promise.resolve();
    setLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({ routerId: selectedId, pageSize: '200', sortBy: 'username' });
      if (search.trim() !== '') params.set('search', search.trim());
      if (status !== '') params.set('status', status);

      const result = await apiRequest<Paginated<HotspotUser>>(`/api/hotspot/users?${params.toString()}`);
      setPage(result);
    } catch (cause) {
      setLoadError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedId, search, status]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormMessage(null);
    setFieldErrors({});

    try {
      await apiRequest('/api/hotspot/users', {
        method: 'POST',
        body: JSON.stringify({
          routerId: selectedId,
          username: username.trim(),
          password: password === '' ? null : password,
          profile: profile.trim(),
          comment: comment.trim() === '' ? null : comment.trim(),
          disabled,
        }),
      });

      setCreating(false);
      setUsername('');
      setPassword('');
      setProfile('');
      setComment('');
      setDisabled(false);
      setFlash({ tone: 'ok', text: 'Usuario creado.' });
      await load();
    } catch (cause) {
      setFieldErrors(fieldErrorsOf(cause));
      setFormMessage(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: HotspotUser) {
    if (!window.confirm(`Eliminar el usuario "${user.username}" del router?`)) return;

    setBusyId(user.id);
    setFlash(null);

    try {
      await apiRequest(`/api/hotspot/users/${encodeURIComponent(user.id)}?routerId=${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
      });
      setFlash({ tone: 'ok', text: `Usuario "${user.username}" eliminado.` });
      await load();
    } catch (cause) {
      setFlash({ tone: 'error', text: `${user.username}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Usuarios Hotspot</h1>
          <p className="mt-1 text-sm text-slate-500">
            Credenciales del router: perfil, tiempo y consumo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
            onChange={(event) => setSelectedId(event.target.value)}
            value={selectedId}
          >
            {routers.length === 0 && <option value="">Sin routers</option>}
            {routers.map((router) => (
              <option key={router.id} value={router.id}>
                {router.name}
              </option>
            ))}
          </select>
          <button
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:opacity-50"
            disabled={selectedId === ''}
            onClick={() => setCreating(true)}
            type="button"
          >
            Nuevo usuario
          </button>
        </div>
      </header>

      {flash !== null && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            flash.tone === 'ok'
              ? 'border-success/30 bg-success/5 text-success'
              : 'border-danger/30 bg-danger/5 text-danger'
          }`}
        >
          {flash.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar usuario o comentario"
          type="search"
          value={search}
        />
        <select
          className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">Todos los estados</option>
          <option value="active">Activo</option>
          <option value="used">Usado</option>
          <option value="unused">Sin usar</option>
          <option value="expired">Expirado</option>
          <option value="disabled">Deshabilitado</option>
        </select>
        <button className={SECONDARY_BUTTON} onClick={() => void load()} type="button">
          Actualizar
        </button>
      </div>

      {loadError !== null && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{loadError}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-white">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Consumo</th>
              <th className="px-4 py-3 text-right">Uptime</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && page === null && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && page !== null && page.items.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Sin usuarios.
                </td>
              </tr>
            )}
            {page?.items.map((user) => (
              <tr className="border-t border-border-subtle" key={user.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{user.username}</div>
                  {user.comment !== null && <div className="text-xs text-slate-500">{user.comment}</div>}
                </td>
                <td className="px-4 py-3 text-slate-700">{user.profile}</td>
                <td className="px-4 py-3 text-xs text-slate-700">{user.status}</td>
                <td className="px-4 py-3 text-right text-xs text-slate-700">
                  {formatBytes(user.bytesIn)} / {formatBytes(user.bytesOut)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">{user.uptime}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    className={DANGER_BUTTON}
                    disabled={busyId === user.id}
                    onClick={() => void handleDelete(user)}
                    type="button"
                  >
                    {busyId === user.id ? '...' : 'Eliminar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onSubmit={handleCreate}>
            <h2 className="text-lg font-semibold text-slate-900">Nuevo usuario</h2>

            {formMessage !== null && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formMessage}</div>
            )}

            <label className="block text-sm font-medium text-slate-700">
              Usuario
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
              {fieldErrors.username !== undefined && (
                <span className="mt-1 block text-xs text-danger">{fieldErrors.username.join(' ')}</span>
              )}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Contrasena
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                value={password}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Perfil
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setProfile(event.target.value)}
                placeholder="1h"
                required
                value={profile}
              />
              {fieldErrors.profile !== undefined && (
                <span className="mt-1 block text-xs text-danger">{fieldErrors.profile.join(' ')}</span>
              )}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Comentario
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setComment(event.target.value)}
                value={comment}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                checked={disabled}
                onChange={(event) => setDisabled(event.target.checked)}
                type="checkbox"
              />
              Deshabilitado
            </label>

            <div className="flex justify-end gap-2">
              <button
                className={SECONDARY_BUTTON}
                onClick={() => setCreating(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:opacity-50"
                disabled={saving}
                type="submit"
              >
                {saving ? 'Creando...' : 'Crear'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
