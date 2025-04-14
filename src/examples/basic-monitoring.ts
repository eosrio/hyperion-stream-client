import {HyperionStreamClient} from "../hyperion-stream-client.js";
const client = new HyperionStreamClient({
    endpoint: 'wss://libre.rioblocks.io',
    debug: false,
    libStream: false,
    libMonitor: false,
});
await client.connect();
console.log('Connected to Hyperion Stream - chain_id:', client.chainId);
client.on('error', (error) => {
    console.error('Error:', error);
});
const sleep = async (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};
await sleep(200);

// Event Emitter Example
(async () => {
    const stream = await client.streamDeltas({
        code: '',
        scope: '',
        table: '',
        payer: 'rioblocks',
        start_from: 0,
        read_until: 0,
        replayOnReconnect: false
    });
    stream.on('message', (data) => {
        const content = data.content;
        if (content.table === 'producers') {
            console.log(`[${new Date().toISOString()}] [${data.mode}] [${content.block_num}] | Producer: ${content.payer} | Unpaid Blocks: ${content.data.unpaid_blocks}`);
        } else {
            console.log(`[${new Date().toISOString()}] [${data.mode}] [${content.block_num}] | ${content.code}::${content.table}::${content.scope}`, content.data);
        }
    });
})();
