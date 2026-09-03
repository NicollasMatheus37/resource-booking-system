import { loadEnv } from './env.schema';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadEnv', () => {
  it('aplica defaults quando o opcional está ausente', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.SLOT_DURATION_MINUTES).toBe(30);
    expect(env.SCHEDULE_HORIZON_DAYS).toBe(7);
  });

  it('falha quando DATABASE_URL está ausente — sem fallback para localhost', () => {
    expect(() => loadEnv({} as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('falha quando PORT não é um número válido', () => {
    expect(() =>
      loadEnv({ ...base, PORT: 'abacaxi' } as NodeJS.ProcessEnv),
    ).toThrow(/PORT/);
  });

  it('converte CORS_ORIGINS numa lista', () => {
    const env = loadEnv({
      ...base,
      CORS_ORIGINS: 'http://a.com, http://b.com',
    } as NodeJS.ProcessEnv);

    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });
});
