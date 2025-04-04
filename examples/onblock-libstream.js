import {HyperionStreamClient} from "../lib/esm/index.js";

const streamingHost = "ws://ultra.eosrio.io"
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
    start_from: 0,
    read_until: 0,
    filters: [],
});

if (response.status !== 'OK') {
    console.log(response.reason);
    client.disconnect();
}
