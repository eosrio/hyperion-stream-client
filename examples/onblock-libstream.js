import {HyperionStreamClient} from "../lib/esm/index.js";

const streamingHost = "ws://88.198.18.252:1234"
const client = new HyperionStreamClient({
    endpoint: streamingHost,
    debug: false,
    libStream: true
});

client.setAsyncLibDataHandler(async (data) => {
    const block = data.content;
    console.log(block);
});

await client.connect();

const response = await client.streamActions({
    contract: 'eosio',
    action: 'onblock',
    account: '',
    start_from: 225456007,
    read_until: 225456010,
    filters: [],
});

if (response.status !== 'OK') {
    console.log(response.reason);
    client.disconnect();
}
