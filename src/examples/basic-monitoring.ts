import {HyperionStreamClient} from "../hyperion-stream-client.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://libre.rioblocks.io/stream',
    debug: true,
    libStream: false
});

await client.connect();

console.log('Connected!');

client.on('error', (error) => {
    console.error('Error:', error);
});

(await client.streamDeltas({
    code: 'eosio',
    scope: 'eosio',
    table: 'producers',
    payer: '',
    start_from: 0,
    read_until: 0,
    replayOnReconnect: true
})).on('message', (data) => {
    const content = data.content;
    console.log(`[${data.mode}] Block: ${content.block_num} | Producer: ${content.payer}`);
});
