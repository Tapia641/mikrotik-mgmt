/**
 * Capa de casos de uso. Es el UNICO punto de entrada para `src/app`.
 *
 * Contratos: `import type { RouterService } from '@core/services'`.
 * Implementaciones: objetos exportados (`routerService`, ...) que hoy son
 * esqueletos y se completaran fase por fase.
 */
export type { AuthService, AuthServiceDeps, LoginContext } from './auth.service';
export type { RouterService, RouterServiceDeps } from './router.service';
export type { HotspotService, HotspotServiceDeps } from './hotspot.service';
export type { VoucherService, VoucherServiceDeps } from './voucher.service';
export type { ReportService, ReportServiceDeps } from './report.service';

export { authService, createAuthService } from './auth.service';
export { createRouterService, routerService, statusFromFailure } from './router.service';
export { createHotspotService, hotspotService } from './hotspot.service';
export { createVoucherService, voucherService } from './voucher.service';
export { createReportService, reportService } from './report.service';
