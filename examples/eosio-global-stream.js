import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://wax-main.hyperion.eosrio.io',
    libStream: false,
    debug: true
});

client.setAsyncDataHandler(async (data) => {
    if (data.content.data) {
        console.log(data.content.data.owner, data.content.data.votepay_share);
    }
});

await client.connect();

const response = await client.streamDeltas({
    code: 'eosio',
    scope: 'eosio',
    table: 'producers2',
    payer: '',
    start_from: -100,
    filters: [
        {field: 'data.owner', value: 'eosriobrazil'}
    ],
});

if (response.status !== 'OK') {
    console.log(response.reason);
    client.disconnect();
}
