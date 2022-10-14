import {HyperionStreamClient} from "../lib/esm/index.js";

const client = new HyperionStreamClient('https://sidechain.node.tibs.app',{
    async: true,
    debug: true
});

client.onLIB = (libData) => {
    console.log('Current LIB:', libData.block_num);
    console.log(client.lastBlockNum);
};

client.connect(() => {
    console.log('connected!');
});
