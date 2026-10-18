/**
 * Lista de revocacion de sesiones (logout).
 *
 * Un JWT es sin estado: la unica forma de invalidarlo antes de su `exp` es
 * recordar su `jti`. Esta lista vive en la memoria del proceso, lo cual es
 * suficiente para un despliegue de un solo nodo sobre SQLite, y se autolimpia
 * cuando el token revocado habria expirado de todos modos.
 *
 * Limitacion conocida (documentada en ARCHITECTURE.md): un reinicio del proceso
 * olvida las revocaciones, asi que los tokens revocados vuelven a ser validos
 * hasta su `exp`. Persistirla seria el siguiente paso si se pasa a multi-nodo.
 */

const DEFAULT_MAX_ENTRIES = 10_000;

export interface SessionDenylistOptions {
  /** Reloj inyectable en epoch SEGUNDOS (tests deterministas). */
  readonly now?: () => number;
  /** Cota dura de memoria: al superarla se descartan los `exp` mas proximos. */
  readonly maxEntries?: number;
}

export class SessionDenylist {
  /** `jti` → epoch (segundos) en que expira el token revocado. */
  private readonly revoked = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxEntries: number;

  public constructor(options: SessionDenylistOptions = {}) {
    this.now = options.now ?? ((): number => Math.floor(Date.now() / 1000));
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? DEFAULT_MAX_ENTRIES));
  }

  public get size(): number {
    return this.revoked.size;
  }

  /** Marca un token como revocado hasta su expiracion natural. */
  public revoke(tokenId: string, expiresAt: number): void {
    if (tokenId.length === 0) return;

    this.sweep();
    this.revoked.set(tokenId, expiresAt);

    if (this.revoked.size > this.maxEntries) this.evictSoonest();
  }

  /** `true` si el token fue revocado y aun no habria expirado. */
  public isRevoked(tokenId: string): boolean {
    const expiresAt = this.revoked.get(tokenId);
    if (expiresAt === undefined) return false;

    if (expiresAt <= this.now()) {
      this.revoked.delete(tokenId);
      return false;
    }

    return true;
  }

  public clear(): void {
    this.revoked.clear();
  }

  /** Descarta las entradas cuyo token ya habria expirado por si solo. */
  private sweep(): void {
    const now = this.now();
    for (const [tokenId, expiresAt] of this.revoked) {
      if (expiresAt <= now) this.revoked.delete(tokenId);
    }
  }

  /** Ante presion de memoria sacrifica los tokens que expiran antes. */
  private evictSoonest(): void {
    const ordered = [...this.revoked.entries()].sort(([, a], [, b]) => a - b);
    const excess = this.revoked.size - this.maxEntries;

    for (let index = 0; index < excess; index += 1) {
      const entry = ordered[index];
      if (entry) this.revoked.delete(entry[0]);
    }
  }
}

let sharedDenylist = new SessionDenylist();

export function getSessionDenylist(): SessionDenylist {
  return sharedDenylist;
}

/** Reemplaza la lista compartida (tests). */
export function resetSessionDenylist(): void {
  sharedDenylist = new SessionDenylist();
}
