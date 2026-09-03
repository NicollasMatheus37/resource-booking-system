-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('EXCLUSIVE', 'SHARED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" "ResourceKind" NOT NULL,
    "units_per_slot" INTEGER NOT NULL,
    "max_units_per_user" INTEGER NOT NULL,
    "max_slots_per_reservation" INTEGER NOT NULL,
    "seats" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slots" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "units_per_slot" INTEGER NOT NULL,
    "reserved_units" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "ReservationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservation_slots" (
    "reservation_id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "resource_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL,
    "exclusive" BOOLEAN NOT NULL,

    CONSTRAINT "reservation_slots_pkey" PRIMARY KEY ("reservation_id","slot_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "slots_resource_id_starts_at_idx" ON "slots"("resource_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "slots_resource_id_starts_at_key" ON "slots"("resource_id", "starts_at");

-- CreateIndex
CREATE INDEX "reservations_user_id_status_idx" ON "reservations"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_user_id_idempotency_key_key" ON "reservations"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "reservation_slots_slot_id_idx" ON "reservation_slots"("slot_id");

-- AddForeignKey
ALTER TABLE "slots" ADD CONSTRAINT "slots_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_slots" ADD CONSTRAINT "reservation_slots_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_slots" ADD CONSTRAINT "reservation_slots_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Invariantes que o schema do Prisma não expressa (ADR 0004).
--
-- Elas vivem AQUI, no banco, e não na aplicação, porque a API é stateless e
-- roda em N réplicas: qualquer verificação feita em memória de processo é falsa
-- por construção — as requisições concorrentes podem cair em processos
-- diferentes. O Postgres é o único ponto de serialização confiável.
-- ---------------------------------------------------------------------------

-- Necessária para combinar `=` (uuid) com `&&` (range) num índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- INVARIANTE 1 — recurso EXCLUSIVE não é agendado duas vezes no mesmo horário.
--
-- Os N cliques simultâneos viram N INSERTs. O índice GiST faz o segundo INSERT
-- BLOQUEAR até o primeiro commitar, e então falhar. Um vence, os outros
-- recebem violação de constraint. Não há leitura prévia a invalidar, portanto
-- não existe janela de corrida.
--
-- A chave é `resource_id`, não `slot_id`: o que precisa ser exclusivo é o
-- recurso naquela janela de tempo. Isso também protege o caso em que a agenda
-- é regerada com outra duração de slot e as janelas antiga e nova se sobrepõem.
ALTER TABLE "reservation_slots"
  ADD CONSTRAINT "reservation_slots_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'CONFIRMED' AND "exclusive");

-- INVARIANTE 3 — um usuário tem no máximo uma reserva confirmada por slot.
-- Em recursos SHARED, impede alguém tomar várias unidades em reservas separadas
-- driblando `max_units_per_user`.
CREATE UNIQUE INDEX "reservation_slots_one_confirmed_per_user"
  ON "reservation_slots" ("slot_id", "user_id")
  WHERE ("status" = 'CONFIRMED');

-- INVARIANTE 2 — o contador disputado nunca sai dos limites.
-- Rede de segurança do UPDATE atômico condicional: mesmo que a expressão da
-- aplicação seja escrita errada um dia, o banco recusa.
ALTER TABLE "slots"
  ADD CONSTRAINT "slots_reserved_units_bounds"
  CHECK ("reserved_units" >= 0 AND "reserved_units" <= "units_per_slot");

ALTER TABLE "slots"
  ADD CONSTRAINT "slots_time_range_valid"
  CHECK ("ends_at" > "starts_at");

-- INVARIANTE 4 — coerência da configuração do recurso.
-- EXCLUSIVE é, por definição, o caso de uma unidade só.
ALTER TABLE "resources"
  ADD CONSTRAINT "resources_exclusive_is_single_unit"
  CHECK (
    "kind" <> 'EXCLUSIVE'
    OR ("units_per_slot" = 1 AND "max_units_per_user" = 1)
  );

ALTER TABLE "resources"
  ADD CONSTRAINT "resources_limits_coherent"
  CHECK (
    "units_per_slot" >= 1
    AND "max_units_per_user" >= 1
    AND "max_units_per_user" <= "units_per_slot"
    AND "max_slots_per_reservation" >= 1
  );

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_quantity_positive"
  CHECK ("quantity" >= 1);
