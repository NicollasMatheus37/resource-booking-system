import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * 12-Factor XII — processo administrativo one-off, rodado no mesmo ambiente e
 * imagem da aplicação.
 *
 * Gera os dois `kind` de recurso de propósito (ADR 0003): assim os dois
 * caminhos de concorrência do ADR 0004 — constraint de exclusão e contador
 * atômico — ficam exercitáveis na mesma tela.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL é obrigatória para rodar o seed.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const SLOT_MINUTES = Number(process.env.SLOT_DURATION_MINUTES ?? 30);
const HORIZON_DAYS = Number(process.env.SCHEDULE_HORIZON_DAYS ?? 7);
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 18;

const USERS = [
  { name: 'Ana Souza', email: 'ana@exemplo.com' },
  { name: 'Bruno Lima', email: 'bruno@exemplo.com' },
  { name: 'Carla Dias', email: 'carla@exemplo.com' },
  { name: 'Diego Alves', email: 'diego@exemplo.com' },
];

const RESOURCES = [
  {
    name: 'Sala Azul',
    description: 'Sala de reunião com projetor e videoconferência.',
    kind: 'EXCLUSIVE' as const,
    unitsPerSlot: 1,
    maxUnitsPerUser: 1,
    maxSlotsPerReservation: 4,
    seats: 10,
  },
  {
    name: 'Sala Verde',
    description: 'Sala pequena para reuniões rápidas.',
    kind: 'EXCLUSIVE' as const,
    unitsPerSlot: 1,
    maxUnitsPerUser: 1,
    maxSlotsPerReservation: 4,
    seats: 4,
  },
  {
    name: 'Vaga A-14',
    description: 'Vaga de garagem numerada, coberta.',
    kind: 'EXCLUSIVE' as const,
    unitsPerSlot: 1,
    maxUnitsPerUser: 1,
    maxSlotsPerReservation: 4,
    seats: null,
  },
  {
    name: 'Garagem Setor B',
    description: 'Vagas não numeradas, atribuídas por ordem de chegada.',
    kind: 'SHARED' as const,
    unitsPerSlot: 30,
    maxUnitsPerUser: 2,
    maxSlotsPerReservation: 4,
    seats: null,
  },
  {
    name: 'Ingresso VIP — Lote 1',
    description: 'Área VIP com acesso ao lounge.',
    kind: 'SHARED' as const,
    unitsPerSlot: 100,
    maxUnitsPerUser: 4,
    maxSlotsPerReservation: 2,
    seats: null,
  },
];

/** Slots discretos alinhados à grade, do dia de hoje até o horizonte. */
function generateSlots(from: Date, days: number): { startsAt: Date; endsAt: Date }[] {
  const slots: { startsAt: Date; endsAt: Date }[] = [];
  const perDay = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES;

  for (let day = 0; day < days; day += 1) {
    const base = new Date(from);
    base.setUTCDate(base.getUTCDate() + day);
    base.setUTCHours(DAY_START_HOUR, 0, 0, 0);

    for (let i = 0; i < perDay; i += 1) {
      const startsAt = new Date(base.getTime() + i * SLOT_MINUTES * 60_000);
      slots.push({
        startsAt,
        endsAt: new Date(startsAt.getTime() + SLOT_MINUTES * 60_000),
      });
    }
  }

  return slots;
}

async function main(): Promise<void> {
  // Idempotente: rodar de novo recompõe o estado inicial sem duplicar.
  await prisma.reservationSlot.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.slot.deleteMany();
  await prisma.resource.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({ data: USERS });

  const grid = generateSlots(new Date(), HORIZON_DAYS);

  for (const resource of RESOURCES) {
    const created = await prisma.resource.create({ data: resource });

    await prisma.slot.createMany({
      data: grid.map((slot) => ({
        resourceId: created.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        unitsPerSlot: created.unitsPerSlot,
      })),
    });
  }

  const [users, resources, slots] = await Promise.all([
    prisma.user.count(),
    prisma.resource.count(),
    prisma.slot.count(),
  ]);

  console.log(
    `Seed concluído: ${users} usuários, ${resources} recursos, ${slots} slots ` +
      `(${SLOT_MINUTES}min, ${HORIZON_DAYS} dias).`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
