import { describe, it, expect, vi } from 'vitest';
import { loadProfile, type ConventionProfile } from '../src/profile.js';

const nathan: ConventionProfile = {
  name: 'nathan',
  route: () => ({ project: 'DEV' }),
};

describe('loadProfile', () => {
  it('spec absent → null (aucun profil)', async () => {
    expect(await loadProfile(undefined)).toBeNull();
  });

  it('import qui échoue → null, jamais d’exception', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importer = () => Promise.reject(new Error('MODULE_NOT_FOUND'));
    await expect(loadProfile('introuvable', importer)).resolves.toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('module exportant `profile` → renvoie le profil', async () => {
    const importer = () => Promise.resolve({ profile: nathan });
    expect(await loadProfile('x', importer)).toBe(nathan);
  });

  it('module exportant `default` → renvoie le profil', async () => {
    const importer = () => Promise.resolve({ default: nathan });
    expect(await loadProfile('x', importer)).toBe(nathan);
  });

  it('le module EST le profil (export nommé name) → renvoie le module', async () => {
    const importer = () => Promise.resolve(nathan);
    expect(await loadProfile('x', importer)).toBe(nathan);
  });

  it('export sans champ name → null (invalide)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const importer = () => Promise.resolve({ foo: 1 });
    expect(await loadProfile('x', importer)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
