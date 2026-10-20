import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actionRequest, action, delta, until, HyperionStreamClient } from './setup.js';

test('invalid initial and replacement handshakes reject or terminate the session', async (t) => {
    const invalid = await fixture(t, { chainId: '' });
    await assert.rejects(invalid.client.connect(), /Invalid server handshake/);
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const reading = stream[Symbol.asyncIterator]().next();
    const errors = [];
    f.client.on('error', (error) => errors.push(error));
    f.sockets[0].emit('handshake', { chain_id: '' });
    assert.equal((await reading).done, true);
    assert.equal(f.client.online, false);
    assert.match(errors[0].message, /Invalid server handshake/);
});

test(
    'a changed chain during reconnect cannot reuse existing subscriptions',
    { timeout: 10000 },
    async (t) => {
        const settings = {};
        const f = await fixture(t, settings);
        const errors = [];
        f.client.on('error', (error) => errors.push(error));
        await f.client.connect();
        await f.client.streamActions({ ...actionRequest, replayOnReconnect: true });
        settings.chainId = 'different-chain';
        f.sockets[0].conn.close();
        await until(() => errors.some((error) => /chain ID changed/.test(error.message)));
        assert.equal(f.client.online, false);
        assert.equal(f.client.streams.length, 0);
        assert.equal(f.requests.length, 1);
    }
);

test('a server connection rejection is observable and permits immediate retry from its error observer', async (t) => {
    const f = await fixture(t);
    let refuse = true;
    f.io.use((_socket, next) => next(refuse ? new Error('access denied') : undefined));
    let retry;
    f.client.once('error', () => {
        refuse = false;
        retry = f.client.connect();
    });
    await assert.rejects(f.client.connect(), /access denied/);
    await retry;
    assert.equal(f.client.online, true);
});

test('interrupted LIB streams without replay fail explicitly instead of confirming old data', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const iterator = stream[Symbol.asyncIterator]();
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(10)]
    });
    const reading = assert.rejects(
        iterator.next(),
        (error) => error.code === 'STREAM_REPLAY_REQUIRED' && error.retryable === true
    );
    f.sockets[0].emit('status', 'relay_down');
    await reading;
    assert.equal(f.client.streams.length, 0);
    assert.equal(f.client.hasBufferedData(stream), false);
});

test('LIB mismatch, regressing and malformed updates cannot release buffered data', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const errors = [];
    f.client.on('error', (error) => errors.push(error.message));
    f.lib(5);
    await until(() => f.client.lastIrreversibleBlock === 5);
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(10)]
    });
    for (const update of [
        { block_num: 10, chain_id: 'different-chain' },
        { block_num: 4 },
        { block_num: 1.5 },
        null
    ])
        f.sockets[0].emit('lib_update', update);
    await f.send({ type: 'history_end', reqUUID: 'unknown' });
    assert.deepEqual(errors, ['LIB chain ID mismatch']);
    assert.equal(f.client.lastIrreversibleBlock, 5);
    assert.equal(stream.deliveryCounter, 0);
    f.lib(10);
    const message = (await stream[Symbol.asyncIterator]().next()).value;
    assert.equal(message.irreversible, true);
});

test('reversible-buffer overflow and confirmed iterator overflow terminate cleanly', async (t) => {
    for (const client of [
        { libStream: true, maxReversibleBufferSize: 1 },
        { libStream: true, maxQueueSize: 1 }
    ]) {
        const f = await fixture(t, { client });
        await f.client.connect();
        const stream = await f.client.streamActions(actionRequest);
        const iterator = stream[Symbol.asyncIterator]();
        const ack = await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            messages: [action(10), action(11)]
        });
        if (client.maxQueueSize) {
            assert.equal(ack.status, true);
            f.lib(11);
            await until(() => !stream.started);
        } else assert.equal(ack.status, false);
        await assert.rejects(iterator.next(), /overflow|queue exceeded/);
        assert.equal(f.client.hasBufferedData(stream), false);
    }
});

test('metadata hydrates empty action data and dotted delta data without mutating the source', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const a = await f.client.streamActions(actionRequest);
    const d = await f.client.streamDeltas({ code: 'eosio.token', table: 'accounts' });
    const trace = {
        ...action(1),
        act: { name: 'transfer' },
        '@transfer': { amount: '1.0000 EOS' }
    };
    const row = { ...delta(1), data: undefined, '@accounts.data': { balance: '2.0000 EOS' } };
    await f.send({ type: 'action_trace', mode: 'live', reqUUID: a.reqUUID, messages: [trace] });
    await f.send({ type: 'delta_trace', mode: 'live', reqUUID: d.reqUUID, messages: [row] });
    assert.deepEqual((await a[Symbol.asyncIterator]().next()).value.content.act.data, {
        amount: '1.0000 EOS'
    });
    assert.deepEqual((await d[Symbol.asyncIterator]().next()).value.content.data, {
        balance: '2.0000 EOS'
    });
    assert.equal(trace.act.data, undefined);
    assert.ok(row['@accounts.data']);
});

test('iterator throw rejects the pending read and releases remote registration', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const iterator = stream[Symbol.asyncIterator]();
    const rejected = assert.rejects(iterator.next(), /consumer abort/);
    await assert.rejects(iterator.throw('consumer abort'), /consumer abort/);
    await rejected;
    await until(() => f.cancellations.includes(stream.reqUUID));
    assert.equal(f.client.streams.length, 0);
});

test('queue limits apply to buffered history-to-live data and can be configured per subscription', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, start_from: 1 });
    for (const size of [0, -1, 1.5, Infinity])
        assert.throws(() => stream.setMaxQueueSize(size), RangeError);
    assert.equal(stream.setMaxQueueSize(1), stream);
    const ack = await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(2), action(3)]
    });
    assert.equal(ack.status, false);
    await assert.rejects(stream[Symbol.asyncIterator]().next(), /History-to-live queue overflow/);
});

test('malformed packets and records fail deterministically and once listeners validate callbacks', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    assert.equal((await f.send(null)).status, false);
    assert.throws(() => f.client.on('connect', null), TypeError);
    assert.throws(() => f.client.once('connect', null), TypeError);
    for (const packet of [
        { type: 'error' },
        { type: 'action_trace', messages: [{ block_num: -1 }] },
        { type: 'action_trace', message: null }
    ]) {
        const stream = await f.client.streamActions(actionRequest);
        assert.throws(() => stream.on('message', null), TypeError);
        assert.throws(() => stream.once('message', null), TypeError);
        assert.equal(
            (await f.send({ ...packet, mode: 'live', reqUUID: stream.reqUUID })).status,
            false
        );
        let failure;
        stream.once('error', (error) => {
            failure = error;
        });
        assert.ok(failure instanceof Error);
    }
    assert.throws(() => new HyperionStreamClient(null), TypeError);
    for (const endpoint of [
        'http://user:password@localhost',
        'http://localhost?query=1',
        'http://localhost#fragment'
    ])
        assert.throws(
            () => new HyperionStreamClient({ endpoint }),
            /credentials, query or fragment/
        );
    for (const key of [
        'connectionTimeout',
        'requestTimeout',
        'maxQueueSize',
        'maxReversibleBufferSize'
    ])
        assert.throws(
            () => new HyperionStreamClient({ endpoint: 'http://localhost', [key]: 0 }),
            RangeError
        );
});
