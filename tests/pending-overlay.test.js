// Saves made offline stay on screen. These tests pin down the small rules of
// the overlay one by one: bad entries, the waiting-to-sync mark, replacing or
// adding a record, and keeping its own copy of what was saved. The random
// replay in offline-model.test.js covers the big picture. Runs offline with
// Node's built-in test runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// The overlay keeps its queue in a module variable, so each test loads a
// fresh copy to start from an empty queue.
let n = 0;
const fresh = () => import(`../js/pending-overlay.js?edge=${++n}`);
const set = (docId, payload, extra = {}) => ({ op: 'set', collection: 'c', docId, payload, ...extra });

test('overlay: nothing is waiting until a save is noted', async () => {
  const o = await fresh();
  assert.equal(o.hasPending(), false);
  o.notePending([]);
  o.notePending(undefined);
  assert.equal(o.hasPending(), false);
  o.notePending([set('a', { x: 1 })]);
  assert.equal(o.hasPending(), true);
});

test('overlay: a deleted record also counts as waiting', async () => {
  const o = await fresh();
  o.notePending([{ op: 'delete', collection: 'c', docId: 'a' }]);
  assert.equal(o.hasPending(), true);
});

test('overlay: entries with no collection or no record id are ignored', async () => {
  const o = await fresh();
  o.notePending([{ op: 'set', docId: 'a', payload: { x: 1 } }]);
  assert.equal(o.hasPending(), false);
  o.notePending([{ op: 'set', collection: 'c', payload: { x: 1 } }]);
  assert.equal(o.hasPending(), false);
  assert.deepEqual(o.withPending('c', []), []);
  o.notePending([set('ok', { x: 1 })]);
  assert.deepEqual(o.withPending('c', []), [{ x: 1, id: 'ok', _pkSyncPending: true }]);
});

test('overlay: a collection with nothing waiting is shown as the database sent it', async () => {
  const o = await fresh();
  const docs = [{ id: 'a' }];
  assert.equal(o.withPending('c', docs), docs);
  o.notePending([set('a', { x: 1 })]);
  assert.equal(o.withPending('other', docs), docs);
});

test('overlay: a new record is added and a record the database has is replaced, once', async () => {
  const o = await fresh();
  o.notePending([set('a', { qty: 9 }), set('b', { qty: 2 })]);
  const out = o.withPending('c', [{ id: 'a', qty: 1, name: 'old' }, { id: 'z', qty: 5 }]);
  assert.deepEqual(out, [
    { qty: 9, id: 'a', _pkSyncPending: true },
    { id: 'z', qty: 5 },
    { qty: 2, id: 'b', _pkSyncPending: true },
  ]);
});

test('overlay: a record keeps its own id if the saved data has one', async () => {
  const o = await fresh();
  o.notePending([set('a', { id: 'custom', x: 1 })]);
  assert.equal(o.withPending('c', [])[0].id, 'custom');
});

test('overlay: a merge changes only the fields saved, and is marked as waiting', async () => {
  const o = await fresh();
  o.notePending([set('a', { qty: 9 }, { options: { merge: true } })]);
  const out = o.withPending('c', [{ id: 'a', qty: 1, name: 'keep' }, { id: 'b', qty: 3 }]);
  assert.deepEqual(out, [{ id: 'a', qty: 9, name: 'keep', _pkSyncPending: true }, { id: 'b', qty: 3 }]);
});

test('overlay: a merge for a record the database does not have shows nothing yet', async () => {
  const o = await fresh();
  o.notePending([set('a', { qty: 9 }, { options: { merge: true } })]);
  assert.deepEqual(o.withPending('c', []), []);
});

test('overlay: two merges in a row add up, and a merge after a save keeps both', async () => {
  const o = await fresh();
  o.notePending([
    set('a', { qty: 1 }, { options: { merge: true } }),
    set('a', { price: 5 }, { options: { merge: true } }),
  ]);
  assert.deepEqual(o.withPending('c', [{ id: 'a', qty: 0, name: 'n' }]),
    [{ id: 'a', qty: 1, name: 'n', price: 5, _pkSyncPending: true }]);
  const p = await fresh();
  p.notePending([set('a', { qty: 1, name: 'first' }), set('a', { qty: 7 }, { options: { merge: true } })]);
  assert.deepEqual(p.withPending('c', []), [{ qty: 7, name: 'first', id: 'a', _pkSyncPending: true }]);
});

test('overlay: a delete hides the record, and a save after a delete brings it back', async () => {
  const o = await fresh();
  o.notePending([{ op: 'delete', collection: 'c', docId: 'a' }]);
  assert.deepEqual(o.withPending('c', [{ id: 'a' }, { id: 'b' }]), [{ id: 'b' }]);
  o.notePending([set('a', { qty: 3 })]);
  assert.deepEqual(o.withPending('c', [{ id: 'b' }]), [{ id: 'b' }, { qty: 3, id: 'a', _pkSyncPending: true }]);
});

test('overlay: the list the database sent is never changed', async () => {
  const o = await fresh();
  o.notePending([set('a', { qty: 9 }), set('n', { qty: 1 })]);
  const docs = [{ id: 'a', qty: 1 }];
  o.withPending('c', docs);
  assert.deepEqual(docs, [{ id: 'a', qty: 1 }]);
});

test('overlay: a saved record is kept as it was when saved, even if the caller changes it later', async () => {
  const o = await fresh();
  const payload = { qty: 4 };
  o.notePending([set('a', payload)]);
  payload.qty = 99;
  assert.equal(o.withPending('c', [])[0].qty, 4);
});

test('overlay: a save with no data shows an empty record', async () => {
  const o = await fresh();
  o.notePending([{ op: 'set', collection: 'c', docId: 'a' }]);
  assert.deepEqual(o.withPending('c', []), [{ id: 'a', _pkSyncPending: true }]);
});

test('overlay: with no list from the database, the waiting saves are still shown', async () => {
  const o = await fresh();
  o.notePending([set('a', { qty: 3 })]);
  assert.deepEqual(o.withPending('c', undefined), [{ qty: 3, id: 'a', _pkSyncPending: true }]);
});
