import { readAppConfig } from './app-config';

describe('readAppConfig', () => {
  afterEach(() => {
    delete window.__ENV__;
  });

  it('usa o fallback de desenvolvimento quando env.js não foi carregado', () => {
    expect(readAppConfig().apiUrl).toBe('http://localhost:3000/api');
  });

  it('prefere o valor injetado em runtime', () => {
    window.__ENV__ = { apiUrl: 'https://api.exemplo.com' };

    expect(readAppConfig().apiUrl).toBe('https://api.exemplo.com');
  });
});
