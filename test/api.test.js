import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actionRequest, action } from './setup.js';

test('all once listeners run on the same emission; removing unknown listeners is harmless', async (t) => {
    const { client } = await fixture(t);
    const seen = [];
    client.on('connect', () => seen.push('on'));
    client.once('connect', () => seen.push('once-a'));
    client.once('connect', () => seen.push('once-b'));
    client.off('connect', () => {});
    client.emit('connect');
    client.emit('connect');
    assert.deepEqual(seen, ['on', 'once-a', 'once-b', 'on']);
});
test('listener exceptions are isolated from other listeners and packet ACKs', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const errors = [];
    f.client.on('error', (error) => errors.push(error));
    stream.on('message', () => {
        throw new Error('consumer failed');
    });
    let count = 0;
    stream.on('message', () => count++);
    const ack = await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(12)]
    });
    assert.deepEqual(ack, { status: true });
    assert.equal(count, 1);
    assert.equal(errors[0].message, 'consumer failed');
});
test('duplicate identity normalizes defaults/key order but preserves delivery flags', async (t) => {
    const { client } = await fixture(t);
    const [a, b] = await Promise.all([
        client.streamActions(actionRequest),
        client.streamActions({ action: 'transfer', contract: 'eosio.token', start_from: 0 })
    ]);
    assert.equal(a, b);
    const c = await client.streamActions({ ...actionRequest, ignore_live: true });
    const d = await client.streamActions({ ...actionRequest, replayOnReconnect: true });
    assert.notEqual(c, a);
    assert.notEqual(d, a);
});
test('numeric strings normalize to blocks, and legacy LIB resolves through the chain API', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    await f.client.streamActions({ ...actionRequest, start_from: '-10', read_until: '20' });
    await f.client.streamActions({ ...actionRequest, start_from: 'LIB' });
    assert.equal(f.requests[0].request.start_from, -10);
    assert.equal(f.requests[0].request.read_until, 20);
    assert.equal(f.requests[1].request.start_from, 99);
});
test('request validation rejects unsupported ranges and empty selectors', async (t) => {
    const { client } = await fixture(t);
    await assert.rejects(client.streamActions({}), /required/);
    await assert.rejects(client.streamDeltas({ code: 'eosio.token' }), /required/);
    await assert.rejects(
        client.streamActions({ ...actionRequest, start_from: 'nonsense' }),
        /ISO timestamp/
    );
});
