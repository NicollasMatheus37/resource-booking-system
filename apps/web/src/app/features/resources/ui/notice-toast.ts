import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { Notice } from '../data/dashboard.state';

/**
 * Resultado da ação como toast, não como faixa no topo.
 *
 * A faixa empurrava a grade para baixo a cada reserva, e num sistema em que a
 * pessoa clica várias vezes seguidas isso é um layout pulando debaixo do
 * cursor. O toast flutua e não desloca nada.
 *
 * `aria-live="polite"` e `role="status"` mantêm o anúncio para leitor de tela —
 * o toast não pode ser invisível para quem não vê a tela.
 */
@Component({
  selector: 'app-notice-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `display: contents` — o host não cria caixa própria, então o container
  // fixo lá dentro posiciona-se em relação à viewport sem um wrapper inline
  // de tamanho zero no meio.
  host: { class: 'contents' },
  template: `
    <div class="toast toast-top toast-end z-50">
      <div
        class="alert max-w-sm shadow-lg"
        [class.alert-success]="notice().tone === 'success'"
        [class.alert-error]="notice().tone === 'error'"
        [class.alert-warning]="notice().tone === 'warning'"
        [class.alert-info]="notice().tone === 'info'"
        role="status"
        aria-live="polite"
      >
        <span class="flex-1 text-sm">{{ notice().message }}</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-label="Fechar aviso"
          (click)="dismissed.emit()"
        >
          ✕
        </button>
      </div>
    </div>
  `,
})
export class NoticeToast {
  readonly notice = input.required<Notice>();
  readonly dismissed = output<void>();
}
