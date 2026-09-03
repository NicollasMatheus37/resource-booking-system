import { Injectable } from '@nestjs/common';
import type { SlotAvailabilityChanged } from '@resource-booking/contracts';
import { Subject, type Observable } from 'rxjs';
import type { AvailabilityPublisher } from '../../modules/reservations/application/ports';

export interface AvailabilityEvent {
  readonly id: number;
  readonly payload: SlotAvailabilityChanged;
}

/**
 * Barramento em memória entre o caso de uso e as conexões SSE abertas.
 *
 * LIMITAÇÃO DECLARADA (ADR 0005): é local ao processo. Com N réplicas da API,
 * um evento gerado na réplica A não alcança clientes conectados na réplica B.
 * A solução é `LISTEN/NOTIFY` do Postgres ou Redis pub/sub, e é por isso que
 * o publisher fica atrás de uma interface: entra sem tocar no resto.
 *
 * O sistema continua CORRETO com esse limite, porque eventos são otimização
 * de latência — o `GET` é a fonte da verdade e o cliente refaz o snapshot ao
 * reconectar.
 */
@Injectable()
export class InMemoryAvailabilityPublisher implements AvailabilityPublisher {
  private readonly stream = new Subject<AvailabilityEvent>();
  private nextId = 1;

  publish(events: readonly SlotAvailabilityChanged[]): void {
    for (const payload of events) {
      this.stream.next({ id: this.nextId++, payload });
    }
  }

  asObservable(): Observable<AvailabilityEvent> {
    return this.stream.asObservable();
  }
}
