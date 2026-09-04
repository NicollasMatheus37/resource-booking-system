import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
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
 *
 * O empilhamento de label e campo é feito com flex explícito. O DaisyUI 5
 * removeu a classe `form-control`, que na v4 fazia isso — depender dela
 * deixava os labels lado a lado com os inputs.
 */
@Component({
  selector: 'app-resource-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <form class="flex flex-col gap-4" (submit)="onSubmit($event)">
      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Nome</span>
        <input
          #firstField
          class="input input-sm w-full"
          [(ngModel)]="name"
          name="name"
          required
          minlength="2"
          maxlength="80"
          autocomplete="off"
          (blur)="touch()"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Descrição</span>
        <input
          class="input input-sm w-full"
          [(ngModel)]="description"
          name="description"
          maxlength="300"
          autocomplete="off"
        />
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm font-medium">Tipo</span>
        <select
          class="select select-sm w-full"
          [ngModel]="kind()"
          (ngModelChange)="onKindChange($event)"
          name="kind"
          [disabled]="editing() !== null"
        >
          <option value="EXCLUSIVE">
            Uso exclusivo (1 reserva por horário)
          </option>
          <option value="SHARED">
            Compartilhado (N unidades por horário)
          </option>
        </select>
        @if (editing()) {
          <span class="text-xs opacity-60">
            Tipo e capacidade são imutáveis após a criação.
          </span>
        }
      </label>

      <div class="grid gap-4 sm:grid-cols-2">
        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Unidades por horário</span>
          <input
            type="number"
            class="input input-sm w-full"
            [(ngModel)]="unitsPerSlot"
            name="unitsPerSlot"
            min="1"
            [disabled]="kind() === 'EXCLUSIVE' || editing() !== null"
            (blur)="touch()"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Máx. por usuário</span>
          <input
            type="number"
            class="input input-sm w-full"
            [(ngModel)]="maxUnitsPerUser"
            name="maxUnitsPerUser"
            min="1"
            [max]="unitsPerSlot()"
            [disabled]="kind() === 'EXCLUSIVE'"
            (blur)="touch()"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Máx. horários por reserva</span>
          <input
            type="number"
            class="input input-sm w-full"
            [(ngModel)]="maxSlotsPerReservation"
            name="maxSlotsPerReservation"
            min="1"
            (blur)="touch()"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-sm font-medium">Lugares</span>
          <input
            type="number"
            class="input input-sm w-full"
            [(ngModel)]="seats"
            name="seats"
            min="1"
            placeholder="informativo"
          />
        </label>
      </div>

      <!--
        A mensagem só aparece depois de o usuário interagir ou tentar enviar.
        Acusar "informe um nome" num formulário recém-aberto é apontar erro em
        algo que a pessoa ainda não teve chance de fazer.
      -->
      @if (touched() && problem(); as message) {
        <p class="text-error text-sm" role="alert">{{ message }}</p>
      }

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="cancelled.emit()"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          [disabled]="saving()"
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
export class ResourceForm implements AfterViewInit {
  private readonly firstFieldRef =
    viewChild<ElementRef<HTMLInputElement>>('firstField');

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

  /** Só depois de interagir é que erros são exibidos. */
  protected readonly touched = signal(false);

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

  /** O modal não é aberto por `showModal()`, então o foco vai na mão. */
  ngAfterViewInit(): void {
    this.firstFieldRef()?.nativeElement.focus();
  }

  protected touch(): void {
    this.touched.set(true);
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

    // Tentar enviar conta como interação: aqui a mensagem deve aparecer.
    this.touched.set(true);
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
