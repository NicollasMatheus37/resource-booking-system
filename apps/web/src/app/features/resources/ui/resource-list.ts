import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { ResourceDto } from '@resource-booking/contracts';

@Component({
  selector: 'app-resource-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="menu bg-base-100 rounded-box w-full gap-1 p-2">
      @for (resource of resources(); track resource.id) {
        <li>
          <button
            type="button"
            class="flex-col items-start gap-1"
            [class.menu-active]="resource.id === selectedId()"
            (click)="selected.emit(resource.id)"
          >
            <span class="font-medium">{{ resource.name }}</span>
            <span class="flex flex-wrap items-center gap-1">
              @if (resource.kind === 'EXCLUSIVE') {
                <span class="badge badge-xs badge-neutral">uso exclusivo</span>
              } @else {
                <span class="badge badge-xs badge-accent">
                  {{ resource.unitsPerSlot }} unidades
                </span>
              }
              @if (resource.seats) {
                <span class="badge badge-xs badge-ghost">
                  {{ resource.seats }} lugares
                </span>
              }
            </span>
          </button>
        </li>
      }
    </ul>
  `,
})
export class ResourceList {
  readonly resources = input.required<readonly ResourceDto[]>();
  readonly selectedId = input<string | null>(null);
  readonly selected = output<string>();
}
