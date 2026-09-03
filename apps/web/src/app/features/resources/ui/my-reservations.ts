import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ReservationSummaryDto } from '@resource-booking/contracts';

@Component({
  selector: 'app-my-reservations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bg-base-100 rounded-box p-3">
      @if (reservations().length === 0) {
        <p class="text-sm opacity-60">Você ainda não tem reservas.</p>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (reservation of reservations(); track reservation.id) {
            <li class="border-base-300 flex flex-col gap-1 rounded border p-2">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-sm font-medium">
                  {{ reservation.resource.name }}
                </span>
                @if (reservation.resource.kind === 'SHARED') {
                  <span class="badge badge-xs badge-accent">
                    {{ reservation.quantity }}x
                  </span>
                }
              </div>

              <span class="text-xs opacity-70">
                {{ formatRange(reservation) }}
              </span>

              <button
                type="button"
                class="btn btn-ghost btn-xs text-error self-start"
                [disabled]="cancellingId() !== null"
                [attr.aria-busy]="cancellingId() === reservation.id"
                (click)="cancelled.emit(reservation.id)"
              >
                @if (cancellingId() === reservation.id) {
                  <span class="loading loading-spinner loading-xs"></span>
                  Cancelando…
                } @else {
                  Cancelar
                }
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class MyReservations {
  readonly reservations = input.required<readonly ReservationSummaryDto[]>();
  /** Só a reserva em cancelamento mostra spinner; todas ficam desabilitadas. */
  readonly cancellingId = input<string | null>(null);
  readonly cancelled = output<string>();

  protected formatRange(reservation: ReservationSummaryDto): string {
    const slots = reservation.slots;
    if (slots.length === 0) return '';

    const inicio = new Date(slots[0].startsAt);
    const fim = new Date(slots[slots.length - 1].endsAt);

    const dia = inicio.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
    });
    const hora = (d: Date) =>
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const contiguo = slots.length === 1 || isContiguous(slots);

    return contiguo
      ? `${dia} · ${hora(inicio)}–${hora(fim)}`
      : `${dia} · ${slots.length} horários`;
  }
}

/** Seleção não precisa ser contígua (ADR 0011); o rótulo reflete isso. */
function isContiguous(
  slots: ReservationSummaryDto['slots'],
): boolean {
  for (let i = 1; i < slots.length; i += 1) {
    if (slots[i].startsAt !== slots[i - 1].endsAt) return false;
  }
  return true;
}
