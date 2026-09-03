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

  /** Janela de slot e horizonte de geração da agenda (ADR 0003). */
  SLOT_DURATION_MINUTES: z.coerce.number().int().positive().default(30),
  SCHEDULE_HORIZON_DAYS: z.coerce.number().int().positive().default(7),
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
