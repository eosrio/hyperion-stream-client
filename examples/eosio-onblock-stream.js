import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://wax-main.hyperion.eosrio.io',
    libStream: false,
    debug: true
});

let lastBlock = 0;
let liveCount = 0;

client.setAsyncDataHandler(async (data) => {
    const block_num = data.content.block_num;
    if (block_num > lastBlock) {
        if (lastBlock > 0 && block_num > lastBlock + 1) {
            console.log(`Skipped ${block_num - lastBlock - 1} Blocks - ${lastBlock + 1} to ${block_num - 1}`);
        }
        lastBlock = block_num;
    }

    if (data.mode === 'live') {
        liveCount++;
        if (liveCount > 10) {
            client.disconnect();
        }
    }

});

await client.connect();

const response = await client.streamActions({
    contract: 'eosio',
    action: 'onblock',
    account: '',
    start_from: -2000,
    filters: [],
});

if (response.status !== 'OK') {
    console.log(response.reason);
    client.disconnect();
}
