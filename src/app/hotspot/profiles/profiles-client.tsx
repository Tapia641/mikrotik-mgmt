'use client';

import { useCallback, useEffect, useState } from 'react';

import type { HotspotProfile, PublicRouter } from '@/types';

import { apiRequest, fieldErrorsOf, messageOf } from '@/app/_lib/api-client';

interface Flash {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const SECONDARY_BUTTON =
  'rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const DANGER_BUTTON =
  'rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/5 focus:ring-2 focus:ring-danger/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface HotspotProfilesClientProps {
  readonly routers: readonly PublicRouter[];
  readonly initialRouterId: string;
}

export function HotspotProfilesClient({ routers, initialRouterId }: HotspotProfilesClientProps) {
  const [selectedId, setSelectedId] = useState(initialRouterId);
  const [profiles, setProfiles] = useState<readonly HotspotProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [rateLimit, setRateLimit] = useState('');
  const [sharedUsers, setSharedUsers] = useState('');
  const [sessionTimeout, setSessionTimeout] = useState('');
  const [idleTimeout, setIdleTimeout] = useState('');
  const [addressPool, setAddressPool] = useState('');
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
      const params = new URLSearchParams({ routerId: selectedId });
      const result = await apiRequest<readonly HotspotProfile[]>(`/api/hotspot/profiles?${params.toString()}`);
      setProfiles(result);
    } catch (cause) {
      setLoadError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

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
      await apiRequest('/api/hotspot/profiles', {
        method: 'POST',
        body: JSON.stringify({
          routerId: selectedId,
          name: name.trim(),
          rateLimit: rateLimit.trim() === '' ? null : rateLimit.trim(),
          sharedUsers: sharedUsers.trim() === '' ? undefined : Number(sharedUsers),
          sessionTimeout: sessionTimeout.trim() === '' ? null : sessionTimeout.trim(),
          idleTimeout: idleTimeout.trim() === '' ? null : idleTimeout.trim(),
          addressPool: addressPool.trim() === '' ? null : addressPool.trim(),
          disabled,
        }),
      });

      setCreating(false);
      setName('');
      setRateLimit('');
      setSharedUsers('');
      setSessionTimeout('');
      setIdleTimeout('');
      setAddressPool('');
      setDisabled(false);
      setFlash({ tone: 'ok', text: 'Perfil creado.' });
      await load();
    } catch (cause) {
      setFieldErrors(fieldErrorsOf(cause));
      setFormMessage(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(profile: HotspotProfile) {
    if (!window.confirm(`Eliminar el perfil "${profile.name}"?`)) return;

    setBusyId(profile.id);
    setFlash(null);

    try {
      await apiRequest(`/api/hotspot/profiles/${encodeURIComponent(profile.id)}?routerId=${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
      });
      setFlash({ tone: 'ok', text: `Perfil "${profile.name}" eliminado.` });
      await load();
    } catch (cause) {
      setFlash({ tone: 'error', text: `${profile.name}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Perfiles Hotspot</h1>
          <p className="mt-1 text-sm text-slate-500">
            Limites de velocidad, tiempo y usuarios compartidos.
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
            Nuevo perfil
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

      {loadError !== null && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{loadError}</div>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-white">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Nombre</th>
              <th className="px-4 py-3">Rate limit</th>
              <th className="px-4 py-3">Compartidos</th>
              <th className="px-4 py-3">Sesion</th>
              <th className="px-4 py-3">Idle</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && profiles.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && profiles.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Sin perfiles.
                </td>
              </tr>
            )}
            {profiles.map((profile) => (
              <tr className="border-t border-border-subtle" key={profile.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{profile.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{profile.rateLimit ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{profile.sharedUsers}</td>
                <td className="px-4 py-3 text-slate-700">{profile.sessionTimeout ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{profile.idleTimeout ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <button
                    className={DANGER_BUTTON}
                    disabled={busyId === profile.id}
                    onClick={() => void handleDelete(profile)}
                    type="button"
                  >
                    {busyId === profile.id ? '...' : 'Eliminar'}
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
            <h2 className="text-lg font-semibold text-slate-900">Nuevo perfil</h2>

            {formMessage !== null && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formMessage}</div>
            )}

            <label className="block text-sm font-medium text-slate-700">
              Nombre
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
              {fieldErrors.name !== undefined && (
                <span className="mt-1 block text-xs text-danger">{fieldErrors.name.join(' ')}</span>
              )}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Rate limit (subida/bajada)
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setRateLimit(event.target.value)}
                placeholder="2M/2M"
                value={rateLimit}
              />
              {fieldErrors.rateLimit !== undefined && (
                <span className="mt-1 block text-xs text-danger">{fieldErrors.rateLimit.join(' ')}</span>
              )}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Usuarios compartidos
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setSharedUsers(event.target.value)}
                placeholder="1"
                type="number"
                value={sharedUsers}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Timeout de sesion
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setSessionTimeout(event.target.value)}
                placeholder="1h"
                value={sessionTimeout}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Timeout inactivo
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setIdleTimeout(event.target.value)}
                placeholder="5m"
                value={idleTimeout}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Pool de direcciones
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setAddressPool(event.target.value)}
                value={addressPool}
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
