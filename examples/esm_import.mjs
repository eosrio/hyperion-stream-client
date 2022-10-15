import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient({
    endpoint: 'https://sidechain.node.tibs.app',
    debug: true
});

async function handler(data) {
    switch (data.type) {
        case 'action': {
            const action = data.content;
            const act = action.act;
            const actData = act.data;
            console.log(`Action - [${act.account}::${act.name}] >> ${JSON.stringify(actData)}`);
            break;
        }
        case 'delta': {
            const delta = data.content;
            const row = delta.data;
            console.log(`Delta -  [${delta.code}::${delta.table}] >> ${JSON.stringify(row)}`);
            break;
        }
    }
}

client.setAsyncDataHandler(handler);

client.on('empty', () => {
    console.log('Queue Empty!');
});

client.on('libUpdate', (data) => {
    console.log('Current LIB:', data.block_num);
});

client.on('fork', (data) => {
    console.log('Fork Event:', data);
});

await client.connect();

await client.streamActions({
    contract: 'tibs',
    action: '*',
    account: '',
    filters: [],
    read_until: 0,
    start_from: 594621
});

await client.streamActions({
    contract: 'market.tibs',
    action: '*',
    account: '',
    filters: [],
    read_until: 0,
    start_from: 594621
});

await client.streamDeltas({
    code: 'tibs',
    scope: '*',
    table: '*',
    payer: '',
    read_until: 0,
    start_from: 594621
});

await client.streamDeltas({
    code: 'market.tibs',
    scope: '*',
    table: '*',
    payer: '',
    read_until: 0,
    start_from: 594621
});
