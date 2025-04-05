import {HyperionStreamClient, DeltaContent, IncomingData} from "@eosrio/hyperion-stream-client";

const client = new HyperionStreamClient({
    endpoint: 'ws://192.168.0.51:8155/stream',
    debug: true,
    libStream: false
});

client.on('connect', () => {
    console.log('connected!');
});

client.on('disconnect', () => {
    console.log('disconnected!');
})

client.on('error', (error) => {
    console.error('Error:', error);
});

client.on('empty', () => {
    console.log('Queue Empty!');
});

client.on('fork', (data) => {
    console.log('Fork Event:', data);
});

client.setAsyncDataHandler(async (data) => {
    console.log(data);
})

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

try {
    await client.connect();
    console.log('Connected!');
} catch (error: any) {
    console.error('Connection failed:', error);
}

// // use the event-based approach
// stream.on('message', (data: HyperionStreamEvents) => {
//     console.log('Received data from event:', data.type, data.reqUUID);
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


