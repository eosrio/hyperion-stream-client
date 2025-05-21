import {HyperionStreamClient} from "../hyperion-stream-client.js";

const client = new HyperionStreamClient({endpoint: 'wss://ultra.eosrio.io', libMonitor: true});

await client.connect();

client.on("libUpdate", libInfo => {
    console.log(`LIB Updated ${libInfo.block_num} | ${libInfo.block_id} - ${libInfo.chain_id}`);
});
