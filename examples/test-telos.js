import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient({
    endpoint: 'wss://telos.caleos.io',
    debug: true,
    libStream: false
});


client.on('connect', () => {
    console.log('connected!');
});

let count = 0;
client.setAsyncDataHandler(async (data) => {
    console.log(++count, data.content.global_sequence);
    // console.log(++count, data.content.act.data.sell_id);
});


let main = async function () {
    await client.connect();
    // const status = await client.streamActions({
    //     contract: 'srv1.xpell',
    //     action: 'closesale',
    //     account: '',
    //     start_from: 0,
    //     read_until: 0,
    //     filters: [],
    // });
    // console.log(status);

    const response = await client.streamActions({
        contract: 'eosio',
        action: 'onblock',
        account: '',
        start_from: 0,
        filters: [],
    });

    if (response.status !== 'OK') {
        console.log(response.reason);
        client.disconnect();
    }

}
main().catch(console.error);
