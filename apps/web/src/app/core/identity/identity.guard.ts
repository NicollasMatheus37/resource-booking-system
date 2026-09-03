import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { IdentityStore } from './identity.store';

/**
 * Exige uma identidade para entrar no dashboard (ADR 0008).
 *
 * Hoje "ter identidade" é ter um usuário escolhido no seletor. Quando a
 * autenticação real entrar, este guard passa a verificar o token — o resto da
 * aplicação não muda.
 *
 * A `returnUrl` é preservada para que o usuário volte ao lugar de onde veio,
 * que é o comportamento que uma tela de login precisaria de qualquer forma.
 */
export const requireIdentity: CanActivateFn = async (_route, state) => {
  const identity = inject(IdentityStore);
  const router = inject(Router);

  await identity.ensureLoaded();

  if (identity.currentId()) return true;

  return router.createUrlTree(['/entrar'], {
    queryParams: { returnUrl: state.url },
  });
};
