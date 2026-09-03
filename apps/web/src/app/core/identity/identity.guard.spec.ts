import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../config/app-config';
import { requireIdentity } from './identity.guard';
import { IdentityStore } from './identity.store';

const API = 'http://api.test/api';

const USUARIOS = [
  { id: 'u1', name: 'Ana', email: 'ana@x.com' },
  { id: 'u2', name: 'Bruno', email: 'bruno@x.com' },
];

function run(url = '/') {
  return TestBed.runInInjectionContext(() =>
    requireIdentity(
      {} as never,
      { url } as never,
    ),
  ) as Promise<boolean | UrlTree>;
}

describe('requireIdentity', () => {
  let http: HttpTestingController;
  let store: IdentityStore;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: APP_CONFIG, useValue: { apiUrl: API } },
      ],
    });

    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(IdentityStore);
  });

  afterEach(() => localStorage.clear());

  it('redireciona para /entrar quando não há identidade, preservando a rota', async () => {
    const resultado = run('/agenda');
    http.expectOne(`${API}/users`).flush(USUARIOS);

    const tree = (await resultado) as UrlTree;
    expect(tree).toBeInstanceOf(UrlTree);
    expect(tree.toString()).toContain('/entrar');
    expect(tree.toString()).toContain('returnUrl');
  });

  it('libera quando há identidade guardada e válida', async () => {
    store.select('u2');

    const resultado = run();
    http.expectOne(`${API}/users`).flush(USUARIOS);

    expect(await resultado).toBe(true);
  });

  it('descarta identidade guardada que não existe mais', async () => {
    // Cenário real: banco recriado, seed rodado de novo, ids mudaram.
    store.select('fantasma');

    const resultado = run();
    http.expectOne(`${API}/users`).flush(USUARIOS);

    const tree = (await resultado) as UrlTree;
    expect(tree).toBeInstanceOf(UrlTree);
    expect(store.currentId()).toBeNull();
  });

  it('carrega os usuários uma única vez em navegações concorrentes', async () => {
    const a = run();
    const b = run();

    http.expectOne(`${API}/users`).flush(USUARIOS);
    await Promise.all([a, b]);

    http.expectNone(`${API}/users`);
  });
});
