import type { RouterStatus } from '@/types';

/**
 * Insignia de estado de conexion. El color no es el unico indicador: el texto
 * acompaña siempre a la forma (accesibilidad para daltonismo).
 */

const LABELS: Readonly<Record<RouterStatus, string>> = {
  unknown: 'Sin probar',
  connecting: 'Conectando',
  online: 'En linea',
  offline: 'Sin conexion',
  unauthorized: 'Credenciales',
};

const CLASSES: Readonly<Record<RouterStatus, string>> = {
  unknown: 'bg-surface-muted text-slate-600',
  connecting: 'bg-info/10 text-info',
  online: 'bg-success/10 text-success',
  offline: 'bg-danger/10 text-danger',
  unauthorized: 'bg-warning/10 text-warning',
};

const DOTS: Readonly<Record<RouterStatus, string>> = {
  unknown: 'bg-slate-400',
  connecting: 'bg-info',
  online: 'bg-success',
  offline: 'bg-danger',
  unauthorized: 'bg-warning',
};

export interface RouterStatusBadgeProps {
  readonly status: RouterStatus;
}

export function RouterStatusBadge({ status }: RouterStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${CLASSES[status]}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${DOTS[status]}`} />
      {LABELS[status]}
    </span>
  );
}
