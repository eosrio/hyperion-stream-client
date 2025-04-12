import {HyperionStreamClient} from "../hyperion-stream-client.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://libre.rioblocks.io',
    debug: false,
    libStream: false
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

// Async Iterator Example
(async () => {
    try {
        const stream = await client.streamDeltas({
            code: 'loan',
            scope: '',
            table: 'loan',
            payer: '',
            start_from: 1,
            read_until: 0,
            ignore_live: true,
            replayOnReconnect: false
        });
        let counter = 0;
        for await (const delta of stream) {
            if (delta === null) break;
            const content = delta.content;
            // simulate some processing time
            // await sleep(20);

            // console.log(`[${new Date().toISOString()}] [${delta.mode}] >> Block: ${content.block_num}`);
            // console.log(content);
            let line = '';
            if (delta.mode === 'history') {
                line += '[HIST] ';
            } else if (delta.mode === 'live') {
                line += '[LIVE] ';
            }
            line += `[${content['@timestamp']}] `;
            line += `Block: ${content.block_num} | `;
            line += `Account: ${content.data.account.padEnd(12, ' ')} | `;
            line += `initial_amount: ${content.data.initial_amount.padEnd(18, ' ')} | `;
            line += `loan_amount: ${content.data.outstanding_amount.padEnd(18, ' ')} | `;
            console.log(line, content.present);

            // if (lastBlock === 0) {
            //     lastBlock = content.block_num;
            // } else {
            //     if (content.block_num != lastBlock + 1) {
            //         console.error('Block number mismatch:', content.block_num, lastBlock);
            //     }
            //     lastBlock = content.block_num;
            // }
            counter++;
        }
        console.log('Stream ended after', counter, 'messages');
        client.disconnect();4
    } catch (e: any) {
        console.log('Error:', e.message);
    }
})();

// Event Emitter Example
// (async () => {
//     const stream = await client.streamDeltas({
//         code: '',
//         scope: '',
//         table: '',
//         payer: 'rioblocks',
//         start_from: 0,
//         read_until: 0,
//         replayOnReconnect: false
//     });
//     stream.on('message', (data) => {
//         const content = data.content;
//         console.log(JSON.stringify(content, null, 2));
//         // console.log(`[${new Date().toISOString()}] [${data.mode}] >> Block: ${content.block_num} | Producer: ${content.payer}`);
//     });
// })();
