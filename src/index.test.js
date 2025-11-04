import test from 'node:test';
import assert from 'node:assert/strict';

import worker from './index.js';

test('GET /api/matches is handled by handleApiRequest', async () => {
  const request = new Request('https://example.com/api/matches');
  const env = {
    VOLLEYBALL_STATS_DB: {
      prepare() {
        return {
          async all() {
            return { results: [] };
          }
        };
      }
    }
  };

  const response = await worker.fetch(request, env);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, []);
});
