import { Injectable, inject } from '@angular/core';
import type { SlotAvailabilityChanged } from '@resource-booking/contracts';
import { Observable } from 'rxjs';
import { APP_CONFIG } from '../config/app-config';

export type StreamMessage =
  | { kind: 'open' }
  | { kind: 'error' }
  | { kind: 'change'; payload: SlotAvailabilityChanged };

/**
 * Stream de disponibilidade por SSE (ADR 0005).
 *
 * `EventSource` reconecta sozinho. Cada abertura emite `open`, e é isso que o
 * store usa para refazer o snapshot: eventos são otimização de latência, o
 * `GET` é a fonte da verdade. Assim o sistema permanece correto mesmo perdendo
 * eventos, sem exigir replay no servidor.
 */
@Injectable({ providedIn: 'root' })
export class AvailabilityStream {
  private readonly config = inject(APP_CONFIG);

  connect(): Observable<StreamMessage> {
    return new Observable<StreamMessage>((subscriber) => {
      const source = new EventSource(`${this.config.apiUrl}/events/availability`);

      source.onopen = () => subscriber.next({ kind: 'open' });

      source.addEventListener('availability', (event) => {
        try {
          subscriber.next({
            kind: 'change',
            payload: JSON.parse((event as MessageEvent<string>).data),
          });
        } catch {
          /* frame malformado não derruba o stream */
        }
      });

      source.onerror = () => {
        // O EventSource já vai tentar reconectar; só sinalizamos a UI.
        subscriber.next({ kind: 'error' });
      };

      return () => source.close();
    });
  }
}
