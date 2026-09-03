import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { IdentityStore } from '../identity/identity.store';

/**
 * Anexa a identidade a toda requisição e trata o 401 num ponto só.
 *
 * É exatamente aqui que o `Authorization: Bearer` entraria no lugar do
 * `x-user-id` quando a autenticação real for implementada (ADR 0008) — um
 * ponto só, sem tocar em nenhuma feature.
 */
export const identityInterceptor: HttpInterceptorFn = (req, next) => {
  const identity = inject(IdentityStore);
  const router = inject(Router);

  const userId = identity.currentId();
  const authenticated = userId
    ? req.clone({ setHeaders: { 'x-user-id': userId } })
    : req;

  return next(authenticated).pipe(
    catchError((error: unknown) => {
      // 401 tratado centralmente: a identidade guardada não vale mais
      // (banco recriado, usuário removido). Cada feature tratar isso por
      // conta própria seria repetição e inconsistência garantidas.
      if (error instanceof HttpErrorResponse && error.status === 401) {
        identity.clear();
        void router.navigate(['/entrar'], {
          queryParams: { returnUrl: router.url },
        });
      }

      return throwError(() => error);
    }),
  );
};
