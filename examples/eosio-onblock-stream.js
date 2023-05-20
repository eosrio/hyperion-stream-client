import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://wax-main.hyperion.eosrio.io',
    libStream: false
});

let lastBlock = 0;

client.setAsyncDataHandler(async (data) => {
    const block_num = data.content.block_num;
    if (block_num > lastBlock) {
        if (lastBlock > 0 && block_num > lastBlock + 1) {
            console.log(`Missed ${block_num - lastBlock - 1} Blocks - ${lastBlock + 1} to ${block_num - 1}`);
        }
        lastBlock = block_num;
    }
});

await client.connect();

await client.streamActions({
    contract: 'eosio',
    action: 'onblock',
    account: '',
    start_from: -200,
    filters: [],
});
