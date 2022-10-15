"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HyperionStreamClient = void 0;
const node_events_1 = __importDefault(require("node:events"));
const async_1 = require("async");
const socket_io_client_1 = require("socket.io-client");
const cross_fetch_1 = __importDefault(require("cross-fetch"));
function trimTrailingSlash(input) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    }
    else {
        return input;
    }
}
class HyperionStreamClient extends node_events_1.default {
    /**
     * @typedef {object} BaseOptions
     * @property {string} endpoint - Hyperion API Endpoint
     * @property {boolean} async - Enable Asynchronous Mode
     * @property {boolean} lib_stream - Enable onLibData handler
     */
    /**
     * Construct a new streaming client
     * @param {HyperionClientOptions} options - Client Options
     */
    constructor(options) {
        super();
        this.lastReceivedBlock = 0;
        this.dataQueue = null;
        this.options = {
            async: true,
            libStream: false,
            endpoint: ''
        };
        this.libDataQueue = null;
        this.reversibleBuffer = [];
        this.online = false;
        this.savedRequests = [];
        if (options && typeof options === 'object') {
            for (let optsKey in options) {
                if (options[optsKey] !== undefined) {
                    const value = options[optsKey];
                    switch (optsKey) {
                        case 'endpoint': {
                            this.options[optsKey] = value;
                            this.setEndpoint(value);
                            break;
                        }
                        case 'chainApi': {
                            this.options.chainApi = trimTrailingSlash(value);
                            break;
                        }
                        default: {
                            this.options[optsKey] = options[optsKey];
                        }
                    }
                }
            }
        }
        else {
            throw new Error('Invalid options');
        }
        this.onLIB = (data) => {
            this.debugLog(`Last Irreversible Block: ${data.block_num}`);
        };
    }
    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    disconnect() {
        if (this.socket) {
            this.lastReceivedBlock = 0;
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
    setupIncomingQueue() {
        // setup incoming queue
        this.dataQueue = (0, async_1.queue)((task, taskCallback) => {
            var _a;
            task.irreversible = false;
            // emit event data
            this.emit('data', {
                data: task,
                queueSize: (_a = this.dataQueue) === null || _a === void 0 ? void 0 : _a.length(),
                ack: taskCallback
            });
            if (this.onDataAsync) {
                this.pushToBuffer(task);
                this.onDataAsync(task).then(() => {
                    taskCallback();
                });
            }
            // // call onData direct handler
            // if (this.onData) {
            //     if (this.options.async) {
            //         this.pushToBuffer(task);
            //         this.onData(task, () => {
            //             taskCallback();
            //         });
            //     } else {
            //         this.onData(task);
            //         this.pushToBuffer(task);
            //         taskCallback();
            //     }
            // } else {
            //     this.pushToBuffer(task);
            //     taskCallback();
            // }
        }, 1);
        // assign an error callback
        this.dataQueue.error((err) => {
            if (err) {
                console.error('task experienced an error');
            }
        });
        this.dataQueue.drain(() => {
            // console.log('all items have been processed');
        });
        this.dataQueue.empty(() => {
            this.emit('empty');
            if (this.onEmpty) {
                this.onEmpty();
            }
        });
    }
    setupIrreversibleQueue() {
        // irreversible queue
        if (this.options.libStream) {
            this.libDataQueue = (0, async_1.queue)((task, callback) => {
                task.irreversible = true;
                if (this.onLibDataAsync) {
                    this.onLibDataAsync(task).then(() => {
                        callback();
                    });
                }
                else {
                    callback();
                }
            }, 1);
        }
    }
    handleLibUpdate(msg) {
        if (this.options.libStream) {
            while (this.reversibleBuffer.length > 0) {
                if (this.reversibleBuffer[0]) {
                    if (this.reversibleBuffer[0].content.block_num <= msg.block_num) {
                        if (this.libDataQueue) {
                            const data = this.reversibleBuffer.shift();
                            if (data) {
                                this.libDataQueue.push(data).catch(console.log);
                            }
                            else {
                                break;
                            }
                        }
                        else {
                            break;
                        }
                    }
                    else {
                        break;
                    }
                }
                else {
                    break;
                }
            }
        }
        this.emit('libUpdate', msg);
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
    }
    setupSocket() {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise((resolve, reject) => {
                if (!this.socketURL) {
                    reject();
                }
                else {
                    this.socket = (0, socket_io_client_1.io)(this.socketURL, {
                        transports: ["websocket"],
                        path: '/stream'
                    });
                    this.socket.on('connect', () => {
                        this.debugLog('connected');
                        this.online = true;
                        this.emit('connect');
                        if (this.onConnect) {
                            this.onConnect();
                        }
                        this.resendRequests().catch(console.log);
                        resolve();
                    });
                    this.socket.on('error', (msg) => {
                        console.log(msg);
                    });
                    this.socket.on('lib_update', this.handleLibUpdate.bind(this));
                    this.socket.on('fork_event', (msg) => {
                        this.emit('fork', msg);
                        if (this.onFork) {
                            this.onFork(msg);
                        }
                    });
                    this.socket.on('message', (msg) => {
                        if ((this.onDataAsync || this.onLibDataAsync) && (msg.message || msg['messages'])) {
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
                        // setTimeout(() => {
                        //     this.connect().catch(console.log);
                        // }, 3000);
                    });
                }
            });
        });
    }
    /**
     * Start session. Handlers should be defined before this method is called
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            this.setupIncomingQueue();
            this.setupIrreversibleQueue();
            if (!this.socketURL) {
                throw new Error('endpoint was not defined!');
            }
            this.debugLog(`Connecting to ${this.socketURL}...`);
            yield this.setupSocket();
            this.emit('connect');
        });
    }
    /**
     * Internal method to parse an action streaming trace
     * @param action
     * @param mode
     * @private
     */
    processActionTrace(action, mode) {
        const metaKey = '@' + action['act'].name;
        if (action[metaKey]) {
            const parsedData = action[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!action['act']['data']) {
                    action['act']['data'] = {};
                }
                action['act']['data'][key] = parsedData[key];
            });
            delete action[metaKey];
        }
        if (this.dataQueue) {
            this.dataQueue.push({
                type: 'action',
                mode: mode,
                content: action,
                irreversible: false
            }).catch(console.log);
            this.lastReceivedBlock = action['block_num'];
        }
    }
    /**
     * Internal method to parse a delta streaming trace
     * @param delta
     * @param mode
     * @private
     */
    processDeltaTrace(delta, mode) {
        let metaKey = '@' + delta['table'];
        if (delta[metaKey + '.data']) {
            metaKey = metaKey + '.data';
        }
        if (delta[metaKey]) {
            const parsedData = delta[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!delta['data']) {
                    delta['data'] = {};
                }
                delta['data'][key] = parsedData[key];
            });
            delete delta[metaKey];
        }
        if (this.dataQueue) {
            this.dataQueue.push({
                type: 'delta',
                mode: mode,
                content: delta,
                irreversible: false
            }).catch(console.log);
            this.lastReceivedBlock = delta['block_num'];
        }
    }
    /**
     * Replay cached requests
     */
    resendRequests() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.savedRequests.length === 0) {
                return;
            }
            this.debugLog(`Sending ${this.savedRequests.length} saved requests`);
            const savedReqs = [...this.savedRequests];
            this.savedRequests = [];
            for (const r of savedReqs) {
                switch (r.type) {
                    case 'action': {
                        yield this.streamActions(r.req);
                        break;
                    }
                    case 'delta': {
                        yield this.streamDeltas(r.req);
                        break;
                    }
                }
            }
        });
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
    streamActions(request) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.socket && this.socket.connected) {
                try {
                    yield this.checkLastBlock(request);
                }
                catch (e) {
                    return { status: 'ERROR', error: e.message };
                }
                return new Promise((resolve, reject) => {
                    if (this.socket) {
                        this.socket.emit('action_stream_request', request, (response) => {
                            this.debugLog(response);
                            if (response.status === 'OK') {
                                this.savedRequests.push({ type: 'action', req: request });
                                response['startingBlock'] = request.start_from;
                                resolve(response);
                            }
                            else {
                                reject(response);
                            }
                        });
                    }
                    else {
                        reject({
                            status: false,
                            error: 'socket was not created'
                        });
                    }
                });
            }
            else {
                throw new Error('Client is not connected! Please call connect before sending requests');
            }
        });
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
    streamDeltas(request) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.socket && this.socket.connected) {
                try {
                    yield this.checkLastBlock(request);
                }
                catch (e) {
                    return { status: 'ERROR', error: e.message };
                }
                return new Promise((resolve, reject) => {
                    if (this.socket) {
                        this.socket.emit('delta_stream_request', request, (response) => {
                            this.debugLog(response);
                            if (response.status === 'OK') {
                                this.savedRequests.push({ type: 'delta', req: request });
                                response['startingBlock'] = request.start_from;
                                resolve(response);
                            }
                            else {
                                reject(response);
                            }
                        });
                    }
                    else {
                        reject({
                            status: false,
                            error: 'socket was not created'
                        });
                    }
                });
            }
        });
    }
    /**
     * Check if the start_from value should be updated or not
     * @param request - Request object to verify
     */
    checkLastBlock(request) {
        return __awaiter(this, void 0, void 0, function* () {
            if (String(request.start_from).toUpperCase() === 'LIB') {
                let url, valid, error = '';
                url = this.options.chainApi ? this.options.chainApi : this.socketURL;
                url += '/v1/chain/get_info';
                if (url) {
                    try {
                        const json = yield (0, cross_fetch_1.default)(url).then(res => res.json()).catch(reason => {
                            error = reason.message;
                        });
                        if (json) {
                            if (json['last_irreversible_block_num']) {
                                request.start_from = json['last_irreversible_block_num'];
                                this.debugLog(`Requesting history stream starting at lib (block ${request.start_from})`);
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
            }
            else if (request.start_from !== 0 && this.lastReceivedBlock) {
                if (request.start_from < this.lastReceivedBlock) {
                    request.start_from = this.lastReceivedBlock;
                }
            }
        });
    }
    debugLog(...args) {
        if (this.options.debug) {
            console.log('[hyperion:debug]', ...args);
        }
    }
    setLibHandler(handler) {
        this.onLIB = handler;
    }
    setAsyncDataHandler(handler) {
        this.onDataAsync = handler;
    }
    setAsyncLibDataHandler(handler) {
        this.onLibDataAsync = handler;
    }
}
exports.HyperionStreamClient = HyperionStreamClient;
//# sourceMappingURL=hyperion-stream-client.js.map