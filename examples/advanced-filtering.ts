import {HyperionStreamClient, DeltaContent, IncomingData, HyperionStreamEvents} from "@eosrio/hyperion-stream-client";

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
    start_from: 0,
    read_until: 0,
    // filter_op: 'or',
    filters: [
        // {field: 'data.owner', value: 'eosriobrazil'}
    ],
});

// use the event-based approach
// stream.on('message', (data: HyperionStreamEvents) => {
//     console.log(data);
//     // console.log('Received data from event:', data.type, data.reqUUID);
// });

// async iteration
// setTimeout(() => {
(async () => {
    try {
        console.log('Reading data from stream using async iteration...');
        for await (const delta of stream as AsyncIterable<IncomingData<DeltaContent>>) {
            const data = delta.content;
            console.log('Received data from iterator:', data.block_num, data.block_id, data.data.total_unpaid_blocks);
        }
    } catch (streamError: any) {
        console.error('Stream reading error:', streamError);
    }
})();
// }, 5000);

const stream2 = await client.streamDeltas({
    code: 'eosio',
    scope: 'eosio',
    table: 'producers',
    payer: '',
    start_from: 0,
    read_until: 0,
    // filter_op: 'or',
    filters: [
        // {field: 'data.owner', value: 'eosriobrazil'}
    ],
});

// use the event-based approach
stream2.on('message', (data: HyperionStreamEvents) => {
    console.log(data);
    // console.log('Received data from event:', data.type, data.reqUUID);
});


