import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { HyperionStreamClient } from '../lib/esm/index.js';

export const actionRequest = { contract: 'eosio.token', action: 'transfer' };
export const action = (block, sequence = block) => ({
    block_num: block,
    global_sequence: String(sequence),
    act: { account: 'eosio.token', name: 'transfer', data: { from: 'alice', to: 'bob' } }
});
export const delta = (block, key = '1') => ({
    block_num: block,
    code: 'eosio.token',
    table: 'accounts',
    scope: 'alice',
    primary_key: key,
    data: { balance: '1.0000 EOS' }
});

export async function until(predicate, timeout = 4000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('Fixture condition timed out');
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

/** Real loopback Socket.IO transport, matching the server's /stream protocol. */
export async function fixture(t, options = {}) {
    const http = createServer((request, response) => {
        if (request.url === '/v1/chain/get_info') {
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ last_irreversible_block_num: 99 }));
        } else if (options.http) options.http(request, response);
        else {
            response.statusCode = 404;
            response.end();
        }
    });
    const io = new Server(http, { path: '/stream', transports: ['websocket'] });
    const state = { io, sockets: [], requests: [], cancellations: [] };
    io.on('connection', (socket) => {
        state.sockets.push(socket);
        if (!options.noHandshake)
            socket.emit('handshake', { chain_id: options.chainId ?? 'test-chain' });
        socket.on('reconnect', () => {
            if (options.resend) socket.emit('resend_requests', { last_id: 'previous' });
        });
        for (const type of ['action', 'delta'])
            socket.on(`${type}_stream_request`, (request, ack) => {
                const uuid = `request-${state.requests.length + 1}`;
                state.requests.push({ type, request, uuid, socket });
                if (options.request) options.request({ type, request, uuid, socket, ack });
                else ack({ status: 'OK', reqUUID: uuid });
            });
        socket.on('cancel_stream_request', (request, ack) => {
            state.cancellations.push(request.reqUUID);
            ack({ status: 'OK' });
        });
    });
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    state.endpoint = `http://127.0.0.1:${http.address().port}`;
    state.client = new HyperionStreamClient({
        endpoint: state.endpoint,
        requestTimeout: 300,
        ...options.client
    });
    t.after(async () => {
        state.client.disconnect();
        await new Promise((resolve) => io.close(resolve));
    });
    state.send = (packet) => state.sockets.at(-1).timeout(1000).emitWithAck('message', packet);
    state.lib = (block) =>
        state.sockets.at(-1).emit('lib_update', {
            block_num: block,
            chain_id: 'test-chain',
            block_id: `block-${block}`
        });
    return state;
}
