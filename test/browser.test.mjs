import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixture } from './setup.js';

for (const format of ['esm', 'umd'])
    test(
        `Chromium ${format}: imports, handshake, request, history and completion`,
        { timeout: 20000 },
        async (t) => {
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
                        await client.connect();
                        const stream = await client.streamActions({contract:'eosio.token',action:'transfer',start_from:1,ignore_live:true});
                        const blocks=[]; for await(const message of stream) blocks.push(message.content.block_num);
                        window.result={chain:client.chainId,blocks}; client.disconnect();
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
                request({ socket, ack, uuid }) {
                    ack({ status: 'OK', reqUUID: uuid });
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
            assert.deepEqual(result.result, { chain: 'test-chain', blocks: [42] });
            assert.deepEqual(errors, []);
        }
    );
