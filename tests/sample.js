const HyperionSocketClient = require('../lib/index').default;

const client = new HyperionSocketClient('https://wax.eosrio.io', {
  async: true,
  libStream: true, // new parameter to allow a stream based on irreversible data
  chainApi: 'https://wax.eosrio.io', // must be defined if the main hyperion api doesn't forward v1/chain/get_info
});

client.onLIB = (libData) => {
  console.log('Current LIB:', libData.block_num);
};

const handler = async (data, ack) => {
  const content = data.content;
  if (data.type === 'action') {
    const act = data.content['act'];
    console.log(`>> Contract: ${act.account} | Action: ${act.name} | Block: ${content['block_num']} << `);
    // for (const key in act.data) {
    //   if (act.data.hasOwnProperty(key)) {
    //     console.log(`${key} = ${act.data[key]}`);
    //   }
    // }
  }

  if (data.type === 'delta') {
    console.log(
        `>> Present: ${content['present']} | Block: ${content['block_num']} | Contract: ${content.code} | Table: ${content.table} | Scope: ${content['scope']} | Payer: ${content['payer']} <<`);
    const delta_data = content.data;
    // if (delta_data) {
    //   for (const key in delta_data) {
    //     if (delta_data.hasOwnProperty(key)) {
    //       console.log(`${key} = ${delta_data[key]}`);
    //     }
    //   }
    // } else {
    //   console.log('ERROR >>>>>>>> ', content);
    // }
  }
  ack();
};

// client.onLibData = handler;
client.onData = handler;

// client.onEmpty = async () => {
//     console.log(`Number of messages received: ${messages}`);
// };

client.onConnect = async () => {

  const actionReqs = [
    // {
    //   contract: '*',
    //   action: '*',
    //   account: 'eosio.token',
    //   start_from: 'LIB',
    //   read_until: 0,
    //   filters: [],
    // },
    {
      contract: 'delphioracle',
      action: '*',
      account: '',
      start_from: 'LIB',
      read_until: 0,
      filters: [],
    },
  ];

  for (const req of actionReqs) {
    const requestStatus = await client.streamActions(req);
    console.log('requestStatus:', requestStatus);
    if (requestStatus.status === 'ERROR') {
      console.log('Request failed! Disconnecting now!');
      client.disconnect();
      break;
    }
  }

  // client.streamDeltas({
  //   code: 'cron.eos',
  //   table: 'cronjobs',
  //   scope: '',
  //   payer: '',
  //   filters: [],
  //   start_from: 0,
  //   read_until: 0,
  // });

};

client.connect(() => {
  console.log('connected!');
});
