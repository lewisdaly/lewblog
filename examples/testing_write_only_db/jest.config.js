'use strict';
const { compilerOptions } = require('./tsconfig');
module.exports = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: true,
  collectCoverageFrom: ['./src/**/*.ts', '!./src/interface/types.ts'],
  coverageReporters: [
    'json', 
    'lcov', 
    'text',
    'cobertura'
  ],
  clearMocks: true,

  reporters: ['default'],
  testPathIgnorePatterns: [
    '/node_modules/'
  ]
};
