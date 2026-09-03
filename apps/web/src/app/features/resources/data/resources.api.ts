import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CreateReservationRequest,
  ReservationDto,
  ReservationSummaryDto,
  ResourceDto,
  SlotDto,
} from '@resource-booking/contracts';
import type { Observable } from 'rxjs';
import { APP_CONFIG } from '../../../core/config/app-config';

@Injectable({ providedIn: 'root' })
export class ResourcesApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(APP_CONFIG).apiUrl;

  listResources(): Observable<ResourceDto[]> {
    return this.http.get<ResourceDto[]>(`${this.base}/resources`);
  }

  listSlots(resourceId: string): Observable<SlotDto[]> {
    return this.http.get<SlotDto[]>(
      `${this.base}/resources/${resourceId}/slots`,
    );
  }

  reserve(body: CreateReservationRequest): Observable<ReservationDto> {
    return this.http.post<ReservationDto>(`${this.base}/reservations`, body, {
      // Defesa em profundidade contra retry de rede — a UI já impede o clique
      // duplo desabilitando o botão (ADR 0004).
      headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
  }

  listMyReservations(): Observable<ReservationSummaryDto[]> {
    return this.http.get<ReservationSummaryDto[]>(`${this.base}/reservations`);
  }

  cancel(reservationId: string): Observable<{ changed: boolean }> {
    return this.http.delete<{ changed: boolean }>(
      `${this.base}/reservations/${reservationId}`,
    );
  }
}
