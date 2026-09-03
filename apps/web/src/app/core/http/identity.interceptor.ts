import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { IdentityStore } from '../identity/identity.store';

/**
 * Anexa a identidade a toda requisição.
 *
 * É exatamente aqui que o `Authorization: Bearer` entraria no lugar do
 * `x-user-id` quando a autenticação real for implementada (ADR 0008) — um
 * ponto só, sem tocar em nenhuma feature.
 */
export const identityInterceptor: HttpInterceptorFn = (req, next) => {
  const userId = inject(IdentityStore).currentId();
  if (!userId) return next(req);

  return next(req.clone({ setHeaders: { 'x-user-id': userId } }));
};
