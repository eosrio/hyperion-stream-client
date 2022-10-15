const {HyperionStreamClient} = require('../lib/cjs/index');

console.log(HyperionStreamClient);

const client = new HyperionStreamClient({
    endpoint: 'https://sidechain.node.tibs.app',
    debug: true
});

client.on('empty', () => {
    console.log('Queue Empty!');
});

client.on('libUpdate', (data) => {
    console.log('Current LIB:', data.block_num);
});

client.on('fork', (data) => {
    console.log('Fork Event:', data);
});

async function run() {
    await client.connect();
}

run().catch(console.log);
