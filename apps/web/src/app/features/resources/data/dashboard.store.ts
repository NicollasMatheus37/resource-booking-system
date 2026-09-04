import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type {
  CreateReservationResponse,
  CreateResourceRequest,
  ResourceDto,
  SlotDto,
} from '@resource-booking/contracts';
import { EMPTY, catchError, exhaustMap, of, switchMap, tap } from 'rxjs';
import { Subject } from 'rxjs';
import {
  asReservationResult,
  blamedSlotId,
  toApiError,
} from '../../../core/http/api-error';
import { IdentityStore } from '../../../core/identity/identity.store';
import { AvailabilityStream } from '../../../core/realtime/availability.stream';
import { ResourcesApi } from './resources.api';
import {
  canSubmit,
  dashboardReducer,
  invalidSelection,
  maxSlots,
  selectedResource,
} from './dashboard.reducer';
import {
  initialState,
  type DashboardAction,
  type DashboardState,
  type Notice,
} from './dashboard.state';

/**
 * Store da tela (ADR 0006).
 *
 * Divisão de responsabilidade explícita:
 * - **RxJS** para o que é assíncrono e composto no tempo: stream do SSE,
 *   fetch, cancelamento, `exhaustMap` contra requisições sobrepostas.
 * - **Signals** para o estado lido pelo template, com `computed` derivando o
 *   que a UI precisa e change detection eficiente sob `OnPush`.
 *
 * Todo o estado passa pelo reducer puro. Não existe caminho de código que
 * atualize a tela por fora dele.
 */
@Injectable()
export class DashboardStore {
  private readonly api = inject(ResourcesApi);
  private readonly stream = inject(AvailabilityStream);
  private readonly identity = inject(IdentityStore);

  private readonly _state = signal<DashboardState>(initialState);

  private readonly submit$ = new Subject<void>();
  private readonly reloadSlots$ = new Subject<void>();
  private readonly cancel$ = new Subject<string>();
  private readonly reloadReservations$ = new Subject<void>();
  private readonly saveResource$ = new Subject<CreateResourceRequest>();
  private readonly deactivate$ = new Subject<string>();

  readonly state = this._state.asReadonly();
  readonly resources = computed(() => this._state().resources);
  readonly status = computed(() => this._state().status);
  readonly connection = computed(() => this._state().connection);
  readonly notice = computed(() => this._state().notice);
  readonly submitting = computed(() => this._state().submitting);
  readonly quantity = computed(() => this._state().quantity);
  readonly selection = computed(() => this._state().selection);
  readonly resource = computed(() => selectedResource(this._state()));
  readonly maxSlots = computed(() => maxSlots(this._state()));
  readonly invalidSelection = computed(() => invalidSelection(this._state()));
  readonly canSubmit = computed(() => canSubmit(this._state()));
  readonly cancellingId = computed(() => this._state().cancellingId);
  readonly editor = computed(() => this._state().editor);
  readonly savingResource = computed(() => this._state().savingResource);
  readonly myReservations = computed(() =>
    this._state().myReservations.filter((r) => r.status === 'CONFIRMED'),
  );

  readonly slots = computed<readonly SlotDto[]>(() => {
    const s = this._state();
    return s.slotOrder.map((id) => s.slots[id]).filter(Boolean);
  });

  /** Slots agrupados por dia, que é como a grade é desenhada. */
  readonly days = computed(() => {
    const grupos = new Map<string, SlotDto[]>();
    for (const slot of this.slots()) {
      const dia = slot.startsAt.slice(0, 10);
      const atual = grupos.get(dia);
      if (atual) atual.push(slot);
      else grupos.set(dia, [slot]);
    }
    return [...grupos.entries()].map(([date, slots]) => ({ date, slots }));
  });

  constructor() {
    this.wireSlotLoading();
    this.wireSubmission();
    this.wireRealtime();
    this.wireCancellation();
    this.wireResourceEditing();
    this.wireNoticeDismissal();
    this.wireIdentityChanges();
  }

  // --- comandos vindos da UI ---------------------------------------------

  async init(): Promise<void> {
    this.dispatch({ type: 'load-started' });
    try {
      const resources = await this.api.listResources().toPromise();
      this.dispatch({ type: 'resources-loaded', resources: resources ?? [] });
      const primeiro = resources?.[0];
      if (primeiro) this.selectResource(primeiro.id);
      else this.dispatch({ type: 'slots-loaded', slots: [] });
      this.reloadReservations$.next();
    } catch (error) {
      this.dispatch({
        type: 'load-failed',
        message: toApiError(error).message,
      });
    }
  }

  selectResource(resourceId: string): void {
    this.dispatch({ type: 'resource-selected', resourceId });
    this.reloadSlots$.next();
  }

  toggleSlot(slotId: string): void {
    this.dispatch({ type: 'slot-toggled', slotId });
  }

  clearSelection(): void {
    this.dispatch({ type: 'selection-cleared' });
  }

  setQuantity(quantity: number): void {
    this.dispatch({ type: 'quantity-changed', quantity });
  }

  dismissNotice(): void {
    this.dispatch({ type: 'notice-dismissed' });
  }

  cancelReservation(reservationId: string): void {
    if (this._state().cancellingId) return;
    this.cancel$.next(reservationId);
  }

  openEditor(resource: ResourceDto | null = null): void {
    this.dispatch({ type: 'editor-opened', resource });
  }

  closeEditor(): void {
    this.dispatch({ type: 'editor-closed' });
  }

  saveResource(input: CreateResourceRequest): void {
    this.saveResource$.next(input);
  }

  deactivateResource(id: string): void {
    this.deactivate$.next(id);
  }

  submit(): void {
    if (!this.canSubmit()) return;
    this.submit$.next();
  }

  // --- fiação ------------------------------------------------------------

  private wireSlotLoading(): void {
    this.reloadSlots$
      .pipe(
        switchMap(() => {
          const resourceId = this._state().selectedResourceId;
          if (!resourceId) return EMPTY;

          // switchMap: trocar de recurso rápido cancela o fetch anterior, que
          // senão chegaria depois e sobrescreveria a grade certa.
          return this.api.listSlots(resourceId).pipe(
            tap((slots) => this.dispatch({ type: 'slots-loaded', slots })),
            catchError((error) => {
              this.dispatch({
                type: 'load-failed',
                message: toApiError(error).message,
              });
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private wireSubmission(): void {
    this.submit$
      .pipe(
        // exhaustMap: enquanto uma reserva está em voo, cliques repetidos são
        // DESCARTADOS. É a segunda linha de defesa contra o clique duplo,
        // caso a UI falhe em desabilitar o botão (ADR 0006).
        exhaustMap(() => {
          const s = this._state();
          const resource = selectedResource(s);
          if (!resource) return EMPTY;

          this.dispatch({ type: 'submit-started' });

          return this.api
            .reserve({
              resourceId: resource.id,
              slotIds: [...s.selection],
              quantity: resource.kind === 'SHARED' ? s.quantity : undefined,
            })
            .pipe(
              tap((result) => this.settleSubmission(result)),
              catchError((error) => {
                // `409` (nada criado) traz o MESMO contrato de resultado, só
                // pelo canal de erro do Angular.
                const asResult = asReservationResult(error);
                if (asResult) {
                  this.settleSubmission(asResult);
                  return of(null);
                }

                const apiError = toApiError(error);
                this.dispatch({
                  type: 'submit-failed',
                  code: apiError.code,
                  message: apiError.message,
                  slotId: blamedSlotId(apiError),
                });

                // Em conflito a grade está desatualizada: reconciliar.
                // Em falha de rede NÃO se mexe no estado local — não sabemos
                // o que aconteceu do outro lado.
                if (apiError.code !== 'INTERNAL') this.reloadSlots$.next();

                return of(null);
              }),
            );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /** Aplica o resultado (total, parcial ou vazio) e reconcilia. */
  private settleSubmission(result: CreateReservationResponse): void {
    this.dispatch({
      type: 'submit-settled',
      createdBlocks: result.created.length,
      createdSlots: result.created.reduce(
        (total, r) => total + r.slotIds.length,
        0,
      ),
      rejected: result.rejected,
    });

    // Reconcilia com o servidor: a resposta confirma o que é meu, e o refetch
    // traz o efeito de reservas alheias concorrentes.
    this.reloadSlots$.next();
    this.reloadReservations$.next();
  }

  private wireRealtime(): void {
    this.stream
      .connect()
      .pipe(takeUntilDestroyed())
      .subscribe((message) => {
        if (message.kind === 'open') {
          this.dispatch({ type: 'connection-changed', connection: 'live' });
          // Ao (re)conectar, refaz o snapshot: pode ter havido mudança
          // enquanto o stream estava caído (ADR 0005).
          if (this._state().selectedResourceId) this.reloadSlots$.next();
          return;
        }

        if (message.kind === 'error') {
          this.dispatch({ type: 'connection-changed', connection: 'offline' });
          return;
        }

        this.dispatch({
          type: 'availability-changed',
          slotId: message.payload.slotId,
          reservedUnits: message.payload.reservedUnits,
          unitsPerSlot: message.payload.unitsPerSlot,
        });
      });
  }

  private wireCancellation(): void {
    this.cancel$
      .pipe(
        // exhaustMap também aqui: cancelar duas vezes é idempotente no
        // servidor, mas não há motivo para gastar a segunda requisição.
        exhaustMap((reservationId) => {
          this.dispatch({ type: 'cancel-started', reservationId });

          return this.api.cancel(reservationId).pipe(
            tap((result) => {
              this.dispatch({
                type: 'cancel-succeeded',
                changed: result.changed,
              });
              // Cancelar libera unidades: a grade e a lista mudam.
              this.reloadSlots$.next();
              this.reloadReservations$.next();
            }),
            catchError((error) => {
              this.dispatch({
                type: 'cancel-failed',
                message: toApiError(error).message,
              });
              this.reloadReservations$.next();
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();

    this.reloadReservations$
      .pipe(
        switchMap(() =>
          this.api.listMyReservations().pipe(
            tap((reservations) =>
              this.dispatch({ type: 'reservations-loaded', reservations }),
            ),
            catchError(() => EMPTY),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  private wireResourceEditing(): void {
    this.saveResource$
      .pipe(
        exhaustMap((input) => {
          const editor = this._state().editor;
          this.dispatch({ type: 'resource-save-started' });

          const request$ =
            editor?.mode === 'edit'
              ? // `kind` e `unitsPerSlot` não são enviados: são imutáveis, e
                // mandá-los só produziria um 422 confuso.
                this.api.updateResource(editor.resource.id, {
                  name: input.name,
                  description: input.description,
                  maxUnitsPerUser: input.maxUnitsPerUser,
                  maxSlotsPerReservation: input.maxSlotsPerReservation,
                  seats: input.seats,
                })
              : this.api.createResource(input);

          return request$.pipe(
            tap((resource) => {
              this.dispatch({ type: 'resource-saved' });
              this.refreshResources(resource.id, editor?.mode !== 'edit', {
                tone: 'success',
                message:
                  editor?.mode === 'edit'
                    ? 'Recurso atualizado.'
                    : 'Recurso criado, com a agenda gerada.',
              });
            }),
            catchError((error) => {
              this.dispatch({
                type: 'resource-save-failed',
                message: toApiError(error).message,
              });
              return of(null);
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe();

    this.deactivate$
      .pipe(
        exhaustMap((id) =>
          this.api.deactivateResource(id).pipe(
            tap(() => {
              this.dispatch({ type: 'resource-saved' });
              this.refreshResources(null, true, {
                tone: 'success',
                message:
                  'Recurso desativado. As reservas existentes seguem válidas.',
              });
            }),
            catchError((error) => {
              this.dispatch({
                type: 'resource-save-failed',
                message: toApiError(error).message,
              });
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  /**
   * Recarrega a lista e reposiciona a seleção sem deixar a tela vazia.
   *
   * O aviso é emitido no FIM, e não antes: `resource-selected` limpa o aviso
   * por design (uma mensagem sobre o recurso anterior confundiria), então
   * anunciar antes do reposicionamento faria o sucesso desaparecer da tela.
   */
  private refreshResources(
    preferId: string | null,
    select: boolean,
    notice?: Notice,
  ): void {
    this.api.listResources().subscribe({
      next: (resources) => {
        this.dispatch({ type: 'resources-loaded', resources });

        const atual = this._state().selectedResourceId;
        const aindaExiste = resources.some((r) => r.id === atual);

        if (select && preferId && resources.some((r) => r.id === preferId)) {
          this.selectResource(preferId);
        } else if (!aindaExiste) {
          const primeiro = resources[0];
          if (primeiro) this.selectResource(primeiro.id);
          else this.dispatch({ type: 'slots-loaded', slots: [] });
        }

        if (notice) this.dispatch({ type: 'notice-shown', notice });
      },
    });
  }

  /**
   * Sucesso e informação desaparecem sozinhos; aviso e erro ficam até o
   * usuário fechar.
   *
   * A assimetria é deliberada: "reservado" é confirmação de algo que a grade
   * já mostra, e sumir é o comportamento certo. "Um horário não estava mais
   * disponível" é informação que o usuário precisa LER antes de decidir o que
   * fazer — esconder isso depois de quatro segundos seria esconder uma falha.
   */
  private wireNoticeDismissal(): void {
    effect((onCleanup) => {
      // Depende do `computed`, não do estado inteiro: assim um delta de SSE
      // não reinicia o cronômetro do toast.
      const notice = this.notice();
      if (!notice) return;
      if (notice.tone === 'error' || notice.tone === 'warning') return;

      const timer = setTimeout(
        () => this.dispatch({ type: 'notice-dismissed' }),
        4500,
      );
      onCleanup(() => clearTimeout(timer));
    });
  }

  private wireIdentityChanges(): void {
    // Trocar de usuário muda `reservedByMe` de todos os slots.
    effect(() => {
      // Sem identidade, toda requisição volta 401. O efeito roda uma vez no
      // registro, antes de o seletor de usuário ter carregado.
      if (!this.identity.currentId()) return;
      if (this._state().selectedResourceId) this.reloadSlots$.next();
      this.reloadReservations$.next();
    });
  }

  private dispatch(action: DashboardAction): void {
    this._state.update((state) => dashboardReducer(state, action));
  }
}
