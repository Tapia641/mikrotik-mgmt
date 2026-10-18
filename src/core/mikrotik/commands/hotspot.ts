import type { RosCommand } from '@/types';

import { ROS_PATHS } from '@/core/constants';

/**
 * Fusiona los parametros obligatorios con los opcionales garantizando que los
 * obligatorios NUNCA puedan ser sobrescritos por el llamador.
 */
function withRequired(
  required: Record<string, string | number | boolean>,
  extra: Readonly<Record<string, string | number | boolean>>,
): Record<string, string | number | boolean> {
  const merged: Record<string, string | number | boolean> = { ...required };

  for (const [key, value] of Object.entries(extra)) {
    if (!(key in merged)) merged[key] = value;
  }

  return merged;
}

/**
 * Builders de comandos RouterOS para el menu `/ip/hotspot`.
 * Funciones puras: devuelven una `RosCommand`, no ejecutan nada.
 */
export const hotspotCommands = {
  /* ── Servers ─────────────────────────────────────────────── */
  listServers: (): RosCommand => ({
    path: ROS_PATHS.hotspotServer,
    action: 'print',
    readOnly: true,
  }),

  /* ── User profiles (/ip/hotspot/user/profile) ────────────── */
  listProfiles: (filter: Readonly<Record<string, string>> = {}): RosCommand => ({
    path: ROS_PATHS.hotspotProfile,
    action: 'print',
    params: filter,
    readOnly: true,
  }),

  /** Un perfil por nombre: la busqueda la hace el router, no el cliente. */
  findProfileByName: (name: string): RosCommand => ({
    path: ROS_PATHS.hotspotProfile,
    action: 'print',
    params: { name },
    readOnly: true,
  }),

  addProfile: (name: string, params: Readonly<Record<string, string | number | boolean>> = {}): RosCommand => ({
    path: ROS_PATHS.hotspotProfile,
    action: 'add',
    params: withRequired({ name }, params),
    readOnly: false,
  }),

  setProfile: (id: string, params: Readonly<Record<string, string | number | boolean>>): RosCommand => ({
    path: ROS_PATHS.hotspotProfile,
    action: 'set',
    params: withRequired({ '.id': id }, params),
    readOnly: false,
  }),

  removeProfile: (id: string): RosCommand => ({
    path: ROS_PATHS.hotspotProfile,
    action: 'remove',
    params: { '.id': id },
    readOnly: false,
  }),

  /* ── Users ───────────────────────────────────────────────── */
  listUsers: (filter: Readonly<Record<string, string>> = {}): RosCommand => ({
    path: ROS_PATHS.hotspotUser,
    action: 'print',
    params: filter,
    readOnly: true,
  }),

  findUserByName: (name: string): RosCommand => ({
    path: ROS_PATHS.hotspotUser,
    action: 'print',
    params: { name },
    readOnly: true,
  }),

  addUser: (
    name: string,
    password: string,
    profile: string,
    params: Readonly<Record<string, string | number | boolean>> = {},
  ): RosCommand => ({
    path: ROS_PATHS.hotspotUser,
    action: 'add',
    params: withRequired({ name, password, profile }, params),
    readOnly: false,
  }),

  setUser: (id: string, params: Readonly<Record<string, string | number | boolean>>): RosCommand => ({
    path: ROS_PATHS.hotspotUser,
    action: 'set',
    params: withRequired({ '.id': id }, params),
    readOnly: false,
  }),

  removeUser: (id: string): RosCommand => ({
    path: ROS_PATHS.hotspotUser,
    action: 'remove',
    params: { '.id': id },
    readOnly: false,
  }),

  /* ── Active sessions ─────────────────────────────────────── */
  listActive: (filter: Readonly<Record<string, string>> = {}): RosCommand => ({
    path: ROS_PATHS.hotspotActive,
    action: 'print',
    params: filter,
    readOnly: true,
  }),

  /** `!remove` sobre una sesion activa fuerza la desconexion del cliente. */
  disconnectSession: (id: string): RosCommand => ({
    path: ROS_PATHS.hotspotActive,
    action: 'remove',
    params: { '.id': id },
    readOnly: false,
  }),

  /* ── Hosts ───────────────────────────────────────────────── */
  listHosts: (filter: Readonly<Record<string, string>> = {}): RosCommand => ({
    path: ROS_PATHS.hotspotHost,
    action: 'print',
    params: filter,
    readOnly: true,
  }),
} as const;
