import test from 'node:test';
import assert from 'node:assert/strict';
import { createPassToken, hashPassToken, raceDayToken, resolveRaceDayPass } from '../src/lib/race-day-pass.ts';

test('native bearer credential takes precedence and malformed headers cannot reuse a web cookie', () => {
  const token = createPassToken();
  assert.equal(raceDayToken(new Request('https://rivali.test', { headers: { Authorization: `Bearer ${token}` } }), 'cookie'), token);
  assert.equal(raceDayToken(new Request('https://rivali.test', { headers: { Authorization: 'Bearer invalid' } }), token), undefined);
  assert.equal(raceDayToken(new Request('https://rivali.test'), token), token);
});
test('pass validation hashes credentials and rejects expired or unpaid passes', async () => {
  const token = createPassToken();
  let status = 'active'; let expiresAt = new Date(Date.now() + 60000).toISOString();
  const admin = { from(table) {
    assert.equal(table, 'race_day_passes');
    return { select() { return this; }, eq(column, value) { assert.equal(column, 'access_token_hash'); assert.equal(value, hashPassToken(token)); return this; }, async maybeSingle() { return { data: { status, expires_at: expiresAt }, error: null }; } };
  } };
  assert.ok(await resolveRaceDayPass(admin, token));
  status = 'pending_payment'; assert.equal(await resolveRaceDayPass(admin, token), null);
  status = 'active'; expiresAt = new Date(Date.now() - 1000).toISOString(); assert.equal(await resolveRaceDayPass(admin, token), null);
  assert.equal(await resolveRaceDayPass({}, undefined), null);
});
