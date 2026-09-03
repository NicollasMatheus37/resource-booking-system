import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { ConnectionState } from '../data/dashboard.state';

/**
 * O usuário precisa saber se está vendo dado ao vivo ou degradado — por isso
 * `connection` é estado de primeira classe, não detalhe interno (ADR 0006).
 */
@Component({
  selector: 'app-connection-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('live') {
        <span class="badge badge-success badge-sm gap-1" role="status">
          <span class="inline-block size-2 rounded-full bg-current"></span>
          ao vivo
        </span>
      }
      @case ('offline') {
        <span class="badge badge-warning badge-sm" role="status">
          reconectando
        </span>
      }
      @default {
        <span class="badge badge-ghost badge-sm" role="status">
          conectando
        </span>
      }
    }
  `,
})
export class ConnectionBadge {
  readonly state = input.required<ConnectionState>();
}
