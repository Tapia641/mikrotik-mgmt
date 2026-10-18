'use client';

import { useCallback, useEffect, useState } from 'react';

import type { HotspotActiveSession, PublicRouter } from '@/types';

import { apiRequest, messageOf } from '@/app/_lib/api-client';
import { formatBytes } from '@/app/_lib/format';

interface Flash {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const DANGER_BUTTON =
  'rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/5 focus:ring-2 focus:ring-danger/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const SECONDARY_BUTTON =
  'rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface HotspotActiveClientProps {
  readonly routers: readonly PublicRouter[];
  readonly initialRouterId: string;
}

export function HotspotActiveClient({ routers, initialRouterId }: HotspotActiveClientProps) {
  const [selectedId, setSelectedId] = useState(initialRouterId);
  const [sessions, setSessions] = useState<readonly HotspotActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (selectedId === '') return;
    await Promise.resolve();
    setLoading(true);
    setLoadError(null);

    try {
      const params = new URLSearchParams({ routerId: selectedId });
      const result = await apiRequest<readonly HotspotActiveSession[]>(`/api/hotspot/active?${params.toString()}`);
      setSessions(result);
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

  async function handleDisconnect(session: HotspotActiveSession) {
    if (!window.confirm(`Desconectar a "${session.user}"?`)) return;

    setBusyId(session.id);
    setFlash(null);

    try {
      await apiRequest(`/api/hotspot/active/${encodeURIComponent(session.id)}?routerId=${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
      });
      setFlash({ tone: 'ok', text: `Sesion de "${session.user}" cerrada.` });
      await load();
    } catch (cause) {
      setFlash({ tone: 'error', text: `${session.user}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Sesiones Hotspot activas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Clientes conectados ahora mismo. Desconectar fuerza el cierre.
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
          <button className={SECONDARY_BUTTON} onClick={() => void load()} type="button">
            Actualizar
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
              <th className="px-4 py-3">Usuario</th>
              <th className="px-4 py-3">Direccion</th>
              <th className="px-4 py-3">MAC</th>
              <th className="px-4 py-3">Uptime</th>
              <th className="px-4 py-3 text-right">Consumo</th>
              <th className="px-4 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading && sessions.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && sessions.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={6}>
                  Sin sesiones activas.
                </td>
              </tr>
            )}
            {sessions.map((session) => (
              <tr className="border-t border-border-subtle" key={session.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{session.user}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{session.address}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{session.macAddress}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-700">{session.uptime}</td>
                <td className="px-4 py-3 text-right text-xs text-slate-700">
                  {formatBytes(session.bytesIn)} / {formatBytes(session.bytesOut)}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className={DANGER_BUTTON}
                    disabled={busyId === session.id}
                    onClick={() => void handleDisconnect(session)}
                    type="button"
                  >
                    {busyId === session.id ? '...' : 'Desconectar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
