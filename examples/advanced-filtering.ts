import {HyperionStreamClient} from "@eosrio/hyperion-stream-client";

const client = new HyperionStreamClient({
    endpoint: 'wss://libre.rioblocks.io/stream',
    debug: true,
    libStream: false
});

try {
    await client.connect();
    console.log('Connected!');
} catch (error: any) {
    console.error('Connection failed:', error);
}

const stream = await client.streamDeltas({
    code: 'eosio',
    scope: 'eosio',
    table: 'global',
    payer: '',
    start_from: -10,
    read_until: 0,
    // filter_op: 'or',
    filters: [
        // {field: 'data.owner', value: 'eosriobrazil'}
    ],
});

await client.streamDeltas({
    code: 'eosio',
    scope: 'eosio',
    table: 'producers',
    payer: '',
    start_from: -10,
    read_until: 0,
    // filter_op: 'or',
    filters: [
        // {field: 'data.owner', value: 'eosriobrazil'}
    ],
});

stream.on('start', (response) => {
    console.log(`Stream connected - ${response.reqUUID} - startingBlock: ${response.startingBlock}`);
});

stream.on('error', (error) => {
    console.error('Stream error:', error);
})

let liveCount = 0;

stream.on('message', (data) => {
    const content = data.content;
    console.log(`Received ${data.mode} data from stream event at block`, content.block_num);
    if (data.mode === 'live') {
        liveCount++;
        if (liveCount > 3) {
            console.log('Stopping live stream...');
            stream.stop();
        }
    }
})

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


