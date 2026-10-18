import { NextResponse } from 'next/server';

import type { ApiResponse } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface HealthPayload {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly nodeVersion: string;
}

/** Liveness/readiness: no toca SQLite ni RouterOS. */
export function GET() {
  const body: ApiResponse<HealthPayload> = {
    ok: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      nodeVersion: process.version,
    },
    meta: { requestId: crypto.randomUUID() },
  };

  return NextResponse.json(body, { status: 200 });
}
