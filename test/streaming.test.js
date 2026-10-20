import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actionRequest, action, delta, until } from './setup.js';

test('4.5 uint64 strings remain exact through history and binary live delivery', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, start_from: 1 });
    const seen = [];
    stream.on('message', (message) => seen.push(message.content));
    const values = [
        '9007199254740991',
        '9007199254740992',
        '9007199254740993',
        '9223372036854775808',
        '18446744073709551615'
    ];
    for (const sequence of values) {
        const record = {
            ...action(1, sequence),
            receipts: [
                {
                    receiver: 'alice',
                    global_sequence: sequence,
                    recv_sequence: sequence,
                    auth_sequence: [{ account: 'alice', sequence }]
                }
            ]
        };
        await f.send({
            type: 'action_trace',
            mode: 'history',
            reqUUID: stream.reqUUID,
            messages: [record]
        });
        await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            message: Buffer.from(JSON.stringify(record))
        });
    }
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
    assert.deepEqual(
        seen.map((record) => record.global_sequence),
        [...values, ...values]
    );
    for (const record of seen) {
        assert.equal(record.receipts[0].recv_sequence, record.global_sequence);
        assert.equal(record.receipts[0].auth_sequence[0].sequence, record.global_sequence);
    }
});

test('history ACKs progress before consumers attach, including multiple batches (#14)', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({
        ...actionRequest,
        start_from: 1,
        ignore_live: true
    });
    for (const start of [1, 21]) {
        const ack = await f.send({
            type: 'action_trace',
            mode: 'history',
            reqUUID: stream.reqUUID,
            messages: Array.from({ length: 20 }, (_, i) => action(start + i))
        });
        assert.deepEqual(ack, { status: true });
    }
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID, mode: 'history' });
    const result = [];
    for await (const message of stream) result.push(message.content.block_num);
    assert.equal(result.length, 40);
    assert.deepEqual([result[0], result.at(-1)], [1, 40]);
    assert.equal(f.client.streams.length, 0);
});
test('live binary packets wait behind history and then continue into live', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, start_from: 1 });
    await f.send({
        type: 'action_trace',
        mode: 'live',
        targets: [stream.reqUUID],
        message: Buffer.from(JSON.stringify(action(3)))
    });
    await f.send({
        type: 'action_trace',
        mode: 'history',
        reqUUID: stream.reqUUID,
        messages: [action(1), action(2)]
    });
    assert.equal(stream.lastReceivedBlockNum, 2);
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
    const iterator = stream[Symbol.asyncIterator]();
    const result = [];
    for (let i = 0; i < 3; i++) result.push((await iterator.next()).value.content.block_num);
    assert.deepEqual(result, [1, 2, 3]);
    assert.equal(stream.live, true);
    await iterator.return();
});
test('history-only empty streams complete even when iteration starts after history_end', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({
        ...actionRequest,
        start_from: 1,
        ignore_live: true
    });
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
    assert.deepEqual(await stream[Symbol.asyncIterator]().next(), { done: true, value: undefined });
});
test('delta messages, metadata, and broadcast targets remain independent', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const a = await f.client.streamDeltas({ code: 'eosio.token', table: 'accounts' });
    const b = await f.client.streamDeltas({ code: 'eosio.token', table: 'accounts', scope: 'bob' });
    const record = { ...delta(12), '@accounts': { extra: 42 } };
    const ack = await f.send({
        type: 'delta_trace',
        mode: 'live',
        targets: [a.reqUUID, b.reqUUID, a.reqUUID],
        messages: [record]
    });
    assert.deepEqual(ack, { status: true });
    const first = (await a[Symbol.asyncIterator]().next()).value;
    const second = (await b[Symbol.asyncIterator]().next()).value;
    assert.equal(first.content.data.extra, 42);
    assert.equal(second.content.data.extra, 42);
    assert.notEqual(first.content, second.content);
    assert.equal(a.deliveryCounter, 1);
});
test('libStream waits for LIB, removes forked records, and marks confirmed data', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const delivered = [];
    stream.on('message', (message) => delivered.push(message));
    for (const block of [10, 11])
        await f.send({
            type: 'action_trace',
            mode: 'live',
            reqUUID: stream.reqUUID,
            messages: [action(block)]
        });
    assert.equal(delivered.length, 0);
    f.sockets[0].emit('fork_event', { starting_block: 11 });
    f.lib(11);
    await until(() => delivered.length === 1);
    assert.equal(delivered[0].content.block_num, 10);
    assert.equal(delivered[0].irreversible, true);
    assert.equal(f.client.lastIrreversibleBlock, 11);
});
test('irreversible history-only completion waits for confirmation', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions({
        ...actionRequest,
        start_from: 1,
        ignore_live: true
    });
    await f.send({
        type: 'action_trace',
        mode: 'history',
        reqUUID: stream.reqUUID,
        messages: [action(10)]
    });
    await f.send({ type: 'history_end', reqUUID: stream.reqUUID });
    f.lib(10);
    const result = [];
    for await (const message of stream) result.push(message);
    assert.equal(result.length, 1);
    assert.equal(result[0].irreversible, true);
});
test('event consumers receive history delivered in the subscription ACK frame', async (t) => {
    const f = await fixture(t, {
        request: ({ socket, ack, uuid }) => {
            ack({ status: 'OK', reqUUID: uuid });
            socket.emit('message', {
                type: 'action_trace',
                mode: 'history',
                reqUUID: uuid,
                messages: [action(1), action(2), action(3)]
            });
        }
    });
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, start_from: 1 });
    const seen = [];
    stream.on('message', (message) => seen.push(message.content.block_num));
    await until(() => seen.length === 3);
    assert.deepEqual(seen, [1, 2, 3]);
});
test('stopping from inside a LIB handler cannot resurrect buffered records', async (t) => {
    const f = await fixture(t, { client: { libStream: true } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    stream.on('message', () => stream.stop());
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(10), action(20)]
    });
    f.lib(10);
    await until(() => f.client.streams.length === 0);
    assert.equal(f.client.hasBufferedData(stream), false);
});
test('completion events remain observable after an immediate history_end', async (t) => {
    const f = await fixture(t, {
        request: ({ socket, ack, uuid }) => {
            ack({ status: 'OK', reqUUID: uuid });
            socket.emit('message', { type: 'history_end', reqUUID: uuid });
        }
    });
    await f.client.connect();
    const stream = await f.client.streamActions({
        ...actionRequest,
        start_from: 1,
        ignore_live: true
    });
    let ends = 0;
    let historyEnds = 0;
    stream.once('end', () => ends++);
    stream.once('historyEnd', () => historyEnds++);
    await until(() => ends === 1 && historyEnds === 1);
    assert.equal(f.client.streams.length, 0);
});
test('stop during a mixed confirmed/reversible batch cannot buffer abandoned records', async (t) => {
    const f = await fixture(t, { client: { libStream: true, maxReversibleBufferSize: 1 } });
    await f.client.connect();
    f.lib(10);
    await until(() => f.client.lastIrreversibleBlock === 10);
    const stream = await f.client.streamActions(actionRequest);
    stream.on('message', () => stream.stop());
    await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(10), action(20)]
    });
    assert.equal(f.client.hasBufferedData(stream), false);
    const next = await f.client.streamActions(actionRequest);
    assert.equal(
        (
            await f.send({
                type: 'action_trace',
                mode: 'live',
                reqUUID: next.reqUUID,
                messages: [action(21)]
            })
        ).status,
        true
    );
});
