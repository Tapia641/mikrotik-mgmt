import { describe, expect, it } from 'vitest';

import type { MikrotikErrorCode } from '@/types';

import {
  MikrotikError,
  classifyMikrotikFailure,
  isMikrotikError,
  toApiErrorCode,
  toMikrotikError,
  trapToMikrotikError,
} from './errors';

/** Doble del `RosException` de la libreria (expone `errno`). */
function rosException(errno: string, message = errno): Error {
  return Object.assign(new Error(message), { errno });
}

describe('classifyMikrotikFailure', () => {
  it('mapea los errno conocidos de la libreria', () => {
    expect(classifyMikrotikFailure(rosException('CANTLOGIN'))).toBe('AUTH_FAILED');
    expect(classifyMikrotikFailure(rosException('LOGINBLOCKED'))).toBe('AUTH_FAILED');
    expect(classifyMikrotikFailure(rosException('SOCKTMOUT'))).toBe('CONNECTION_TIMEOUT');
    expect(classifyMikrotikFailure(rosException('ECONNREFUSED'))).toBe('CONNECTION_REFUSED');
    expect(classifyMikrotikFailure(rosException('EHOSTUNREACH'))).toBe('CONNECTION_REFUSED');
    expect(classifyMikrotikFailure(rosException('EPROTO'))).toBe('TLS_ERROR');
    expect(classifyMikrotikFailure(rosException('TRAP'))).toBe('TRAP');
    expect(classifyMikrotikFailure(rosException('UNKNOWNREPLY'))).toBe('PROTOCOL_ERROR');
  });

  it('acepta el errno en minusculas', () => {
    expect(classifyMikrotikFailure(rosException('cantlogin'))).toBe('AUTH_FAILED');
  });

  it('ignora el errno desconocido pero usa el texto del mensaje', () => {
    const error = Object.assign(new Error('connection refused by peer'), { errno: 'ZZZNOTREAL' });

    expect(classifyMikrotikFailure(error)).toBe('CONNECTION_REFUSED');
  });

  it('prioriza el codigo de socket del mensaje sobre el APIFORBIDDEN generico del SDK', () => {
    // Caso real: puerto cerrado. El SDK etiqueta APIFORBIDDEN y esconde el
    // ECONNREFUSED en el mensaje; sin esta regla se reportaba como credenciales.
    const refused = Object.assign(
      new Error('Connection failed. API may be disabled or filtered. Code: ECONNREFUSED'),
      { errno: 'APIFORBIDDEN' },
    );

    expect(classifyMikrotikFailure(refused)).toBe('CONNECTION_REFUSED');

    const tls = Object.assign(new Error('unable to verify the first certificate'), {
      errno: 'APIFORBIDDEN',
    });
    expect(classifyMikrotikFailure(tls)).toBe('TLS_ERROR');

    const timedOut = Object.assign(
      new Error('Connection timeout. Possible firewall enabled. Code: ETIMEDOUT'),
      { errno: 'APIFORBIDDEN' },
    );
    expect(classifyMikrotikFailure(timedOut)).toBe('CONNECTION_TIMEOUT');
  });

  it('mantiene APIFORBIDDEN como ultimo recurso cuando el mensaje no dice nada', () => {
    expect(classifyMikrotikFailure(rosException('APIFORBIDDEN', 'connection lost'))).toBe(
      'AUTH_FAILED',
    );
  });

  it('no deja que un CANTLOGIN explicito se confunda con un fallo de socket', () => {
    expect(classifyMikrotikFailure(rosException('CANTLOGIN', 'Login failed'))).toBe('AUTH_FAILED');
  });

  it('cae al texto cuando no hay errno reconocible', () => {
    expect(classifyMikrotikFailure(new Error('connect ECONNREFUSED 10.0.0.1:8728'))).toBe(
      'CONNECTION_REFUSED',
    );
    expect(classifyMikrotikFailure(new Error('self-signed certificate'))).toBe('TLS_ERROR');
    expect(classifyMikrotikFailure(new Error('Connection timeout'))).toBe('CONNECTION_TIMEOUT');
    expect(classifyMikrotikFailure(new Error('invalid password'))).toBe('AUTH_FAILED');
  });

  it('no adivina ante un errno desconocido y un texto neutro', () => {
    expect(classifyMikrotikFailure(rosException('ZZZNOTREAL'))).toBe('UNKNOWN');
    expect(classifyMikrotikFailure(new Error('boom'))).toBe('UNKNOWN');
    expect(classifyMikrotikFailure(undefined)).toBe('UNKNOWN');
  });

  it('respeta el codigo de un MikrotikError ya construido', () => {
    const error = new MikrotikError({ code: 'FATAL', message: 'sesion abortada' });

    expect(classifyMikrotikFailure(error)).toBe('FATAL');
  });
});

describe('toMikrotikError', () => {
  it('devuelve la misma instancia si ya es un MikrotikError sin command', () => {
    const error = new MikrotikError({ code: 'TRAP', message: 'no such item' });

    expect(toMikrotikError(error)).toBe(error);
  });

  it('completa el command de un MikrotikError que no lo tenia', () => {
    const error = new MikrotikError({ code: 'TRAP', message: 'no such item' });

    const translated = toMikrotikError(error, '/ip/hotspot/user/remove');

    expect(translated).not.toBe(error);
    expect(translated.command).toBe('/ip/hotspot/user/remove');
    expect(translated.code).toBe('TRAP');
  });

  it('conserva el command original si ya estaba presente', () => {
    const error = new MikrotikError({
      code: 'TRAP',
      message: 'no such item',
      command: '/ip/hotspot/user/remove',
    });

    expect(toMikrotikError(error, '/otra/ruta')).toBe(error);
  });

  it('traduce un error desconocido conservando el mensaje y el cause', () => {
    const cause = rosException('ECONNREFUSED', 'connect ECONNREFUSED');

    const translated = toMikrotikError(cause, '/system/resource/print');

    expect(isMikrotikError(translated)).toBe(true);
    expect(translated.code).toBe('CONNECTION_REFUSED');
    expect(translated.message).toBe('connect ECONNREFUSED');
    expect(translated.command).toBe('/system/resource/print');
    expect(translated.cause).toBe(cause);
    expect(translated.name).toBe('MikrotikError');
  });

  it('usa un mensaje por defecto cuando el error crudo no trae texto', () => {
    const translated = toMikrotikError({ errno: 'SOCKTMOUT' });

    expect(translated.code).toBe('CONNECTION_TIMEOUT');
    expect(translated.message).toContain('tiempo limite');
  });

  it('marca como error de transporte solo los fallos de socket/credenciales', () => {
    const transportCodes: readonly MikrotikErrorCode[] = [
      'CONNECTION_REFUSED',
      'CONNECTION_TIMEOUT',
      'TLS_ERROR',
      'AUTH_FAILED',
    ];

    for (const code of transportCodes) {
      expect(new MikrotikError({ code, message: 'x' }).isTransportError).toBe(true);
    }

    expect(new MikrotikError({ code: 'TRAP', message: 'x' }).isTransportError).toBe(false);
    expect(new MikrotikError({ code: 'PROTOCOL_ERROR', message: 'x' }).isTransportError).toBe(false);
    expect(new MikrotikError({ code: 'UNKNOWN', message: 'x' }).isTransportError).toBe(false);
  });
});

describe('trapToMikrotikError', () => {
  it('materializa un !trap como MikrotikError TRAP', () => {
    const error = trapToMikrotikError({ message: 'no such item (4)', category: 4 }, '/ip/hotspot/user');

    expect(error.code).toBe('TRAP');
    expect(error.message).toBe('no such item (4)');
    expect(error.command).toBe('/ip/hotspot/user');
    expect(error.trap).toEqual({ message: 'no such item (4)', category: 4 });
  });
});

describe('toApiErrorCode', () => {
  it('traduce cada codigo RouterOS a un codigo HTTP', () => {
    expect(toApiErrorCode('CONNECTION_REFUSED')).toBe('ROUTER_UNREACHABLE');
    expect(toApiErrorCode('CONNECTION_TIMEOUT')).toBe('ROUTER_TIMEOUT');
    expect(toApiErrorCode('TLS_ERROR')).toBe('ROUTER_UNREACHABLE');
    expect(toApiErrorCode('AUTH_FAILED')).toBe('ROUTER_AUTH_FAILED');
    expect(toApiErrorCode('PROTOCOL_ERROR')).toBe('ROUTER_COMMAND_FAILED');
    expect(toApiErrorCode('TRAP')).toBe('ROUTER_COMMAND_FAILED');
    expect(toApiErrorCode('FATAL')).toBe('ROUTER_COMMAND_FAILED');
    expect(toApiErrorCode('UNKNOWN')).toBe('ROUTER_COMMAND_FAILED');
  });

  it('expone la traduccion desde la propia instancia', () => {
    const error = new MikrotikError({ code: 'AUTH_FAILED', message: 'x' });

    expect(error.apiErrorCode).toBe('ROUTER_AUTH_FAILED');
  });
});
