import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { IdentityStore } from '../../../core/identity/identity.store';

/**
 * Escolha de identidade — o análogo da tela de login neste MVP (ADR 0008).
 *
 * Quando a autenticação real entrar, esta página vira o formulário de login e
 * o resto da aplicação não muda: o guard e o interceptor já apontam para cá.
 */
@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex max-w-lg flex-col gap-4 py-8">
      <div>
        <h1 class="text-xl font-semibold">Quem é você?</h1>
        <p class="text-sm opacity-70">
          Escolha uma identidade para usar o sistema.
        </p>
      </div>

      <div
        class="alert alert-warning"
        role="note"
      >
        <span class="text-sm">
          Autenticação não faz parte do escopo deste MVP. A identidade é
          simulada: qualquer pessoa pode escolher qualquer usuário.
        </span>
      </div>

      @if (identity.users().length === 0) {
        <div class="skeleton h-24 w-full"></div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (user of identity.users(); track user.id) {
            <li>
              <button
                type="button"
                class="btn btn-outline w-full justify-start"
                (click)="choose(user.id)"
              >
                <span class="flex flex-col items-start">
                  <span class="font-medium">{{ user.name }}</span>
                  <span class="text-xs opacity-60">{{ user.email }}</span>
                </span>
              </button>
            </li>
          }
        </ul>
      }

      <p class="text-xs opacity-60">
        Dica: abra duas abas com usuários diferentes para ver a disputa por um
        mesmo horário acontecendo ao vivo.
      </p>
    </div>
  `,
})
export class SignInPage implements OnInit {
  protected readonly identity = inject(IdentityStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  async ngOnInit(): Promise<void> {
    await this.identity.ensureLoaded();
  }

  protected choose(id: string): void {
    this.identity.select(id);
    const returnUrl =
      this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    void this.router.navigateByUrl(returnUrl);
  }
}
