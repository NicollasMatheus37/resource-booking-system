import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  CreateResourceRequest,
  ResourceDto,
  ResourceKind,
} from '@resource-booking/contracts';

/**
 * Formulário de recurso.
 *
 * A UI reflete as invariantes do domínio em vez de deixar o usuário montar uma
 * configuração que o servidor vai recusar: escolher "uso exclusivo" trava as
 * unidades em 1, e na edição `kind` e `unitsPerSlot` ficam desabilitados
 * porque são imutáveis (mudar a capacidade com reservas de pé criaria
 * overbooking por edição de cadastro).
 */
@Component({
  selector: 'app-resource-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <form class="flex flex-col gap-3" (submit)="onSubmit($event)">
      <label class="form-control">
        <span class="label-text text-sm">Nome</span>
        <input
          class="input input-bordered input-sm"
          [(ngModel)]="name"
          name="name"
          required
          minlength="2"
          maxlength="80"
        />
      </label>

      <label class="form-control">
        <span class="label-text text-sm">Descrição</span>
        <input
          class="input input-bordered input-sm"
          [(ngModel)]="description"
          name="description"
          maxlength="300"
        />
      </label>

      <label class="form-control">
        <span class="label-text text-sm">Tipo</span>
        <select
          class="select select-bordered select-sm"
          [ngModel]="kind()"
          (ngModelChange)="onKindChange($event)"
          name="kind"
          [disabled]="editing() !== null"
        >
          <option value="EXCLUSIVE">Uso exclusivo (1 reserva por horário)</option>
          <option value="SHARED">Compartilhado (N unidades por horário)</option>
        </select>
        @if (editing()) {
          <span class="label-text-alt mt-1 opacity-60">
            Tipo e capacidade são imutáveis após a criação.
          </span>
        }
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="form-control">
          <span class="label-text text-sm">Unidades por horário</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            [(ngModel)]="unitsPerSlot"
            name="unitsPerSlot"
            min="1"
            [disabled]="kind() === 'EXCLUSIVE' || editing() !== null"
          />
        </label>

        <label class="form-control">
          <span class="label-text text-sm">Máx. por usuário</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            [(ngModel)]="maxUnitsPerUser"
            name="maxUnitsPerUser"
            min="1"
            [max]="unitsPerSlot()"
            [disabled]="kind() === 'EXCLUSIVE'"
          />
        </label>

        <label class="form-control">
          <span class="label-text text-sm">Máx. horários/reserva</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            [(ngModel)]="maxSlotsPerReservation"
            name="maxSlotsPerReservation"
            min="1"
          />
        </label>

        <label class="form-control">
          <span class="label-text text-sm">Lugares (informativo)</span>
          <input
            type="number"
            class="input input-bordered input-sm"
            [(ngModel)]="seats"
            name="seats"
            min="1"
          />
        </label>
      </div>

      @if (problem(); as message) {
        <p class="text-error text-sm" role="alert">{{ message }}</p>
      }

      <div class="flex justify-end gap-2">
        <button type="button" class="btn btn-ghost btn-sm" (click)="cancelled.emit()">
          Cancelar
        </button>
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          [disabled]="saving() || problem() !== null"
          [attr.aria-busy]="saving()"
        >
          @if (saving()) {
            <span class="loading loading-spinner loading-xs"></span>
          }
          {{ editing() ? 'Salvar' : 'Criar' }}
        </button>
      </div>
    </form>
  `,
})
export class ResourceForm {
  readonly editing = input<ResourceDto | null>(null);
  readonly saving = input(false);
  readonly submitted = output<CreateResourceRequest>();
  readonly cancelled = output<void>();

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly kind = signal<ResourceKind>('EXCLUSIVE');
  protected readonly unitsPerSlot = signal(1);
  protected readonly maxUnitsPerUser = signal(1);
  protected readonly maxSlotsPerReservation = signal(4);
  protected readonly seats = signal<number | null>(null);

  /** Mesmas regras que o servidor aplica — aqui só para feedback imediato. */
  protected readonly problem = computed<string | null>(() => {
    if (this.name().trim().length < 2) return 'Informe um nome.';
    if (this.unitsPerSlot() < 1) return 'Unidades por horário deve ser ≥ 1.';
    if (this.maxUnitsPerUser() < 1) return 'Máximo por usuário deve ser ≥ 1.';
    if (this.maxUnitsPerUser() > this.unitsPerSlot()) {
      return 'Máximo por usuário não pode exceder as unidades do horário.';
    }
    if (this.maxSlotsPerReservation() < 1) {
      return 'Máximo de horários por reserva deve ser ≥ 1.';
    }
    return null;
  });

  constructor() {
    effect(() => {
      const resource = this.editing();
      if (!resource) return;
      this.name.set(resource.name);
      this.description.set(resource.description ?? '');
      this.kind.set(resource.kind);
      this.unitsPerSlot.set(resource.unitsPerSlot);
      this.maxUnitsPerUser.set(resource.maxUnitsPerUser);
      this.maxSlotsPerReservation.set(resource.maxSlotsPerReservation);
      this.seats.set(resource.seats);
    });
  }

  protected onKindChange(kind: ResourceKind): void {
    this.kind.set(kind);
    // Uso exclusivo É o caso de uma unidade só — a UI não oferece uma
    // configuração que o banco recusaria por CHECK.
    if (kind === 'EXCLUSIVE') {
      this.unitsPerSlot.set(1);
      this.maxUnitsPerUser.set(1);
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (this.problem()) return;

    this.submitted.emit({
      name: this.name().trim(),
      description: this.description().trim() || null,
      kind: this.kind(),
      unitsPerSlot: this.unitsPerSlot(),
      maxUnitsPerUser: this.maxUnitsPerUser(),
      maxSlotsPerReservation: this.maxSlotsPerReservation(),
      seats: this.seats() || null,
    });
  }
}
