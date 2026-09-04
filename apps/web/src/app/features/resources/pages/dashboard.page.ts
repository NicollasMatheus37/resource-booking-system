import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IdentityStore } from '../../../core/identity/identity.store';
import { DashboardStore } from '../data/dashboard.store';
import { ConnectionBadge } from '../ui/connection-badge';
import { MyReservations } from '../ui/my-reservations';
import { NoticeToast } from '../ui/notice-toast';
import { ResourceForm } from '../ui/resource-form';
import { ResourceList } from '../ui/resource-list';
import { SlotCell } from '../ui/slot-cell';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [DashboardStore],
  imports: [
    FormsModule,
    ConnectionBadge,
    MyReservations,
    NoticeToast,
    ResourceForm,
    ResourceList,
    SlotCell,
  ],
  templateUrl: './dashboard.page.html',
})
export class DashboardPage implements OnInit {
  protected readonly store = inject(DashboardStore);
  protected readonly identity = inject(IdentityStore);

  protected readonly invalidSet = computed(
    () => new Set(this.store.invalidSelection()),
  );
  protected readonly selectionSet = computed(
    () => new Set(this.store.selection()),
  );

  /** Confirmação de ação destrutiva, local à tela. */
  protected readonly confirmingDeactivate = signal(false);

  protected onResourceSelected(resourceId: string): void {
    this.confirmingDeactivate.set(false);
    this.store.selectResource(resourceId);
  }

  protected confirmDeactivate(resourceId: string): void {
    this.confirmingDeactivate.set(false);
    this.store.deactivateResource(resourceId);
  }

  /** Concordância em português — "1 horário(s)" fica errado em qualquer caso. */
  protected readonly selectionLabel = computed(() => {
    const n = this.store.selection().length;
    return n === 1 ? '1 horário selecionado' : `${n} horários selecionados`;
  });

  protected readonly invalidLabel = computed(() => {
    const n = this.store.invalidSelection().length;
    return n === 1
      ? '1 horário da seleção já foi reservado — remova para continuar.'
      : `${n} horários da seleção já foram reservados — remova para continuar.`;
  });

  protected readonly maxSlotsLabel = computed(() => {
    const n = this.store.resource()?.maxSlotsPerReservation ?? 1;
    return n === 1 ? 'até 1 horário por reserva' : `até ${n} horários por reserva`;
  });

  protected readonly quantityOptions = computed(() => {
    const max = this.store.resource()?.maxUnitsPerUser ?? 1;
    return Array.from({ length: max }, (_, i) => i + 1);
  });

  async ngOnInit(): Promise<void> {
    // A identidade já foi resolvida pelo guard da rota (ADR 0008).
    await this.store.init();
  }

  protected formatDay(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
  }

  protected onUserChange(id: string): void {
    this.confirmingDeactivate.set(false);
    this.identity.select(id);
  }
}
