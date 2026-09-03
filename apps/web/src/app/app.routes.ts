import { Route } from '@angular/router';
import { requireIdentity } from './core/identity/identity.guard';

export const appRoutes: Route[] = [
  {
    path: 'entrar',
    loadComponent: () =>
      import('./features/identity/pages/sign-in.page').then((m) => m.SignInPage),
  },
  {
    path: '',
    canActivate: [requireIdentity],
    loadComponent: () =>
      import('./features/resources/pages/dashboard.page').then(
        (m) => m.DashboardPage,
      ),
  },
  { path: '**', redirectTo: '' },
];
