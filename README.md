# Hyperion Stream Client

Live Streaming Client for Hyperion History API

## Instalation
1. Clone this repository
2. Run npm install
3. Configure the client
4. Run

## Configuration
### 1. Connection

Setup the endpoint that you want to fetch data and the type of transmission:

```javascript
const client = new Hyperion(ENDPOINT, {
        async: false
    });
```

Example:

```javascript
const client = new Hyperion('https://example.com', {
        async: false
    });
```

The type of transmission could be `async: false or true`:
- True: The transmission will be asynchronous and you need an acknowledge function. Hyperion will 
only send the next block when it receives the ack confirmation.
- False: The transmission will be synchronous. The acknowledge function is not needed.

When you successfully connect to hyperion, you'll receive a confirmation message:

`connected!`

### 2. Stream Data Structure

Setup the data structure to be streamed

 - `contract` - contract account
 - `action` - action name
 - `account` - account name
 - `start_from` - start reading on block or on a specific date: (0=disabled)
 - `read_until` - stop reading on block  (0=disable) or on a specific date (0=disabled)
 - `filters` - actions filter (more details below)

**Notes**
- Block number can be either positive or negative - Eg.: -15000, 700
- In case of negative block number, it will be subtracted from the HEAD
- Date format: 2020-01-01T00:00:00.000Z
 
Example:

```javascript
client.streamActions({
            contract: 'eosio.token',
            action: 'transfer',
            account: 'eosriobrazil',
            start_from: 1,
            read_until: 0,
            filters: [],
        });
``` 

#### 2. Filters
You can setup filters to refine your stream. For example, to filter the stream above for
every transfers made to eosriobrazil account:

```javascript
client.streamActions({
            contract: 'eosio.token',
            action: 'transfer',
            account: 'eosriobrazil',
            start_from: 1,
            read_until: 0,
            filters: [
                {field: '@transfer.to', value: 'eosriobrazil'}
            ],
        });
``` 

To refine even more your stream, you could add more filters. Remember that adding more filters
will result in a AND operation, by now it's not possible to make OR operations with filters.

Example:

```javascript
client.streamActions({
            contract: 'eosio.token',
            action: 'transfer',
            account: 'eosriobrazil',
            start_from: 1,
            read_until: 0,
            filters: [
                {field: '@transfer.from', value: 'eosio'},
                {field: '@transfer.to', value: 'eosriobrazil'}
            ],
        });
``` 

#### 3. Handling Data
```javascript
client.onData = async (data, ack) => {
    //code here
}
```

If you set `async = false` on the connection step, the `ack` function is not needed:
```javascript
client.onData = async (data) => {
    //code here
}
```

Example:

```javascript
client.onData = async (data, ack) => {
        const act = data['act'];

        console.log(`\n---- ACTION - ${data['global_sequence']} | BLOCK: ${data['block_num']} | ${act.account}::${act.name}`);
        for (const key in act.data) {
            if (act.data.hasOwnProperty(key)) {
                console.log(`${key} = ${act.data[key]}`);
            }
        }
}
```

Handling actions:
````javascript
if (data.type === 'action') {
        const act = data.content['act'];
        console.log(`\n >>>> Contract: ${act.account} | Action: ${act.name} | Block: ${content['block_num']} <<<< `);
        for (const key in act.data) {
            if (act.data.hasOwnProperty(key)) {
                console.log(`${key} = ${act.data[key]}`);
            }
        }
    }
````

Handling deltas:
````javascript
if (data.type === 'delta') {
        if (content['present'] === true) {
            const delta_data = content.data;
            console.log(`\n >>>> Block: ${content['block_num']} | Contract: ${content.code} | Table: ${content.table} | Scope: ${content['scope']} | Payer: ${content['payer']} <<<< `);
            if (delta_data) {
                for (const key in delta_data) {
                    if (delta_data.hasOwnProperty(key)) {
                        console.log(`${key} = ${delta_data[key]}`);
                    }
                }
            } else {
                console.log('ERROR >>>>>>>> ', content);
            }
        }
    }
````
