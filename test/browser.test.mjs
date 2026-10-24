import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixture, until, action } from './setup.js';

for (const format of ['esm', 'umd'])
    for (const scenario of ['history', 'errors', 'binary'])
        test(`Chromium ${format}: ${scenario}`, { timeout: 20000 }, async (t) => {
            const browser = await chromium.launch({ headless: true, timeout: 10000 });
            // Close browser connections before waiting for the HTTP/Socket.IO fixture to close.
            t.after(() => browser.close());
            const f = await fixture(t, {
                http(request, response) {
                    if (request.url === '/') {
                        response.setHeader('content-type', 'text/html');
                        const loader =
                            format === 'umd'
                                ? '<script src="/dist/hyperion-stream-client.js"></script>'
                                : '<script type="importmap">{"imports":{"socket.io-client":"/socket.io.esm.min.js"}}</script>';
                        response.end(`<!doctype html>${loader}<script type="module">
                    ${format === 'esm' ? "import {HyperionStreamClient} from '/lib/esm/index.js';" : ''}
                    try {
                        const client = new HyperionStreamClient({endpoint:location.origin});
                        window.disconnect=()=>client.disconnect();
                        await client.connect();
                        ${
                            scenario === 'history'
                                ? `
                        const stream = await client.streamActions({contract:'eosio.token',action:'transfer',start_from:1,ignore_live:true});
                        const blocks=[]; for await(const message of stream) blocks.push(message.content.block_num);
                        window.result={chain:client.chainId,blocks}; client.disconnect();
                        `
                                : scenario === 'errors'
                                  ? `
                        let failure;
                        try {await client.streamActions({contract:'reject',action:'transfer'});} catch(error) {failure=error;}
                        if(!failure) throw new Error('Expected setup rejection');
                        const stream=await client.streamActions({contract:'eosio.token',action:'transfer'});
                        let malformed=false;
                        try {await stream[Symbol.asyncIterator]().next();} catch(error) {malformed=error instanceof SyntaxError;}
                        window.result={status:failure.statusCode,retryable:failure.retryable,code:failure.code,malformed};
                        client.disconnect();
                        `
                                  : `
                        const stream=await client.streamActions({contract:'eosio.token',action:'transfer'});
                        const iterator=stream[Symbol.asyncIterator]();
                        const {value}=await iterator.next();
                        const {done}=await iterator.return();
                        window.result={sequence:value.content.global_sequence,block:value.content.block_num,done};
                        `
                        }
                    } catch(error) {window.failure=String(error);}
                </script>`);
                        return;
                    }
                    const path =
                        request.url === '/socket.io.esm.min.js'
                            ? 'node_modules/socket.io-client/dist/socket.io.esm.min.js'
                            : /^\/lib\/esm\/[a-z-]+\.js$/.test(request.url) ||
                                request.url === '/dist/hyperion-stream-client.js'
                              ? request.url.slice(1)
                              : undefined;
                    if (!path) {
                        response.statusCode = 404;
                        response.end();
                        return;
                    }
                    response.setHeader('content-type', 'application/javascript');
                    response.end(readFileSync(path));
                },
                request({ socket, ack, uuid, request }) {
                    if (scenario === 'errors' && request.contract === 'reject') {
                        ack({
                            status: 'ERROR',
                            message: 'Projection unavailable',
                            statusCode: 503,
                            retryable: true,
                            code: 'PROJECTION_UNAVAILABLE'
                        });
                        return;
                    }
                    ack({ status: 'OK', reqUUID: uuid });
                    if (scenario !== 'history') {
                        socket.emit('message', {
                            type: 'action_trace',
                            mode: 'live',
                            reqUUID: uuid,
                            message: Buffer.from(
                                scenario === 'errors'
                                    ? '{'
                                    : JSON.stringify(action(42, '18446744073709551615'))
                            )
                        });
                        return;
                    }
                    socket.emit('message', {
                        type: 'action_trace',
                        mode: 'history',
                        reqUUID: uuid,
                        messages: [
                            {
                                block_num: 42,
                                act: { account: 'eosio.token', name: 'transfer', data: {} }
                            }
                        ]
                    });
                    socket.emit('message', { type: 'history_end', reqUUID: uuid });
                }
            });
            const page = await browser.newPage();
            page.setDefaultTimeout(5000);
            page.setDefaultNavigationTimeout(5000);
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(f.endpoint);
            await page.waitForFunction(() => window.result || window.failure);
            const result = await page.evaluate(() => ({
                result: window.result,
                failure: window.failure
            }));
            assert.equal(result.failure, undefined);
            assert.deepEqual(
                result.result,
                scenario === 'history'
                    ? { chain: 'test-chain', blocks: [42] }
                    : scenario === 'errors'
                      ? {
                            status: 503,
                            retryable: true,
                            code: 'PROJECTION_UNAVAILABLE',
                            malformed: true
                        }
                      : { sequence: '18446744073709551615', block: 42, done: true }
            );
            if (scenario === 'binary') {
                // Observe remote cancellation before disconnect can discard the queued packet.
                await until(() => f.cancellations.length === 1);
                assert.deepEqual(f.cancellations, [f.requests[0].uuid]);
                assert.equal(f.sockets[0].connected, true);
                await page.evaluate(() => window.disconnect());
            }
            assert.deepEqual(errors, []);
        });
