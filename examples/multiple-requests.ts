import {ActionContent, DeltaContent, HyperionStreamClient, IncomingData, LIBData,} from "@eosrio/hyperion-stream-client";

const client = new HyperionStreamClient({
    endpoint: 'wss://ultra.eosrio.io',
    debug: true,
    libStream: false
});

async function handler(data: IncomingData<ActionContent | DeltaContent>) {
    switch (data.type) {
        case 'action': {
            const action = data.content;
            const act = action.act;
            const actData = act.data;
            console.log(`Action - [${data.content.block_num}] [${act.account}::${act.name}] >> ${JSON.stringify(actData)}`);
            break;
        }
        case 'delta': {
            const delta = data.content;
            const row = delta.data;
            console.log(`Delta - [${data.content.block_num}] [${delta.code}::${delta.table}] >> ${JSON.stringify(row)}`);
            console.log(delta);
            break;
        }
    }
}

client.setAsyncDataHandler(handler);

client.on('empty', () => {
    // console.log('Queue Empty!');
});

client.on('libUpdate', (data: any) => {
    if (data) {
        console.log('Current LIB:', (data as LIBData).block_num);
    }
});

client.on('fork', (data) => {
    console.log('Fork Event:', data);
});

await client.connect();

// await client.streamActions({
//     contract: 'eosio.token',
//     action: 'transfer',
//     account: '*',
//     filters: [],
//     read_until: 0,
//     start_from: 0
// });

// await client.streamDeltas({
//     code: 'eosio',
//     scope: '*',
//     table: '*',
//     payer: '',
//     read_until: 0,
//     start_from: 0,
//     filters: [
//         // {field: "owner", value: "eosriobrazil"},
//     ]
// });

await client.streamDeltas({
    code: 'eosio',
    scope: '*',
    table: 'chainstate',
    payer: '',
    read_until: 0,
    start_from: 0,
    filter_op: 'or',
    filters: [
        {field: "active_schedule_version", value: 10, operator: "gt"},
        {field: "scheduled_producers", value: "eosriobrazil"}
    ]
});
