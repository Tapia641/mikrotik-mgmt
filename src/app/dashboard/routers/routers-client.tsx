'use client';

import { useCallback, useMemo, useState } from 'react';

import type { Paginated, PublicRouter } from '@/types';

import { RouterStatusBadge } from '@/app/_components/router-status-badge';
import { apiRequest, fieldErrorsOf, messageOf } from '@/app/_lib/api-client';
import { formatDateTime } from '@/app/_lib/format';

import { RouterForm } from './router-form';
import {
  EMPTY_ROUTER_FORM,
  toCreatePayload,
  toFormValues,
  toUpdatePayload,
  type RouterFormValues,
} from './router-payload';

/**
 * CRUD de routers con prueba de conexion.
 *
 * Toda la autorizacion vive en la API: aqui solo se pinta lo que devuelve y se
 * muestran los errores de dominio (422 con `fieldErrors`, 502/504 de RouterOS).
 */

type Mode =
  | { readonly kind: 'list' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly router: PublicRouter };

interface Flash {
  readonly tone: 'ok' | 'error';
  readonly text: string;
}

const SECONDARY_BUTTON =
  'rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-surface-muted focus:ring-2 focus:ring-brand-500/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

const DANGER_BUTTON =
  'rounded-lg border border-danger/30 px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/5 focus:ring-2 focus:ring-danger/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface RoutersClientProps {
  /** Listado ya resuelto por el servidor (evita el parpadeo inicial). */
  readonly initialRouters: readonly PublicRouter[];
  /** Fallo al resolver el listado en el servidor, si lo hubo. */
  readonly initialError: string | null;
}

export function RoutersClient({ initialRouters, initialError }: RoutersClientProps) {
  const [routers, setRouters] = useState<readonly PublicRouter[]>(initialRouters);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialError);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [values, setValues] = useState<RouterFormValues>(EMPTY_ROUTER_FORM);
  const [pending, setPending] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [flash, setFlash] = useState<Flash | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /** Refresco bajo demanda: solo lo invocan manejadores de eventos. */
  const load = useCallback(async (): Promise<void> => {
    try {
      const page = await apiRequest<Paginated<PublicRouter>>('/api/routers?pageSize=200');
      setRouters(page.items);
      setLoadError(null);
    } catch (cause) {
      setLoadError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  /** Recarga manual: el indicador lo muestra porque la inicia el usuario. */
  function refresh(): void {
    setLoading(true);
    setLoadError(null);
    void load();
  }

  const editing = mode.kind === 'edit';
  const showForm = mode.kind !== 'list';

  const sortedByName = useMemo(
    () => [...routers].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [routers],
  );

  function openCreate(): void {
    setValues(EMPTY_ROUTER_FORM);
    setFieldErrors({});
    setFormMessage(null);
    setFlash(null);
    setMode({ kind: 'create' });
  }

  function openEdit(router: PublicRouter): void {
    setValues(toFormValues(router));
    setFieldErrors({});
    setFormMessage(null);
    setFlash(null);
    setMode({ kind: 'edit', router });
  }

  function closeForm(): void {
    setMode({ kind: 'list' });
    setFieldErrors({});
    setFormMessage(null);
  }

  async function submit(): Promise<void> {
    const payload =
      mode.kind === 'create' ? toCreatePayload(values) : mode.kind === 'edit' ? toUpdatePayload(values) : null;

    if (payload === null) return;

    if (!payload.ok) {
      setFormMessage(payload.message);
      setFieldErrors({});
      return;
    }

    setPending(true);
    setFormMessage(null);
    setFieldErrors({});

    try {
      if (mode.kind === 'create') {
        await apiRequest<PublicRouter>('/api/routers', {
          method: 'POST',
          body: JSON.stringify(payload.value),
        });
        setFlash({ tone: 'ok', text: `Router "${values.name.trim()}" creado.` });
      } else if (mode.kind === 'edit') {
        await apiRequest<PublicRouter>(`/api/routers/${mode.router.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload.value),
        });
        setFlash({ tone: 'ok', text: `Router "${values.name.trim()}" actualizado.` });
      }

      setMode({ kind: 'list' });
      await load();
    } catch (cause) {
      setFormMessage(messageOf(cause));
      setFieldErrors(fieldErrorsOf(cause));
    } finally {
      setPending(false);
    }
  }

  async function testConnection(router: PublicRouter): Promise<void> {
    setBusyId(router.id);
    setFlash(null);

    try {
      const { latencyMs } = await apiRequest<{ readonly latencyMs: number }>(
        `/api/routers/${router.id}/test`,
        { method: 'POST' },
      );
      setFlash({ tone: 'ok', text: `${router.name}: conexion correcta (${latencyMs} ms).` });
    } catch (cause) {
      setFlash({ tone: 'error', text: `${router.name}: ${messageOf(cause)}` });
    } finally {
      setBusyId(null);
      await load();
    }
  }

  async function remove(router: PublicRouter): Promise<void> {
    if (!window.confirm(`Eliminar el router "${router.name}"? Se ocultara del panel.`)) return;

    setBusyId(router.id);
    setFlash(null);

    try {
      await apiRequest<{ readonly id: string }>(`/api/routers/${router.id}`, { method: 'DELETE' });
      setFlash({ tone: 'ok', text: `Router "${router.name}" eliminado.` });
      setMode({ kind: 'list' });
    } catch (cause) {
      setFlash({ tone: 'error', text: messageOf(cause) });
    } finally {
      setBusyId(null);
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Routers</h1>
          <p className="mt-1 text-sm text-slate-500">
            Dispositivos gestionados, estado de conexion y prueba de acceso.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className={SECONDARY_BUTTON} onClick={refresh} type="button">
            {loading ? 'Cargando...' : 'Recargar'}
          </button>
          <button
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 focus:ring-2 focus:ring-brand-500/40 focus:outline-none"
            onClick={openCreate}
            type="button"
          >
            Nuevo router
          </button>
        </div>
      </div>

      {flash !== null && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            flash.tone === 'ok'
              ? 'border border-success/30 bg-success/5 text-success'
              : 'border border-danger/30 bg-danger/5 text-danger'
          }`}
          role="status"
        >
          {flash.text}
        </p>
      )}

      {showForm && (
        <RouterForm
          fieldErrors={fieldErrors}
          message={formMessage}
          mode={editing ? 'edit' : 'create'}
          onCancel={closeForm}
          onChange={(patch) => setValues((current) => ({ ...current, ...patch }))}
          onSubmit={() => void submit()}
          pending={pending}
          values={values}
        />
      )}

      {loadError !== null && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger" role="alert">
          {loadError}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Routers registrados</caption>
          <thead className="bg-surface-muted text-left text-xs font-semibold tracking-wide text-slate-600 uppercase">
            <tr>
              <th className="px-4 py-3" scope="col">
                Nombre
              </th>
              <th className="px-4 py-3" scope="col">
                Conexion
              </th>
              <th className="px-4 py-3" scope="col">
                Estado
              </th>
              <th className="px-4 py-3" scope="col">
                Visto
              </th>
              <th className="px-4 py-3 text-right" scope="col">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedByName.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                  {loading ? 'Cargando routers...' : 'Todavia no hay routers registrados.'}
                </td>
              </tr>
            )}

            {sortedByName.map((router) => (
              <tr className="border-t border-border-subtle" key={router.id}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">{router.name}</div>
                  <div className="text-xs text-slate-500">
                    {router.description ?? 'Sin descripcion'}
                    {!router.isActive && ' · inactivo'}
                  </div>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {router.protocol}://{router.host}:{router.port}
                  <div className="text-slate-500">{router.username}</div>
                </td>
                <td className="px-4 py-3">
                  <RouterStatusBadge status={router.status} />
                  {router.lastError !== null && (
                    <div className="mt-1 max-w-xs truncate text-xs text-danger" title={router.lastError}>
                      {router.lastError}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-600">{formatDateTime(router.lastSeenAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      className={SECONDARY_BUTTON}
                      disabled={busyId === router.id}
                      onClick={() => void testConnection(router)}
                      type="button"
                    >
                      {busyId === router.id ? 'Probando...' : 'Probar'}
                    </button>
                    <a className={SECONDARY_BUTTON} href={`/dashboard/monitoring?router=${router.id}`}>
                      Monitorear
                    </a>
                    <button
                      className={SECONDARY_BUTTON}
                      disabled={busyId === router.id}
                      onClick={() => openEdit(router)}
                      type="button"
                    >
                      Editar
                    </button>
                    <button
                      className={DANGER_BUTTON}
                      disabled={busyId === router.id}
                      onClick={() => void remove(router)}
                      type="button"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        {routers.length} router(s). La contrasena se guarda cifrada con AES-256-GCM y nunca vuelve al navegador.
      </p>
    </div>
  );
}
