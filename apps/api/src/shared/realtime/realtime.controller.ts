import { Controller, Sse, type MessageEvent } from '@nestjs/common';
import { map, merge, type Observable } from 'rxjs';
import { interval } from 'rxjs';
import { Public } from '../../modules/identity/public.decorator';
import { InMemoryAvailabilityPublisher } from './availability.publisher';

/** Mantém a conexão viva através de proxies com idle timeout (ADR 0005). */
const HEARTBEAT_MS = 25_000;

@Controller('events')
export class RealtimeController {
  constructor(private readonly publisher: InMemoryAvailabilityPublisher) {}

  /**
   * Stream de disponibilidade.
   *
   * PÚBLICO por necessidade técnica, não por descuido: o `EventSource` do
   * browser não permite headers customizados, então o `x-user-id` não chega
   * aqui. Isso é aceitável porque o payload não contém nada específico de
   * usuário — apenas contadores de slot, que qualquer pessoa com acesso ao
   * dashboard já enxerga pelo `GET /resources/:id/slots`.
   *
   * Se um dia o stream carregar dado por usuário, a autorização terá de vir
   * por cookie ou token em query string.
   */
  @Public()
  @Sse('availability')
  availability(): Observable<MessageEvent> {
    const changes = this.publisher.asObservable().pipe(
      map(
        (event): MessageEvent => ({
          id: String(event.id),
          type: 'availability',
          data: event.payload,
        }),
      ),
    );

    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: {} })),
    );

    return merge(changes, heartbeat);
  }
}
