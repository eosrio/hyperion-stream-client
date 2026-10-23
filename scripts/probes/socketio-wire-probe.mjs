import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { Server } from 'socket.io';

// Diagnostic only: show why a native WebSocket cannot use the existing endpoint
// without also speaking Engine.IO and Socket.IO. This is not a client implementation.
const http = createServer();
const io = new Server(http, { path: '/stream', transports: ['websocket'], connectTimeout: 1000 });
let requests = 0;
io.on('connection', (socket) => {
    socket.emit('handshake', { chain_id: 'test-chain' });
    socket.on('action_stream_request', (_request, ack) => {
        requests++;
        ack({ status: 'OK', reqUUID: 'request-1' });
    });
});
await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
const origin = `ws://127.0.0.1:${http.address().port}`;
const results = [];
try {
    for (const mode of ['plain-websocket', 'engineio-with-plain-json', 'minimal-socketio']) {
        const result = { mode, opened: false, frames: [], requestsBefore: requests };
        await new Promise((resolve) => {
            const endpoint =
                mode === 'plain-websocket' ? '/stream/' : '/stream/?EIO=4&transport=websocket';
            const socket = new WebSocket(origin + endpoint);
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                socket.close();
                resolve();
            };
            const timer = setTimeout(() => {
                result.timedOut = true;
                finish();
            }, 2000);
            socket.addEventListener('open', () => {
                result.opened = true;
            });
            socket.addEventListener('error', () => {
                result.error = true;
                finish();
            });
            socket.addEventListener('close', (event) => {
                result.closeCode = event.code;
                finish();
            });
            socket.addEventListener('message', (event) => {
                const frame = String(event.data);
                result.frames.push(
                    frame.startsWith('0') ? '0{Engine.IO session and heartbeat settings}' : frame
                );
                if (frame.startsWith('0')) {
                    if (mode === 'engineio-with-plain-json')
                        socket.send(
                            JSON.stringify({
                                op: 'subscribe',
                                type: 'action',
                                contract: 'eosio.token',
                                action: 'transfer'
                            })
                        );
                    else socket.send('40');
                }
                if (frame.startsWith('42["handshake"')) {
                    socket.send(
                        '427' +
                            JSON.stringify([
                                'action_stream_request',
                                { contract: 'eosio.token', action: 'transfer' }
                            ])
                    );
                }
                if (frame.startsWith('437')) {
                    result.ack = JSON.parse(frame.slice(3))[0];
                    finish();
                }
            });
        });
        result.requestsAfter = requests;
        results.push(result);
    }
    assert.equal(results[0].opened, false);
    assert.equal(results[0].error, true);
    assert.equal(results[1].opened, true);
    assert.equal(results[1].requestsAfter, results[1].requestsBefore);
    assert.ok(!results[1].timedOut);
    assert.deepEqual(results[2].ack, { status: 'OK', reqUUID: 'request-1' });
    assert.equal(requests, 1);
    console.log(JSON.stringify({ runtime: process.version, socketIO: '4.8.4', results }, null, 2));
} finally {
    await new Promise((resolve) => io.close(resolve));
}
