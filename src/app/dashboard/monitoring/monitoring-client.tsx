'use client';

import { useCallback, useEffect, useState } from 'react';

import type { InterfaceStat, Paginated, PublicRouter, RouterSnapshot } from '@/types';

import { RouterStatusBadge } from '@/app/_components/router-status-badge';
import { apiRequest, messageOf } from '@/app/_lib/api-client';
import { formatBitsPerSecond, formatBytes, formatDateTime, percentage } from '@/app/_lib/format';

/**
 * Monitoreo en vivo de un router.
 *
 * El bucle es un `setTimeout` recursivo (no `setInterval`): asi nunca se solapan
 * dos consultas si el equipo tarda mas que el intervalo. Cada vuelta pide la
 * fotografia y las tasas por interfaz en paralelo, y el servicio ya devuelve las
 * tasas calculadas, de modo que el cliente solo pinta.
 */

const POLL_INTERVAL_MS = 4_000;

interface Snapshot {
  readonly metrics: RouterSnapshot;
  readonly interfaces: readonly InterfaceStat[];
}

function barClass(used: number): string {
  if (used >= 90) return 'bg-danger';
  if (used >= 75) return 'bg-warning';

  return 'bg-brand-600';
}

function Metric({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-muted px-3 py-2">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-slate-900">{value}</dd>
      {hint !== undefined && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function UsageBar({
  label,
  used,
  total,
  usedLabel,
}: {
  readonly label: string;
  readonly used: number;
  readonly total: number;
  readonly usedLabel: string;
}) {
  const percent = percentage(used, total);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {usedLabel} · {percent}%
        </span>
      </div>
      <div
        aria-label={`${label}: ${percent}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
      >
        <div className={`h-full rounded-full ${barClass(percent)}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function HealthCard({ health }: { readonly health: RouterSnapshot['health'] }) {
  if (health === null) {
    return (
      <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
        <h2 className="text-sm font-semibold text-slate-900">Salud</h2>
        <p className="mt-2 text-sm text-slate-500">
          Este equipo no expone sensores (`/system/health` no esta disponible en el board).
        </p>
      </div>
    );
  }

  const sensors: Array<readonly [string, string]> = [];
  if (health.temperature !== undefined) sensors.push(['Temperatura', `${health.temperature} C`]);
  if (health.cpuTemperature !== undefined) sensors.push(['CPU', `${health.cpuTemperature} C`]);
  if (health.boardTemperature !== undefined) sensors.push(['Board', `${health.boardTemperature} C`]);
  if (health.voltage !== undefined) sensors.push(['Voltaje', `${health.voltage} V`]);
  if (health.fanSpeed !== undefined) sensors.push(['Ventilador', `${health.fanSpeed} rpm`]);
  if (health.powerConsumption !== undefined)
    sensors.push(['Consumo', `${health.powerConsumption} W`]);

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
      <h2 className="text-sm font-semibold text-slate-900">Salud</h2>
      {sensors.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">El equipo no reporto ningun sensor.</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3">
          {sensors.map(([label, value]) => (
            <Metric key={label} label={label} value={value} />
          ))}
        </dl>
      )}
    </div>
  );
}

function InterfacesTable({ interfaces }: { readonly interfaces: readonly InterfaceStat[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Trafico por interfaz</caption>
        <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-slate-600 uppercase">
          <tr>
            <th className="px-4 py-3" scope="col">
              Interfaz
            </th>
            <th className="px-4 py-3" scope="col">
              Estado
            </th>
            <th className="px-4 py-3 text-right" scope="col">
              RX
            </th>
            <th className="px-4 py-3 text-right" scope="col">
              TX
            </th>
            <th className="px-4 py-3" scope="col">
              Detalle
            </th>
          </tr>
        </thead>
        <tbody>
          {interfaces.length === 0 && (
            <tr>
              <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                El equipo no reporto interfaces.
              </td>
            </tr>
          )}

          {interfaces.map((item) => (
            <tr className="border-t border-border-subtle" key={item.name}>
              <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
              <td className="px-4 py-3 text-xs">
                {item.disabled ? (
                  <span className="text-slate-500">deshabilitada</span>
                ) : item.running ? (
                  <span className="text-success">activa</span>
                ) : (
                  <span className="text-danger">caida</span>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                {formatBitsPerSecond(item.rxRateBps)}
                <div className="text-slate-500">{formatBytes(item.rxByte)}</div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                {formatBitsPerSecond(item.txRateBps)}
                <div className="text-slate-500">{formatBytes(item.txByte)}</div>
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {item.type}
                {item.mtu !== undefined && ` · MTU ${item.mtu}`}
                {item.macAddress !== undefined && ` · ${item.macAddress}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface MonitoringClientProps {
  /** Routers ya resueltos por el servidor. */
  readonly routers: readonly PublicRouter[];
  /** Router preseleccionado (`?router=<id>` o el primero). Vacio si no hay. */
  readonly initialRouterId: string;
  /** Fallo al resolver el listado en el servidor, si lo hubo. */
  readonly initialError: string | null;
}

export function MonitoringClient({ routers, initialRouterId, initialError }: MonitoringClientProps) {
  const [selectedId, setSelectedId] = useState(initialRouterId);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [polling, setPolling] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  /**
   * Contador que reinicia el efecto de lectura. Es la via de "Actualizar ahora":
   * al no depender de un temporizador propio hereda gratis la guarda de
   * cancelacion (una lectura vieja nunca pisa a la nueva) y funciona tanto en
   * vivo como en pausa.
   */
  const [refreshToken, setRefreshToken] = useState(0);

  /**
   * Lectura pura: no toca el estado. Quien la aplica es el efecto, que si sabe
   * si su lectura sigue siendo la vigente; asi una respuesta que llega tarde
   * —cambio de router, desmontaje— se descarta en vez de pintar datos de otro
   * equipo encima de los del equipo actual.
   */
  const fetchSnapshot = useCallback(async (routerId: string): Promise<Snapshot> => {
    const [metrics, interfaces] = await Promise.all([
      apiRequest<RouterSnapshot>(`/api/routers/${routerId}/snapshot`),
      apiRequest<readonly InterfaceStat[]>(`/api/routers/${routerId}/interfaces`),
    ]);

    return { metrics, interfaces };
  }, []);

  useEffect(() => {
    if (selectedId === '') return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function run(): Promise<void> {
      try {
        const next = await fetchSnapshot(selectedId);

        if (cancelled) return;

        setData(next);
        setUpdatedAt(new Date().toISOString());
        setError(null);

        if (!polling) return;
        timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
      } catch (cause) {
        if (cancelled) return;

        const message = messageOf(cause);
        setError(message);

        if (!polling) return;
        // Un fallo de sesion o de permisos no se arregla reintentando.
        if (message.includes('sesion') || message.includes('permite')) return;

        timer = setTimeout(() => void run(), POLL_INTERVAL_MS);
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [selectedId, polling, refreshToken, fetchSnapshot]);

  /**
   * Cambio de router: la lectura anterior se descarta en el propio manejador
   * (no en un efecto) para no mezclar equipos ni provocar renders en cascada.
   */
  function selectRouter(routerId: string): void {
    setSelectedId(routerId);
    setData(null);
    setUpdatedAt(null);
    setError(null);
  }

  const selected = routers.find((router) => router.id === selectedId) ?? null;
  const resource = data?.metrics.resource;
  const identity = data?.metrics.identity;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Monitoreo</h1>
          <p className="mt-1 text-sm text-slate-500">
            Recursos, salud y trafico por interfaz; se refresca cada {POLL_INTERVAL_MS / 1000} s.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="monitor-router">
              Router
            </label>
            <select
              className="min-w-56 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              disabled={routers.length === 0}
              id="monitor-router"
              onChange={(event) => selectRouter(event.target.value)}
              value={selectedId}
            >
              {routers.length === 0 && <option value="">Sin routers</option>}
              {routers.map((router) => (
                <option key={router.id} value={router.id}>
                  {router.name}
                </option>
              ))}
            </select>
          </div>

          <button
            className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:opacity-50"
            disabled={selectedId === ''}
            onClick={() => setPolling((current) => !current)}
            type="button"
          >
            {polling ? 'Pausar' : 'Reanudar'}
          </button>
          <button
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none disabled:opacity-50"
            disabled={selectedId === ''}
            onClick={() => setRefreshToken((current) => current + 1)}
            type="button"
          >
            Actualizar ahora
          </button>
        </div>
      </div>

      {error !== null && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}

      {selected === null && (
        <p className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-6 text-center text-sm text-slate-500">
          Registra un router para empezar a monitorear.
        </p>
      )}

      {selected !== null && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span className="font-medium text-slate-900">{selected.name}</span>
          <RouterStatusBadge status={selected.status} />
          <span className="font-mono text-xs">
            {selected.protocol}://{selected.host}:{selected.port}
          </span>
          <span className="text-xs">
            {polling ? 'En vivo' : 'En pausa'} · ultima lectura: {formatDateTime(updatedAt)}
          </span>
        </div>
      )}

      {data === null && selected !== null && error === null && (
        <p className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-6 text-center text-sm text-slate-500">
          Esperando la primera lectura del equipo...
        </p>
      )}

      {data !== null && resource !== undefined && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
              <h2 className="text-sm font-semibold text-slate-900">Equipo</h2>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                <Metric label="Identidad" value={identity?.name ?? '—'} hint={identity?.boardName} />
                <Metric label="RouterOS" value={resource.version} hint={resource.architectureName} />
                <Metric label="Uptime" value={resource.uptime} />
                <Metric
                  label="Sesiones hotspot"
                  value={String(data.metrics.activeHotspotSessions)}
                  hint="usuarios conectados"
                />
              </dl>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
              <h2 className="text-sm font-semibold text-slate-900">CPU</h2>
              <dl className="mt-3 space-y-3">
                <UsageBar
                  label="Carga"
                  total={100}
                  used={resource.cpuLoad}
                  usedLabel={`${resource.cpuLoad}%`}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Metric label="Modelo" value={resource.cpu} />
                  <Metric
                    label="Nucleos"
                    value={resource.cpuCount}
                    hint={resource.cpuFrequency === '' ? undefined : `${resource.cpuFrequency} MHz`}
                  />
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface-elevated p-4">
              <h2 className="text-sm font-semibold text-slate-900">Memoria y disco</h2>
              <div className="mt-3 space-y-4">
                <UsageBar
                  label="Memoria RAM"
                  total={resource.totalMemory}
                  used={resource.totalMemory - resource.freeMemory}
                  usedLabel={`${formatBytes(resource.freeMemory)} libres`}
                />
                <UsageBar
                  label="Almacenamiento"
                  total={resource.totalHddSpace}
                  used={resource.totalHddSpace - resource.freeHddSpace}
                  usedLabel={`${formatBytes(resource.freeHddSpace)} libres`}
                />
              </div>
            </div>

            <HealthCard health={data.metrics.health} />
          </div>

          <InterfacesTable interfaces={data.interfaces} />
        </>
      )}
    </div>
  );
}
