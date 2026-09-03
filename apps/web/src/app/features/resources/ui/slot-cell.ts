import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { SlotDto } from '@resource-booking/contracts';

type Estado = 'livre' | 'parcial' | 'esgotado' | 'meu' | 'selecionado' | 'invalido';

/**
 * Uma célula da grade. Componente de apresentação puro: sem store, sem HTTP.
 *
 * O mapa de estados visuais está declarado num lugar só (ADR 0007), incluindo
 * o estado "selecionado mas indisponível" — que existe porque remover o slot
 * silenciosamente faria a tela mentir (ADR 0006).
 */
@Component({
  selector: 'app-slot-cell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="btn btn-sm w-full justify-between gap-1 font-normal"
      [class]="classes()"
      [disabled]="disabled()"
      [attr.aria-pressed]="selected()"
      [attr.aria-label]="ariaLabel()"
      (click)="toggled.emit(slot().id)"
    >
      <span class="font-mono text-xs">{{ hora() }}</span>

      @if (estado() === 'invalido') {
        <span class="badge badge-error badge-xs">tomado</span>
      } @else if (estado() === 'meu') {
        <span class="badge badge-success badge-xs">seu</span>
      } @else if (estado() === 'esgotado') {
        <span class="badge badge-ghost badge-xs">cheio</span>
      } @else if (slot().unitsPerSlot > 1) {
        <span class="badge badge-xs">{{ slot().availableUnits }}</span>
      }
    </button>
  `,
})
export class SlotCell {
  readonly slot = input.required<SlotDto>();
  readonly selected = input(false);
  /** Selecionado mas indisponível: o usuário precisa ver e resolver. */
  readonly invalid = input(false);
  readonly toggled = output<string>();

  readonly estado = computed<Estado>(() => {
    if (this.invalid()) return 'invalido';
    if (this.selected()) return 'selecionado';
    if (this.slot().reservedByMe) return 'meu';
    if (this.slot().availableUnits <= 0) return 'esgotado';
    if (this.slot().reservedUnits > 0) return 'parcial';
    return 'livre';
  });

  readonly disabled = computed(
    () =>
      !this.selected() &&
      !this.invalid() &&
      (this.slot().reservedByMe || this.slot().availableUnits <= 0),
  );

  readonly classes = computed(() => {
    switch (this.estado()) {
      case 'selecionado':
        return 'btn-primary';
      case 'invalido':
        return 'btn-outline btn-error';
      case 'meu':
        return 'btn-success btn-outline';
      case 'esgotado':
        return 'btn-ghost opacity-40';
      case 'parcial':
        return 'btn-outline btn-primary';
      default:
        return 'btn-outline';
    }
  });

  readonly hora = computed(() =>
    new Date(this.slot().startsAt).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    }),
  );

  readonly ariaLabel = computed(() => {
    const rotulos: Record<Estado, string> = {
      livre: 'disponível',
      parcial: `${this.slot().availableUnits} unidades disponíveis`,
      esgotado: 'esgotado',
      meu: 'reservado por você',
      selecionado: 'selecionado',
      invalido: 'selecionado, mas já reservado por outra pessoa',
    };
    return `${this.hora()} — ${rotulos[this.estado()]}`;
  });
}
