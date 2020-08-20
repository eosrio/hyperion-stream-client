"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HyperionSocketClient = void 0;
const queue = require("async/queue");
const io = require("socket.io-client");
function trimTrailingSlash(input) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    }
    else {
        return input;
    }
}
class HyperionSocketClient {
    /**
     * @typedef {object} BaseOptions
     * @property {boolean} async - Enable Asynchronous Mode
     * @property {boolean} lib_stream - Enable onLibData handler
     */
    /**
     * Construct a new streaming client
     *
     * @param {string} endpoint - Hyperion API Endpoint (ex. https://api.eosrio.io)
     * @param {HyperionClientOptions} opts - Client Options
     */
    constructor(endpoint, opts) {
        this.reversibleBuffer = [];
        this.online = false;
        this.savedRequests = [];
        this.setEndpoint(endpoint);
        if (opts) {
            this.options = opts;
            if (this.options.libStream) {
                console.log('Client configured for lib stream');
            }
            if (this.options.chainApi) {
                this.options.chainApi = trimTrailingSlash(this.options.chainApi);
            }
        }
        if (this.options.fetch) {
            globalThis.fetch = this.options.fetch;
        }
        else if (typeof window !== 'undefined') {
            globalThis.fetch = window.fetch;
        }
        else {
            throw new Error('No fetch support!');
        }
    }
    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    disconnect() {
        if (this.socket) {
            this.lastReceivedBlock = null;
            this.socket.disconnect();
            this.savedRequests = [];
        }
        else {
            console.log('Nothing to disconnect!');
        }
    }
    /**
     * Get the last block number received
     */
    get lastBlockNum() {
        return this.lastReceivedBlock;
    }
    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */
    setEndpoint(endpoint) {
        if (endpoint) {
            this.socketURL = trimTrailingSlash(endpoint);
        }
        else {
            console.error('URL not informed');
        }
    }
    pushToBuffer(task) {
        if (this.options.libStream) {
            this.reversibleBuffer.push(task);
        }
    }
    /**
     * Start session. Action handlers should be defined before this method is called
     * @param {function} [callback] - function to execute on a successful connection
     *
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    connect(callback) {
        // setup incoming queue
        this.dataQueue = queue((task, callback) => {
            task.irreversible = false;
            if (this.onData) {
                if (this.options.async) {
                    this.pushToBuffer(task);
                    this.onData(task, () => {
                        callback();
                    });
                }
                else {
                    this.onData(task);
                    this.pushToBuffer(task);
                    callback();
                }
            }
            else {
                this.pushToBuffer(task);
                callback();
            }
        }, 1);
        // assign an error callback
        this.dataQueue.error(function (err) {
            if (err) {
                console.error('task experienced an error');
            }
        });
        this.dataQueue.drain(function () {
            // console.log('all items have been processed');
        });
        this.dataQueue.empty(this.onEmpty);
        // irreversible queue
        if (this.options.libStream) {
            this.libDataQueue = queue((task, callback) => {
                task.irreversible = true;
                if (this.onLibData) {
                    if (this.options.async) {
                        this.onLibData(task, () => {
                            callback();
                        });
                    }
                    else {
                        this.onLibData(task);
                        callback();
                    }
                }
                else {
                    callback();
                }
            }, 1);
        }
        if (!this.socketURL) {
            throw new Error('endpoint was not defined!');
        }
        this.socket = io(this.socketURL, {
            transports: ['websocket', 'polling']
        });
        this.socket.on('connect', () => {
            this.online = true;
            if (this.onConnect) {
                this.onConnect();
            }
            if (callback) {
                callback();
            }
        });
        this.socket.on('error', (msg) => {
            console.log(msg);
        });
        this.socket.on('lib_update', (msg) => {
            if (this.options.libStream) {
                while (this.reversibleBuffer.length > 0) {
                    if (this.reversibleBuffer[0].content.block_num <= msg.block_num) {
                        this.libDataQueue.push(this.reversibleBuffer.shift());
                    }
                    else {
                        break;
                    }
                }
            }
            if (this.onLIB) {
                this.onLIB(msg);
            }
            for (const request of this.savedRequests) {
                if (request.req.read_until && request.req.read_until !== 0) {
                    if (request.req.read_until < msg.block_num) {
                        this.disconnect();
                    }
                }
            }
        });
        this.socket.on('fork_event', (msg) => {
            if (this.onFork) {
                this.onFork(msg);
            }
        });
        this.socket.on('message', (msg) => {
            if ((this.onData || this.onLibData) && (msg.message || msg['messages'])) {
                switch (msg.type) {
                    case 'delta_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach((message) => {
                                this.processDeltaTrace(message, msg.mode);
                            });
                        }
                        else {
                            this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                        }
                        break;
                    }
                    case 'action_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach((message) => {
                                this.processActionTrace(message, msg.mode);
                            });
                        }
                        else {
                            this.processActionTrace(JSON.parse(msg.message), msg.mode);
                        }
                        break;
                    }
                }
            }
        });
        this.socket.on('status', (status) => {
            switch (status) {
                case 'relay_restored': {
                    if (!this.online) {
                        this.online = true;
                        this.resendRequests().catch(console.log);
                    }
                    break;
                }
                case 'relay_down': {
                    this.online = false;
                    break;
                }
                default: {
                    console.log(status);
                }
            }
        });
        this.socket.on('disconnect', () => {
            this.online = false;
            console.log('disconnected!');
        });
    }
    /**
     * Internal method to parse an action streaming trace
     * @param action
     * @param mode
     * @private
     */
    processActionTrace(action, mode) {
        const metakey = '@' + action['act'].name;
        if (action[metakey]) {
            const parsedData = action[metakey];
            Object.keys(parsedData).forEach((key) => {
                if (!action['act']['data']) {
                    action['act']['data'] = {};
                }
                action['act']['data'][key] = parsedData[key];
            });
            delete action[metakey];
        }
        this.dataQueue.push({
            type: 'action',
            mode: mode,
            content: action
        });
        this.lastReceivedBlock = action['block_num'];
    }
    /**
     * Internal method to parse a delta streaming trace
     * @param delta
     * @param mode
     * @private
     */
    processDeltaTrace(delta, mode) {
        let metakey = '@' + delta['table'];
        if (delta[metakey + '.data']) {
            metakey = metakey + '.data';
        }
        if (delta[metakey]) {
            const parsedData = delta[metakey];
            Object.keys(parsedData).forEach((key) => {
                if (!delta['data']) {
                    delta['data'] = {};
                }
                delta['data'][key] = parsedData[key];
            });
            delete delta[metakey];
        }
        this.dataQueue.push({
            type: 'delta',
            mode: mode,
            content: delta
        });
        this.lastReceivedBlock = delta['block_num'];
    }
    /**
     * Replay cached requests
     */
    async resendRequests() {
        console.log('resending saved requests');
        const savedReqs = [...this.savedRequests];
        this.savedRequests = [];
        for (const r of savedReqs) {
            switch (r.type) {
                case 'action': {
                    await this.streamActions(r.req);
                    break;
                }
                case 'delta': {
                    await this.streamDeltas(r.req);
                    break;
                }
            }
        }
    }
    /**
     * Request filter definition
     * @typedef {Object} requestFilter
     * @property {string} field - Filter Field (ex. "act.data.from")
     * @property {string} value - Filter value
     */
    /**
     * Action request definition
     * @typedef {Object} StreamActionsRequest
     * @property {string} contract - Contract name
     * @property {string} account - Account to filter for
     * @property {string} action - Action name to filter
     * @property {[RequestFilter]} filters - Array of filters
     * @property {number} [start_from=0] - Starting block number
     * @property {number} [read_until=0] - Read until this block number
     */
    /**
     * Send a request for a filtered action traces stream
     * @param {StreamActionsRequest} request - Action Request Options
     */
    async streamActions(request) {
        if (this.socket.connected) {
            try {
                await this.checkLastBlock(request);
            }
            catch (e) {
                return { status: 'ERROR', error: e.message };
            }
            return new Promise((resolve, reject) => {
                this.socket.emit('action_stream_request', request, (response) => {
                    if (response.status === 'OK') {
                        this.savedRequests.push({
                            type: 'action',
                            req: request
                        });
                        response['startingBlock'] = request.start_from;
                        resolve(response);
                    }
                    else {
                        reject(response);
                    }
                });
            });
        }
    }
    /**
     * Delta request definition
     * @typedef {Object} StreamDeltasRequest
     * @property {string} code - Contract name
     * @property {string} table - Table
     * @property {string} scope - Scope
     * @property {string} payer - Payer account
     * @property {number} [start_from=0] - Starting block number
     * @property {number} [read_until=0] - Read until this block number
     */
    /**
     * Send a request for a filtered delta traces stream
     * @param {StreamDeltasRequest} request - Delta Request Options
     */
    async streamDeltas(request) {
        if (this.socket.connected) {
            try {
                await this.checkLastBlock(request);
            }
            catch (e) {
                return { status: 'ERROR', error: e.message };
            }
            return new Promise((resolve, reject) => {
                this.socket.emit('delta_stream_request', request, (response) => {
                    if (response.status === 'OK') {
                        this.savedRequests.push({
                            type: 'delta',
                            req: request
                        });
                        response['startingBlock'] = request.start_from;
                        resolve(response);
                    }
                    else {
                        reject(response);
                    }
                });
            });
        }
    }
    /**
     * Check if the start_from value should be updated or not
     * @param request - Request object to verify
     */
    async checkLastBlock(request) {
        if (String(request.start_from).toUpperCase() === 'LIB') {
            let url, valid, error = '';
            url = this.options.chainApi ? this.options.chainApi : this.socketURL;
            url += '/v1/chain/get_info';
            try {
                const json = await globalThis.fetch(url).then(res => res.json()).catch(reason => {
                    error = reason.message;
                });
                if (json) {
                    if (json['last_irreversible_block_num']) {
                        request.start_from = json['last_irreversible_block_num'];
                        console.log(`Requesting history stream starting at lib (block ${request.start_from})`);
                        valid = true;
                    }
                    else {
                        valid = false;
                    }
                }
            }
            catch (e) {
                throw new Error(`get_info failed on: ${url} | error: ${e.message}`);
            }
            if (!valid) {
                throw new Error(`get_info failed on: ${url} | error: ${error}`);
            }
        }
        else if (request.start_from !== 0 && this.lastReceivedBlock) {
            if (request.start_from < this.lastReceivedBlock) {
                request.start_from = this.lastReceivedBlock;
            }
        }
    }
}
exports.HyperionSocketClient = HyperionSocketClient;
//# sourceMappingURL=hyperion-socket-client.js.map