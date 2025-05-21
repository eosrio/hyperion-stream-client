import {HyperionStreamClient} from "../hyperion-stream-client.js";
import {StreamClientEvents} from "../interfaces.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://ultra.eosrio.io',
    libStream: false,
    libMonitor: true
});

await client.connect();
console.log('Connected to Hyperion Stream - chain_id:', client.chainId);

// client.on("libUpdate", data => {
//     console.log('LIB Update:', data);
// });

// client.on('data', data => {
//     console.log('Data:', data.content);
// });

client.on(StreamClientEvents.ERROR, (error) => {
    console.error('[Client] Error:', error);
});

// Async Iterator Example
// (async () => {
//     try {
//         const stream = await client.streamDeltas({
//             code: 'loan',
//             scope: '',
//             table: 'loan',
//             payer: '',
//             start_from: 1,
//             read_until: 0,
//             // ignore_live: true,
//             replayOnReconnect: false,
//             filter_op: "or",
//             filters: [
//                 {field: "scope", value: "loan"},
//                 {field: "data.account", value: "nobi"},
//             ]
//         });
//         let counter = 0;
//         for await (const delta of stream) {
//             if (delta === null) break;
//             const content = delta.content;
//             // simulate some processing time
//             // await sleep(20);
//
//             // console.log(`[${new Date().toISOString()}] [${delta.mode}] >> Block: ${content.block_num}`);
//             // console.log(content);
//             let line = '';
//             if (delta.mode === 'history') {
//                 line += '[HIST] ';
//             } else if (delta.mode === 'live') {
//                 line += '[LIVE] ';
//             }
//             line += `[${content['@timestamp']}] `;
//             line += `Block: ${content.block_num} | `;
//             line += `Account: ${content.data.account.padEnd(12, ' ')} | `;
//             line += `initial_amount: ${content.data.initial_amount.padEnd(18, ' ')} | `;
//             line += `loan_amount: ${content.data.outstanding_amount.padEnd(18, ' ')} | `;
//             console.log(line, content.present);
//             console.log(JSON.stringify(content.data));
//             console.log('----------------------------------');
//
//             // if (lastBlock === 0) {
//             //     lastBlock = content.block_num;
//             // } else {
//             //     if (content.block_num != lastBlock + 1) {
//             //         console.error('Block number mismatch:', content.block_num, lastBlock);
//             //     }
//             //     lastBlock = content.block_num;
//             // }
//             counter++;
//         }
//         console.log('Stream ended after', counter, 'messages');
//         client.disconnect();
//     } catch (e: any) {
//         console.log('Error:', e.message);
//     }
// })();

// (async () => {
//     try {
//         const stream = await client.streamDeltas({
//             code: 'eosio',
//             scope: 'eosio',
//             table: 'global',
//             payer: '',
//             // get data from the last full round
//             start_from: -10,
//             // filter_op: "or",
//             filters: [
//                 // {field: "payer", value: "sweden"},
//                 // {field: "payer", value: "rioblocks"},
//                 // {field: "payer", value: "eosusa"}
//             ],
//             replayOnReconnect: false
//         });
//         let counter = 0;
//         let lastBlock = 0;
//         for await (const delta of stream) {
//             if (delta === null) break;
//             const content = delta.content;
//
//             if (lastBlock === 0) {
//                 lastBlock = content.block_num;
//             } else {
//                 if (content.block_num != lastBlock + 1) {
//                     console.error(`Expected block number: ${lastBlock + 1}, Received: ${content.block_num}`);
//                 }
//                 lastBlock = content.block_num;
//             }
//
//             let line = '';
//             if (delta.mode === 'history') {
//                 line += '[HIST DELTA] ';
//             } else if (delta.mode === 'live') {
//                 line += '[LIVE DELTA] ';
//             }
//             line += `[${content['@timestamp']}] `;
//             line += `Block: ${content.block_num} | `;
//             line += `Scope: ${content.scope.padEnd(12, ' ')} | `;
//             // line += `Total Votes: ${content.data.total_votes.toString().padEnd(18, ' ')} | `;
//             console.log(line, content.present);
//             counter++;
//         }
//         console.log('Stream ended after', counter, 'messages');
//         client.disconnect();
//     } catch (e: any) {
//         console.log('Error:', e.message);
//     }
// })();

// (async () => {
//     try {
//         const stream = await client.streamActions({
//             contract: 'eosio.oracle',
//             action: 'pushrate',
//             account: '',
//             start_from: -100,
//             read_until: 0,
//             replayOnReconnect: false
//             // scope: '',
//             // table: 'producers',
//             // payer: '',
//             // get data from the last full round
//             // start_from: -12 * 21,
//             // filter_op: "or",
//             // filters: [
//             //     {field: "payer", value: "sweden"},
//             //     {field: "payer", value: "rioblocks"},
//             //     {field: "payer", value: "eosusa"}
//             // ]
//         });
//
//         stream.on("error", data => {
//             console.log('[Stream] Error:', data);
//         });
//
//         let counter = 0;
//         // let lastBlock = 0;
//         for await (const action of stream) {
//
//             // Finish on the stream end
//             if (action === null) break;
//             const content = action.content;
//
//             // if (lastBlock === 0) {
//             //     lastBlock = content.block_num;
//             // } else {
//             //     if (content.block_num != lastBlock + 1) {
//             //         console.error(`Expected block number: ${lastBlock + 1}, Received: ${content.block_num}`);
//             //     }
//             //     lastBlock = content.block_num;
//             // }
//
//             console.log(`[${counter} @ ${content.block_num}] ${content.act.account}::${content.act.name}`);
//
//             // let line = '';
//             // if (action.mode === 'history') {
//             //     line += '[HIST ACTION] ';
//             // } else if (action.mode === 'live') {
//             //     line += '[LIVE ACTION] ';
//             // }
//             // line += `[${content['@timestamp']}] `;
//             // line += `Block: ${content.block_num} | `;
//             // line += `Producer: ${content.producer.padEnd(12, ' ')} | `;
//             // line += `Global Sequence: ${content.global_sequence.toString().padEnd(18, ' ')} | `;
//             // line += `Contract: ${content.act.account.padEnd(12, ' ')} | `;
//             // line += `Action: ${content.act.name.padEnd(12, ' ')} | `;
//             // console.log(line);
//
//             // console.dir(content, {
//             //     depth: Infinity,
//             //     colors: true
//             // });
//
//             counter++;
//         }
//         console.log('Stream ended after', counter, 'messages');
//         client.disconnect();
//     } catch (e: any) {
//         console.log('[Stream Init] Error:', e.message);
//         console.log(e);
//     }
// })();

// let sum = 0;
// let total = 0;
// let count = 0;
// let min = 0;
// let max = 0;

(await client.streamDeltas({
    code: 'eosio.oracle',
    scope: '',
    table: 'lastknwnrate',
    payer: '',
    start_from: "2025-04-01T00:00:00.000",
    read_until: "2025-05-01T00:00:00.000",
    ignore_live: true,
    replayOnReconnect: true
    // filter_op: "or",
    // filters: [
    //     // {field: 'data.source', value: 'ubitfinex'},
    //     // {field: 'data.source', value: 'ubitmax'}
    //     // {
    //     //     field: 'data.latest_rate.price',
    //     //     value: 0.06,
    //     //     operator: 'gt',
    //     //     asset: "DUOS"
    //     // }
    // ]
})).on('message', (data) => {
    const content = data.content;
    console.log(`[${content.timestamp}] Source: ${content.data.source} | Price: ${content.data.latest_rate.price}`);
    // // Calculate average price
    // const [amount, _] = content.data.latest_rate.price.split(' ');
    // sum += parseFloat(amount);
    // total++;
    // count++;
    // if (count === 10) {
    //     console.log(`Average price: ${sum / total}`);
    //     count = 0;
    //     sum = 0;
    //     total = 0;
    // }
    //
    // if (min === 0) {
    //     min = parseFloat(amount);
    // }
    //
    // if (parseFloat(amount) < min) {
    //     min = parseFloat(amount);
    // }
    //
    // if (max === 0) {
    //     max = parseFloat(amount);
    // }
    //
    // if (parseFloat(amount) > max) {
    //     max = parseFloat(amount);
    // }
    //
    // console.log(`Min: ${min} | Max: ${max}`);
});

// (await client.streamActions({
//     contract: 'eosio.token',
//     action: 'transfer',
//     account: '',
//     start_from: -1000000,
//     read_until: 0,
//     filter_op: "or",
//     filters: [
//         // {field: '@transfer.to', value: 'eosriobrazil'},
//         // {field: '@transfer.amount', value: 500, operator: "lt"},
//         // {field: '@transfer.amount', value: 1000, operator: "gt"},
//         {field: 'act.data.quantity', value: "1978.36851192 UOS"},
//         // {field: 'receipts.receiver', value: 'cryptolions1'},
//         // {field: 'receipts.receiver', value: 'eosriobrazil'}
//     ]
// })).on('message', (data) => {
//     const content = data.content;
//     const act = content.act;
//     // console.log(content);
//     console.log(`Transfer from ${act.data.from} to ${act.data.to} - ${act.data.quantity} - ${act.data.memo}`, act.data.amount);
// });

// const globalStream = await client.streamDeltas({
//     code: 'eosio',
//     scope: 'eosio',
//     table: 'global',
//     payer: '',
//     start_from: 0,
//     read_until: 0,
//     // filter_op: 'or',
//     filters: [
//         // {field: 'data.owner', value: 'eosriobrazil'}
//     ],
// });

// const producerStream = await client.streamDeltas({
//     code: 'eosio.token',
//     scope: '',
//     table: '*',
//     payer: '',
//     start_from: 0,
//     read_until: 0,
//     // filter_op: 'or',
//     filters: [
//         // {field: 'data.owner', value: 'eosriobrazil'}
//     ],
// });
//
// const payerStream = await client.streamDeltas({
//     code: '',
//     scope: '',
//     table: '',
//     payer: 'rioblocks',
//     start_from: 0,
//     read_until: 0,
//     filters: [],
// });

// producerStream.on('message', (data) => {
//     const content = data.content;
//     console.log(content);
//     console.log(`Received ${data.mode} data from payer stream at block`, content.block_num, content.payer);
// })

// payerStream.on('message', (data) => {
//     const content = data.content;
//     console.log(`Received ${data.mode} data from payer stream at block`, content.block_num, content.payer);
// })
//
// globalStream.on('start', (response) => {
//     console.log(`Stream connected - ${response.reqUUID} - startingBlock: ${response.startingBlock}`);
// });
//
// globalStream.on('error', (error) => {
//     console.error('Stream error:', error);
// })
//
// let liveCount = 0;
//
// globalStream.on('message', (data) => {
//     const content = data.content;
//     console.log(`Received ${data.mode} data from global stream at block`, content.block_num, content.payer);
//     // if (data.mode === 'live') {
//     //     liveCount++;
//     //     if (liveCount > 3) {
//     //         console.log('Stopping live stream...');
//     //         stream.stop();
//     //     }
//     // }
// })

// use the event-based approach
// stream.on('message', (data: HyperionStreamEvents) => {
//     console.log(data);
//     // console.log('Received data from event:', data.type, data.reqUUID);
// });

// async iteration
// setTimeout(() => {
// (async () => {
//     try {
//         console.log('Reading data from stream using async iteration...');
//         for await (const delta of stream as AsyncIterable<IncomingData<DeltaContent>>) {
//             const data = delta.content;
//             console.log('Received data from iterator:', data.block_num, data.block_id, data.data.total_unpaid_blocks);
//         }
//     } catch (streamError: any) {
//         console.error('Stream reading error:', streamError);
//     }
// })();
// }, 5000);

// const stream2 = await client.streamDeltas({
//     code: 'eosio',
//     scope: 'eosio',
//     table: 'producers',
//     payer: '',
//     start_from: 0,
//     read_until: 0,
//     // filter_op: 'or',
//     filters: [
//         // {field: 'data.owner', value: 'eosriobrazil'}
//     ],
// });
//
// // use the event-based approach
// stream2.on('message', (data: HyperionStreamEvents) => {
//     console.log(data);
//     // console.log('Received data from event:', data.type, data.reqUUID);
// });
