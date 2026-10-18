export const metadata = { title: 'Dashboard' };

/**
 * TODO(app): consumir `core/services/report.service.ts` (DashboardMetrics) y
 * renderizar las tarjetas KPI + estado de routers.
 */
export default function DashboardPage() {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Placeholder. KPIs: routers online, sesiones activas, vouchers y ventas.
      </p>
    </section>
  );
}
