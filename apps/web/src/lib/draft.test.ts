// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDraft, emptyDraft, loadDraft, saveDraft } from './draft.js';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the Find draft', () => {
  it('is empty when nothing was saved', () => {
    expect(loadDraft()).toEqual(emptyDraft);
  });

  it('comes back as it was saved, and is gone after clear', () => {
    const draft = {
      query: 'javitri',
      wantsDelivery: true,
      address: '12 MG Road',
      lat: '1',
      lng: '2',
    };
    saveDraft(draft);
    expect(loadDraft()).toEqual(draft);
    clearDraft();
    expect(loadDraft()).toEqual(emptyDraft);
  });

  it('survives junk and blocked storage', () => {
    sessionStorage.setItem('km-find-draft', '{nope');
    expect(loadDraft()).toEqual(emptyDraft);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => saveDraft(emptyDraft)).not.toThrow();
  });
});
