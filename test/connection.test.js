import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HyperionStreamClient, fixture, until, actionRequest, action } from './setup.js';

test('concurrent connect calls share a socket and await the chain handshake', async (t) => {
    const f = await fixture(t);
    await Promise.all([f.client.connect(), f.client.connect()]);
    await f.client.connect();
    assert.equal(f.sockets.length, 1);
    assert.equal(f.client.chainId, 'test-chain');
    assert.equal(f.client.online, true);
});
test('missing handshake rejects with an observable bounded error (#13)', async (t) => {
    const f = await fixture(t, { noHandshake: true, client: { connectionTimeout: 60 } });
    const errors = [];
    f.client.on('error', (error) => errors.push(error));
    await assert.rejects(f.client.connect(), /handshake timed out/);
    assert.equal(f.client.online, false);
    assert.equal(errors.length, 1);
});
test('disconnect cancels a pending connection', async (t) => {
    const f = await fixture(t, { noHandshake: true });
    const connecting = f.client.connect();
    f.client.disconnect();
    await assert.rejects(connecting, /cancelled/);
});
test('endpoint URL validation and /stream suffix normalization', async (t) => {
    assert.throws(() => new HyperionStreamClient({ endpoint: '' }), /endpoint/);
    assert.throws(() => new HyperionStreamClient({ endpoint: 'ftp://localhost' }), /protocol/);
    const f = await fixture(t);
    f.client.setEndpoint(`${f.endpoint}/stream/`);
    await f.client.connect();
    assert.throws(() => f.client.setEndpoint(f.endpoint), /Disconnect/);
});
test(
    'reconnect replays the partially received block once, without mutating the caller',
    { timeout: 10000 },
    async (t) => {
        const f = await fixture(t, { resend: true });
        await f.client.connect();
        const request = { ...actionRequest, start_from: 100, replayOnReconnect: true };
        const stream = await f.client.streamActions(request);
        await f.send({
            type: 'action_trace',
            mode: 'history',
            reqUUID: stream.reqUUID,
            messages: [action(120, 1)]
        });
        f.sockets[0].conn.close();
        await until(() => f.requests.length === 2);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(f.requests.length, 2);
        assert.equal(f.requests[1].request.start_from, 120);
        assert.equal(request.start_from, 100);
        assert.equal(f.client.streamMapByUUID.size, 1);
    }
);
test('relay restoration rebuilds subscriptions on the existing socket', async (t) => {
    const f = await fixture(t);
    await f.client.connect();
    await f.client.streamActions(actionRequest);
    f.sockets[0].emit('status', 'relay_down');
    f.sockets[0].emit('status', 'relay_restored');
    await until(() => f.requests.length === 2);
    assert.equal(f.sockets.length, 1);
    assert.equal(f.client.streamMapByUUID.size, 1);
});
test(
    'disconnect during setup rejects promptly and permits a new registration after reconnect',
    { timeout: 10000 },
    async (t) => {
        let first = true;
        const f = await fixture(t, {
            request: ({ socket, ack, uuid }) => {
                if (first) {
                    first = false;
                    socket.conn.close();
                } else ack({ status: 'OK', reqUUID: uuid });
            }
        });
        await f.client.connect();
        await assert.rejects(f.client.streamActions(actionRequest), /interrupted by disconnect/);
        await until(() => f.sockets.length === 2 && f.client.online);
        const stream = await f.client.streamActions(actionRequest);
        assert.equal(stream.started, true);
    }
);
test('reconnect handshakes have their own deadline', { timeout: 10000 }, async (t) => {
    const settings = { client: { connectionTimeout: 80 } };
    const f = await fixture(t, settings);
    const errors = [];
    f.client.on('error', (error) => errors.push(error));
    await f.client.connect();
    settings.noHandshake = true;
    f.sockets[0].conn.close();
    await until(() => errors.some((error) => /Reconnect handshake timed out/.test(error.message)));
    assert.equal(f.client.online, false);
});
