'use strict';
const { compilerOptions } = require('./tsconfig');
module.exports = {
  verbose: true,
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverage: false,
  clearMocks: true,
  reporters: ['default'],
  testPathIgnorePatterns: [
    '/node_modules/'
  ]
};
