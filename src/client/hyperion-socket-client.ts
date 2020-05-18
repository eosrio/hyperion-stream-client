import {queue} from "async";
import * as io from "socket.io-client";
import {
    ForkData,
    HyperionClientOptions,
    IncomingData,
    LIBData,
    StreamActionsRequest,
    StreamDeltasRequest
} from "../interfaces";

export class HyperionSocketClient {

    private socket;
    private socketURL;
    private lastReceivedBlock;
    private dataQueue;
    private options;

    onConnect;
    onData: (data: IncomingData, ack?: () => void) => void;
    onLIB: (data: LIBData) => void;
    onFork: (data: ForkData) => void;
    onEmpty;

    online = false;

    private savedRequests = [];

    /**
     * @typedef {object} BaseOptions
     * @property {boolean} async - Enable Asynchronous Mode
     */

    /**
     * Construct a new streaming client
     *
     * @param {string} endpoint - Hyperion API Endpoint (ex. https://api.eosrio.io)
     * @param {HyperionClientOptions} opts - Client Options
     */
    constructor(endpoint: string, opts: HyperionClientOptions) {
        if (endpoint) {
            this.socketURL = endpoint;
        }
        if (opts) {
            this.options = opts;
        }
    }

    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    disconnect() {
        this.lastReceivedBlock = null;
        this.socket.disconnect();
    }

    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */
    setEndpoint(endpoint: string) {
        if (endpoint) {
            this.socketURL = endpoint;
        } else {
            console.error('URL not informed');
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
    connect(callback?: () => void) {

        // setup incoming queue
        if (this.onData) {
            this.dataQueue = queue((task: IncomingData, callback) => {
                if (this.options.async) {
                    this.onData(task, () => {
                        callback();
                    });
                } else {
                    this.onData(task);
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
            if (this.onLIB) {
                this.onLIB(msg);
            }
        });

        this.socket.on('fork_event', (msg) => {
            if (this.onFork) {
                this.onFork(msg);
            }
        });

        this.socket.on('message', (msg: any) => {
            if (this.onData && (msg.message || msg['messages'])) {
                switch (msg.type) {
                    case 'delta_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach((message) => {
                                this.processDeltaTrace(message, msg.mode);
                            });
                        } else {
                            this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                        }
                        break;
                    }
                    case 'action_trace': {
                        if (msg['messages']) {
                            msg['messages'].forEach((message) => {
                                this.processActionTrace(message, msg.mode);
                            });
                        } else {
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
                        this.resendRequests();
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

    processDeltaTrace(delta: any, mode) {
        let metakey = '@' + delta['table'];
        if (delta[metakey + '.data']) {
            metakey = metakey + '.data'
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

    resendRequests() {
        console.log('RESENDING SAVED REQUESTS');
        const savedReqs = [...this.savedRequests];
        this.savedRequests = [];
        savedReqs.forEach(r => {
            switch (r.type) {
                case 'action': {
                    this.streamActions(r.req);
                    break;
                }
                case 'delta': {
                    this.streamDeltas(r.req);
                    break;
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
    streamActions(request: StreamActionsRequest) {
        if (this.socket.connected) {
            this.checkLastBlock(request);
            this.socket.emit('action_stream_request', request, (response) => {
                console.log('action stream response:', response);
            });
            this.savedRequests.push({
                type: 'action',
                req: request
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
    streamDeltas(request: StreamDeltasRequest) {
        if (this.socket.connected) {
            this.checkLastBlock(request);
            this.socket.emit('delta_stream_request', request, (response) => {
                console.log('delta stream response:', response);
            });
            this.savedRequests.push({
                type: 'delta',
                req: request
            });
        }
    }

    checkLastBlock(request: StreamActionsRequest | StreamDeltasRequest) {
        if (request.start_from !== 0 && this.lastReceivedBlock) {
            if (request.start_from < this.lastReceivedBlock) {
                request.start_from = this.lastReceivedBlock;
            }
        }
    }

}
