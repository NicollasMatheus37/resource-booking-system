import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';

export interface UserDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const STORAGE_KEY = 'resource-booking:user-id';

/**
 * Identidade simulada (ADR 0008).
 *
 * Guarda apenas o id escolhido no seletor. Quando a autenticação real entrar,
 * este store passa a guardar o token e o interceptor troca de header — nada
 * mais muda.
 */
@Injectable({ providedIn: 'root' })
export class IdentityStore {
  private readonly http = inject(HttpClient);
  private readonly config = inject(APP_CONFIG);

  private readonly _users = signal<readonly UserDto[]>([]);
  private readonly _currentId = signal<string | null>(read());

  readonly users = this._users.asReadonly();
  readonly currentId = this._currentId.asReadonly();
  readonly current = computed(
    () => this._users().find((u) => u.id === this._currentId()) ?? null,
  );

  private loading: Promise<void> | null = null;

  /**
   * Carrega os usuários uma vez só. Idempotente porque é chamada pelo guard
   * de rota, que pode disparar em navegações concorrentes.
   */
  ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const users = await firstValueFrom(
      this.http.get<UserDto[]>(`${this.config.apiUrl}/users`),
    ).catch(() => [] as UserDto[]);

    this._users.set(users);

    // Descarta uma identidade guardada que não existe mais (banco recriado,
    // seed rodado de novo). Sem isso o usuário ficaria preso em 401.
    const atual = this._currentId();
    if (atual && !users.some((u) => u.id === atual)) this.select(null);
  }

  /** Chamado no 401: a identidade guardada não vale mais. */
  clear(): void {
    this.select(null);
  }

  select(id: string | null): void {
    this._currentId.set(id);
    write(id);
  }
}

/**
 * localStorage pode lançar (janela privada, site data bloqueado). Um seletor
 * de usuário não vale derrubar a aplicação.
 */
function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function write(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* preferência de conveniência: perder não é problema */
  }
}
