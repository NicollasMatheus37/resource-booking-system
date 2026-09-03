module.exports = {
  displayName: 'api-integration',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
  // Subir container, migrar e disparar centenas de requisições leva tempo.
  testTimeout: 180000,
  maxWorkers: 1,
};
