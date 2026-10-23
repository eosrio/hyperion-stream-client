import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actionRequest, action, until, HyperionStreamClient } from './setup.js';

test('off removes a once message listener using the original callback', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    let calls = 0;
    const handler = () => calls++;
    stream.once('message', handler);
    stream.off('message', handler);
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(1)]
    });
    assert.equal(calls, 0);
});

test('explicit stop discards queued data and completes an existing iterator', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(1), action(2)]
    });
    const iterator = stream[Symbol.asyncIterator]();
    stream.stop();
    assert.deepEqual(await iterator.next(), { done: true, value: undefined });
});

test('stopping from a late message listener stops the cached delivery loop', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(1), action(2), action(3)]
    });
    const blocks = [];
    stream.on('message', (message) => {
        blocks.push(message.content.block_num);
        stream.stop();
    });
    assert.deepEqual(blocks, [1]);
});

test('a cancelled connection can be retried immediately without reusing the cancelled promise', async (t) => {
    const settings = { noHandshake: true };
    const f = await fixture(t, settings);
    const original = f.client.connect();
    const cancelled = assert.rejects(original, /cancelled/);
    f.client.disconnect();
    settings.noHandshake = false;
    const retry = f.client.connect();
    await cancelled;
    await retry;
    assert.equal(f.client.online, true);
    assert.equal(f.client.chainId, 'test-chain');
});

test(
    'LIB delivery after reconnect never confirms a forked record buffered on the old connection',
    { timeout: 10000 },
    async (t) => {
        const f = await fixture(t, {
            client: { libStream: true },
            resend: true,
            request({ uuid, ack }) {
                const response = { status: 'OK', reqUUID: uuid };
                if (uuid === 'request-1') ack(response);
                else setTimeout(() => ack(response), 25);
            }
        });
        await f.client.connect();
        const stream = await f.client.streamActions({ ...actionRequest, replayOnReconnect: true });
        const delivered = [];
        stream.on('message', (message) => delivered.push(message.content.block_id));
        await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            messages: [{ ...action(10), block_id: 'orphaned-fork' }]
        });
        f.sockets[0].conn.close();
        await until(() => f.requests.length === 2 && stream.reqUUID === f.requests[1].uuid);
        await f.send({
            type: 'action_trace',
            mode: 'history',
            reqUUID: stream.reqUUID,
            messages: [{ ...action(10), block_id: 'canonical-fork' }]
        });
        await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
        f.lib(10);
        await until(() => delivered.length > 0);
        assert.deepEqual(delivered, ['canonical-fork']);
        assert.equal(f.requests[1].request.start_from, 10);
    }
);

test(
    'a second disconnect before replay data arrives cannot jump past unread records',
    { timeout: 10000 },
    async (t) => {
        const f = await fixture(t, { resend: true });
        await f.client.connect();
        const stream = await f.client.streamActions({ ...actionRequest, replayOnReconnect: true });
        stream[Symbol.asyncIterator]();
        await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            messages: [action(10), action(20)]
        });
        f.sockets[0].conn.close();
        await until(() => f.requests.length === 2 && stream.reqUUID === f.requests[1].uuid);
        assert.equal(f.requests[1].request.start_from, 10);
        f.sockets[1].conn.close();
        await until(() => f.requests.length === 3);
        assert.equal(f.requests[2].request.start_from, 10);
    }
);

test('relay restoration invalidates unconfirmed records even when the client socket survives', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, replayOnReconnect: true });
    const delivered = [];
    stream.on('message', (message) => delivered.push(message.content.block_id));
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [{ ...action(10), block_id: 'old-relay-fork' }]
    });
    f.sockets[0].emit('status', 'relay_down');
    f.sockets[0].emit('status', 'relay_restored');
    await until(() => f.requests.length === 2 && stream.reqUUID === f.requests[1].uuid);
    await f.send({
        type: 'action_trace',
        mode: 'history',
        reqUUID: stream.reqUUID,
        messages: [{ ...action(10), block_id: 'new-relay-fork' }]
    });
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
    f.lib(10);
    await until(() => delivered.length > 0);
    assert.deepEqual(delivered, ['new-relay-fork']);
    assert.equal(f.requests[1].request.start_from, 10);
});

test('packets for the previous UUID cannot enter a recovering subscription', async (t) => {
    const f = await fixture(t, {
        client: { libStream: true, requestTimeout: 3000 },
        request: ({ uuid, ack }) => {
            if (uuid === 'request-1') ack({ status: 'OK', reqUUID: uuid });
        }
    });
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, replayOnReconnect: true });
    const oldUUID = stream.reqUUID;
    const delivered = [];
    stream.on('message', (message) => delivered.push(message.content.block_id));
    f.sockets[0].emit('status', 'relay_down');
    f.sockets[0].emit('status', 'relay_restored');
    await until(() => f.requests.length === 2);
    await f.send({
        type: 'action_trace',
        mode: 'live',
        targets: [oldUUID],
        messages: [{ ...action(10), block_id: 'stale-request' }]
    });
    f.lib(10);
    await until(() => f.client.lastIrreversibleBlock === 10);
    assert.deepEqual(delivered, []);
});

test('optional numeric settings explicitly set to undefined retain their defaults', () => {
    const client = new HyperionStreamClient({
        endpoint: 'http://localhost',
        connectionTimeout: undefined,
        requestTimeout: undefined,
        maxQueueSize: undefined,
        maxReversibleBufferSize: undefined
    });
    assert.equal(client.queueSize, 1000);
    assert.equal(client.requestTimeout, 10000);
    client.disconnect();
});

test('duplicate LIB updates do not count as irreversible progress', async (t) => {
    const f = await fixture(t, { client: { libMonitor: true } });
    await f.client.connect();
    for (const block of [1, 2, 3]) {
        f.lib(block);
        await until(() => f.client.lastIrreversibleBlock === block);
    }
    const offsets = [...f.client.libOffsetArray];
    f.sockets[0].emit('lib_update', { block_num: 3, chain_id: 'test-chain' });
    // A message ACK is a transport barrier for the preceding LIB update.
    await f.send({ type: 'history_end', reqUUID: 'unknown' });
    assert.deepEqual(f.client.libOffsetArray, offsets);
});

test(
    'LIB monitoring detects a stall after the very first update',
    { timeout: 10000 },
    async (t) => {
        const f = await fixture(t, { client: { libMonitor: true } });
        const errors = [];
        f.client.on('error', (error) => errors.push(error));
        await f.client.connect();
        f.lib(1);
        await until(
            () => errors.some((error) => /irreversible block stalled/.test(error.message)),
            6500
        );
    }
);

test('async observer failures are reported without rejecting packet acceptance or recursing', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const errors = [];
    f.client.on('error', (error) => errors.push(error.message));
    f.client.on('error', async () => {
        throw new Error('error observer failed');
    });
    f.client.once('data', async () => {
        throw new Error('client observer failed');
    });
    stream.once('message', async () => {
        throw new Error('stream observer failed');
    });
    assert.deepEqual(
        await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            messages: [action(1)]
        }),
        { status: true }
    );
    await until(() => errors.length === 2);
    assert.deepEqual(errors.sort(), ['client observer failed', 'stream observer failed']);
    assert.equal(stream.started, true);
});
