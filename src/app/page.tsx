import { redirect } from 'next/navigation';

/**
 * Raiz del panel: manda al dashboard. El proxy (`src/proxy.ts`) redirige a
 * `/login` cuando no hay sesion valida, asi que esta ruta nunca decide sola.
 */
export default function RootPage() {
  redirect('/dashboard');
}
