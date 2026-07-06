// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import * as core from '../src/index.js';

describe('barrel index.ts — sans mécanisme nid', () => {
  it('exporte les use-cases attendus', () => {
    expect(typeof core.refreshTaches).toBe('function');
    expect(typeof core.JiraClient).toBe('function');
    expect(typeof core.checkChanges).toBe('function');
    expect(typeof core.dryRun).toBe('function');
    expect(typeof core.applyChanges).toBe('function');
    expect(typeof core.indexSnapshot).toBe('function');
    expect(typeof core.fetchFullSnapshot).toBe('function');
  });

  it('n\'exporte plus nidOf', () => {
    expect('nidOf' in core).toBe(false);
  });
});
