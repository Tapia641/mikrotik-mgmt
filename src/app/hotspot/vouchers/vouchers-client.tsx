'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Paginated, PublicRouter, Voucher, VoucherBatchResult } from '@/types';

import { apiRequest, fieldErrorsOf, messageOf } from '@/app/_lib/api-client';

interface Flash {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const SECONDARY_BUTTON =
  'rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const DANGER_BUTTON =
  'rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/5 focus:ring-2 focus:ring-danger/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface HotspotVouchersClientProps {
  readonly routers: readonly PublicRouter[];
  readonly initialRouterId: string;
}

export function HotspotVouchersClient({ routers, initialRouterId }: HotspotVouchersClientProps) {
  const [selectedId, setSelectedId] = useState(initialRouterId);
  const [page, setPage] = useState<Paginated<Voucher> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [status, setStatus] = useState('');

  const [creating, setCreating] = useState(false);
  const [quantity, setQuantity] = useState('10');
  const [profile, setProfile] = useState('');
  const [codeLength, setCodeLength] = useState('6');
  const [charset, setCharset] = useState('alphanumeric');
  const [mode, setMode] = useState<'username-password' | 'username-only' | 'password-only'>('username-password');
  const [price, setPrice] = useState('0');
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
      const params = new URLSearchParams({ routerId: selectedId, pageSize: '50' });
      if (status !== '') params.set('status', status);

      const result = await apiRequest<Paginated<Voucher>>(`/api/hotspot/vouchers?${params.toString()}`);
      setPage(result);
    } catch (cause) {
      setLoadError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, [selectedId, status]);

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
      const result = await apiRequest<VoucherBatchResult>('/api/hotspot/vouchers', {
        method: 'POST',
        body: JSON.stringify({
          routerId: selectedId,
          profileName: profile.trim(),
          mode,
          quantity: Number(quantity),
          codeLength: Number(codeLength),
          charset,
          price: Number(price),
        }),
      });

      setCreating(false);
      setFlash({
        tone: 'ok',
        text: `${result.totalCreated} vouchers creados${result.failed.length > 0 ? ` (${result.failed.length} fallaron)` : ''}.`,
      });
      await load();
    } catch (cause) {
      setFieldErrors(fieldErrorsOf(cause));
      setFormMessage(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleSell(voucher: Voucher) {
    setBusyId(voucher.id);
    setFlash(null);

    try {
      await apiRequest(`/api/hotspot/vouchers/${encodeURIComponent(voucher.id)}/sell`, {
        method: 'POST',
        body: JSON.stringify({ resellerId: null }),
      });
      setFlash({ tone: 'ok', text: `Voucher "${voucher.code}" vendido.` });
      await load();
    } catch (cause) {
      setFlash({ tone: 'error', text: `${voucher.code}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
    }
  }

  async function handleRevoke(voucher: Voucher) {
    if (!window.confirm(`Revocar el voucher "${voucher.code}"?`)) return;

    setBusyId(voucher.id);
    setFlash(null);

    try {
      await apiRequest(`/api/hotspot/vouchers/${encodeURIComponent(voucher.id)}/revoke`, {
        method: 'POST',
      });
      setFlash({ tone: 'ok', text: `Voucher "${voucher.code}" revocado.` });
      await load();
    } catch (cause) {
      setFlash({ tone: 'error', text: `${voucher.code}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Vouchers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Generacion masiva e inventario de codigos.
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
            Generar lote
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
        <select
          className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
          onChange={(event) => setStatus(event.target.value)}
          value={status}
        >
          <option value="">Todos los estados</option>
          <option value="available">Disponibles</option>
          <option value="sold">Vendidos</option>
          <option value="active">Activos</option>
          <option value="used">Usados</option>
          <option value="expired">Expirados</option>
          <option value="revoked">Revocados</option>
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
              <th className="px-4 py-3">Codigo</th>
              <th className="px-4 py-3">Contrasena</th>
              <th className="px-4 py-3">Perfil</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3 text-right">Precio</th>
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
                  Sin vouchers.
                </td>
              </tr>
            )}
            {page?.items.map((voucher) => (
              <tr className="border-t border-border-subtle" key={voucher.id}>
                <td className="px-4 py-3 font-mono text-xs text-slate-900">{voucher.code}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{voucher.password ?? '—'}</td>
                <td className="px-4 py-3 text-slate-700">{voucher.profileName}</td>
                <td className="px-4 py-3 text-xs text-slate-700">{voucher.status}</td>
                <td className="px-4 py-3 text-right text-slate-700">{voucher.price}</td>
                <td className="px-4 py-3 text-right">
                  {voucher.status === 'available' && (
                    <div className="flex justify-end gap-2">
                      <button
                        className={SECONDARY_BUTTON}
                        disabled={busyId === voucher.id}
                        onClick={() => void handleSell(voucher)}
                        type="button"
                      >
                        {busyId === voucher.id ? '...' : 'Vender'}
                      </button>
                      <button
                        className={DANGER_BUTTON}
                        disabled={busyId === voucher.id}
                        onClick={() => void handleRevoke(voucher)}
                        type="button"
                      >
                        {busyId === voucher.id ? '...' : 'Revocar'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <form className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl" onSubmit={handleCreate}>
            <h2 className="text-lg font-semibold text-slate-900">Generar lote</h2>

            {formMessage !== null && (
              <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{formMessage}</div>
            )}

            <label className="block text-sm font-medium text-slate-700">
              Perfil hotspot
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setProfile(event.target.value)}
                placeholder="1h"
                required
                value={profile}
              />
              {fieldErrors.profileName !== undefined && (
                <span className="mt-1 block text-xs text-danger">{fieldErrors.profileName.join(' ')}</span>
              )}
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Cantidad
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setQuantity(event.target.value)}
                required
                type="number"
                value={quantity}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Longitud del codigo
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setCodeLength(event.target.value)}
                required
                type="number"
                value={codeLength}
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Modo
              <select
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setMode(event.target.value as typeof mode)}
                value={mode}
              >
                <option value="username-password">Usuario y contrasena</option>
                <option value="username-only">Solo usuario</option>
                <option value="password-only">Solo contrasena</option>
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Charset
              <select
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setCharset(event.target.value)}
                value={charset}
              >
                <option value="alphanumeric">Alfanumerico</option>
                <option value="numeric">Numerico</option>
                <option value="lower">Minusculas</option>
                <option value="upper">Mayusculas</option>
                <option value="mixed">Mixto</option>
              </select>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Precio
              <input
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
                onChange={(event) => setPrice(event.target.value)}
                type="number"
                value={price}
              />
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
                {saving ? 'Generando...' : 'Generar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}