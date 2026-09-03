import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { APP_CONFIG } from '../config/app-config';
import { IdentityStore } from '../identity/identity.store';
import { identityInterceptor } from './identity.interceptor';

describe('identityInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let store: IdentityStore;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([identityInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: APP_CONFIG, useValue: { apiUrl: 'http://api.test/api' } },
      ],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    store = TestBed.inject(IdentityStore);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    backend.verify();
    localStorage.clear();
  });

  it('anexa x-user-id quando há identidade', () => {
    store.select('u1');
    http.get('/qualquer').subscribe();

    const req = backend.expectOne('/qualquer');
    expect(req.request.headers.get('x-user-id')).toBe('u1');
    req.flush({});
  });

  it('não anexa header quando não há identidade', () => {
    http.get('/qualquer').subscribe();

    const req = backend.expectOne('/qualquer');
    expect(req.request.headers.has('x-user-id')).toBe(false);
    req.flush({});
  });

  it('no 401 limpa a identidade e manda para /entrar', () => {
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    store.select('u1');

    http.get('/qualquer').subscribe({ error: () => undefined });

    backend
      .expectOne('/qualquer')
      .flush({ code: 'UNAUTHENTICATED' }, { status: 401, statusText: 'Unauthorized' });

    expect(store.currentId()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(
      ['/entrar'],
      expect.objectContaining({ queryParams: expect.anything() }),
    );
  });

  it('não interfere em outros erros', () => {
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    store.select('u1');

    http.get('/qualquer').subscribe({ error: () => undefined });

    backend
      .expectOne('/qualquer')
      .flush({ code: 'SLOT_UNAVAILABLE' }, { status: 409, statusText: 'Conflict' });

    // Um conflito de reserva não é problema de identidade.
    expect(store.currentId()).toBe('u1');
    expect(navigate).not.toHaveBeenCalled();
  });
});
