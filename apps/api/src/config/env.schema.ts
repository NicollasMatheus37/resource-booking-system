import { z } from 'zod';

/**
 * 12-Factor III — Configuração no ambiente.
 *
 * Este é o ÚNICO lugar do backend que lê `process.env`. O schema é validado no
 * boot: variável ausente ou malformada derruba o processo imediatamente, em vez
 * de falhar na primeira requisição de produção.
 *
 * Segredos NÃO têm default. `DATABASE_URL` sem valor derruba a aplicação — não
 * existe fallback para localhost, porque default de segredo é a forma mais comum
 * de vazar credencial para produção sem ninguém perceber.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  PORT: z.coerce.number().int().positive().default(3000),

  /** Sem default: ver comentário acima. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),

  /** Origens permitidas para CORS, separadas por vírgula. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:4200')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  /**
   * Teto do pool de conexões (ADR 0004, admission control). Baixo de
   * propósito: sob contenção é melhor recusar rápido que esgotar o Postgres.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * Timeouts curtos: o perdedor de uma disputa falha rápido em vez de
   * empilhar conexão. Aplicados por transação com SET LOCAL.
   */
  DB_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  /** Janela de slot e horizonte de geração da agenda (ADR 0003). */
  SLOT_DURATION_MINUTES: z.coerce.number().int().positive().default(30),
  SCHEDULE_HORIZON_DAYS: z.coerce.number().int().positive().default(7),

  /**
   * Fuso de OPERAÇÃO dos recursos. A jornada é horário de parede local: uma
   * sala funciona das 8h às 18h no relógio de quem a usa, não em UTC.
   */
  SCHEDULE_TIMEZONE: z
    .string()
    .default('America/Sao_Paulo')
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'fuso IANA inválido (ex.: America/Sao_Paulo)' },
    ),

  SCHEDULE_DAY_START_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  SCHEDULE_DAY_END_HOUR: z.coerce.number().int().min(1).max(24).default(18),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Configuração de ambiente inválida:\n${problems}\n\n` +
        'Confira o .env.example na raiz do repositório.',
    );
  }

  return parsed.data;
}
