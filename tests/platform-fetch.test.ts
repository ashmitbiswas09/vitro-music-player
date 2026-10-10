import { describe, it, expect, vi, afterEach } from 'vitest';
import { FetchHttpClient } from '@/backend/platform';
import { isOk, isErr } from '@/backend/core';

describe('FetchHttpClient Adapter', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('performs successful GET request and parses JSON', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json', 'x-custom': 'val' }),
      json: async () => ({ results: ['song1', 'song2'] }),
      text: async () => JSON.stringify({ results: ['song1', 'song2'] }),
    });

    const client = new FetchHttpClient({ baseUrl: 'https://music.test' });
    const res = await client.get<{ results: string[] }>('/search', {
      params: { q: 'Radiohead', limit: 10 },
    });

    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.status).toBe(200);
      expect(res.value.data.results).toEqual(['song1', 'song2']);
      expect(res.value.headers['content-type']).toContain('application/json');
      expect(res.value.durationMs).toBeGreaterThanOrEqual(0);
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://music.test/search?q=Radiohead&limit=10',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('performs POST request sending JSON body and headers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'new_playlist' }),
    });

    const client = new FetchHttpClient();
    const res = await client.post<{ id: string }>('https://api.music.test/playlists', {
      title: 'Favorites',
    });

    expect(isOk(res)).toBe(true);
    if (isOk(res)) {
      expect(res.value.status).toBe(201);
      expect(res.value.data.id).toBe('new_playlist');
    }

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.music.test/playlists',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Favorites' }),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('handles HTTP error status codes gracefully as NetworkError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Track not found' }),
      text: async () => JSON.stringify({ error: 'Track not found' }),
    });

    const client = new FetchHttpClient();
    const res = await client.get('https://music.test/tracks/999');

    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.statusCode).toBe(404);
      expect(res.error.message).toContain('HTTP 404');
    }
  });

  it('catches network exceptions and abort timeouts', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const client = new FetchHttpClient();
    const res = await client.get('https://music.test/fail');

    expect(isErr(res)).toBe(true);
    if (isErr(res)) {
      expect(res.error.message).toContain('Failed to fetch');
    }
  });
});
