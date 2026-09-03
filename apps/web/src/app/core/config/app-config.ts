import { InjectionToken } from '@angular/core';

/**
 * Configuração pública do frontend, injetada em runtime pelo `env.js`
 * (12-Factor III, ADR 0010). Nunca contém segredo: tudo aqui é visível
 * no browser, exatamente como seria num bundle compilado.
 */
export interface AppConfig {
  readonly apiUrl: string;
}

declare global {
  interface Window {
    __ENV__?: Partial<AppConfig>;
  }
}

/** Usado apenas em `nx serve`, onde o container não gerou o env.js. */
const DEV_FALLBACK: AppConfig = {
  apiUrl: 'http://localhost:3000/api',
};

export function readAppConfig(): AppConfig {
  const injected = typeof window !== 'undefined' ? window.__ENV__ : undefined;

  return {
    apiUrl: injected?.apiUrl ?? DEV_FALLBACK.apiUrl,
  };
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG', {
  providedIn: 'root',
  factory: readAppConfig,
});
