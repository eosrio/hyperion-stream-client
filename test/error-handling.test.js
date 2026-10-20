import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, actionRequest, action, until } from './setup.js';

test('a server which never acknowledges a request cannot hang the caller', async (t) => {
    const f = await fixture(t, { request: () => {}, client: { requestTimeout: 40 } });
    await f.client.connect();
    await assert.rejects(f.client.streamActions(actionRequest), /request timed out/);
    assert.equal(f.client.streams.length, 0);
    assert.equal(f.client.streamMap.size, 0);
});
test('server rejection is an Error and removes failed registration', async (t) => {
    const f = await fixture(t, {
        request: ({ ack }) => ack({ status: 'ERROR', message: 'unsupported filter' })
    });
    await f.client.connect();
    await assert.rejects(f.client.streamActions(actionRequest), /unsupported filter/);
    assert.equal(f.client.streams.length, 0);
});
test('server history failures reject waiting iterators instead of pretending to finish', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions({ ...actionRequest, start_from: 1 });
    const iterator = stream[Symbol.asyncIterator]();
    const rejected = assert.rejects(iterator.next(), /stream_scroll_limit/);
    const ack = await f.send({
        type: 'action_trace',
        mode: 'history',
        reqUUID: stream.reqUUID,
        error: 'stream_scroll_limit',
        messages: []
    });
    assert.equal(ack.status, false);
    await rejected;
});
test('malformed binary records fail the subscription and NACK the packet', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const ack = await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        message: Buffer.from('{')
    });
    assert.equal(ack.status, false);
    await assert.rejects(stream[Symbol.asyncIterator]().next(), SyntaxError);
});
test('slow active iterators fail explicitly on overflow without silently dropping data', async (t) => {
    const f = await fixture(t, { client: { maxQueueSize: 2 } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    const iterator = stream[Symbol.asyncIterator]();
    const ack = await f.send({
        type: 'action_trace',
        mode: 'live',
        reqUUID: stream.reqUUID,
        messages: [action(1), action(2), action(3)]
    });
    assert.equal(ack.status, false);
    await assert.rejects(iterator.next(), /queue exceeded/);
    assert.equal(f.client.streams.length, 0);
});
test('unobserved queues also fail on overflow before an iterator attaches', async (t) => {
    const f = await fixture(t, { client: { maxQueueSize: 1 } });
    await f.client.connect();
    const stream = await f.client.streamActions(actionRequest);
    assert.equal(
        (
            await f.send({
                type: 'action_trace',
                mode: 'live',
                reqUUID: stream.reqUUID,
                messages: [action(1), action(2)]
            })
        ).status,
        false
    );
    await assert.rejects(stream[Symbol.asyncIterator]().next(), /queue exceeded/);
});
test('stop, iterator return, and disconnect wake pending reads and remove streams', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    for (const method of ['stop', 'return', 'disconnect']) {
        const stream = await f.client.streamActions(actionRequest);
        const iterator = stream[Symbol.asyncIterator]();
        const reading = iterator.next();
        if (method === 'stop') stream.stop();
        else if (method === 'return') await iterator.return();
        else f.client.disconnect();
        assert.equal((await reading).done, true);
        assert.equal(f.client.streams.length, 0);
    }
});
test('queued offline streams can be stopped without UUIDs or a server', async (t) => {
    const f = await fixture(t);
    const stream = await f.client.streamActions(actionRequest);
    stream.stop();
    await f.client.connect();
    assert.equal(f.requests.length, 0);
    assert.equal(f.client.streamMap.size, 0);
});
test('late cancellation cannot remove a different stream', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const a = await f.client.streamActions(actionRequest);
    const b = await f.client.streamActions({ ...actionRequest, account: 'bob' });
    a.stop();
    a.stop();
    f.client.stop('unknown');
    await until(() => f.cancellations.length === 1);
    assert.deepEqual(f.client.streams, [b]);
});
test('successful ACKs after timeout are remotely cancelled', async (t) => {
    let reply;
    let uuid;
    const f = await fixture(t, {
        client: { requestTimeout: 40 },
        request: (request) => {
            reply = request.ack;
            uuid = request.uuid;
        }
    });
    await f.client.connect();
    await assert.rejects(f.client.streamActions(actionRequest), /timed out/);
    reply({ status: 'OK', reqUUID: uuid });
    await until(() => f.cancellations.includes(uuid));
});
test('untracked historical packets are NACKed to stop abandoned scrolls', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    const ack = await f.send({
        type: 'action_trace',
        mode: 'history',
        reqUUID: 'unknown',
        messages: [action(1)]
    });
    assert.equal(ack.status, false);
});
