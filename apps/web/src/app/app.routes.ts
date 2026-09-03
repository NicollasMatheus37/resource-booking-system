import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () =>
      import('./features/resources/pages/dashboard.page').then(
        (m) => m.DashboardPage,
      ),
  },
  { path: '**', redirectTo: '' },
];
