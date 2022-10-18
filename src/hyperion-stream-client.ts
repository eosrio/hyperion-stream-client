// noinspection JSUnusedGlobalSymbols

import {queue, QueueObject} from "async";
import {io, Socket} from "socket.io-client";

import {
    ActionContent,
    AsyncHandlerFunction,
    DeltaContent,
    EventData,
    EventListener,
    ForkData,
    HyperionClientOptions,
    IncomingData,
    LIBData,
    SavedRequest,
    StreamActionsRequest,
    StreamDeltasRequest
} from "./interfaces";

import fetch from "cross-fetch";

export enum StreamClientEvents {
    DATA = 'data',
    LIBUPDATE = 'libUpdate',
    FORK = 'fork',
    EMPTY = 'empty',
    CONNECT = 'connect',
    DRAIN = 'drain',
    LIBDATA = 'libData',
}

function trimTrailingSlash(input: string) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    } else {
        return input;
    }
}

export class HyperionStreamClient {

    private socket?: Socket;
    private socketURL?: string;
    private lastReceivedBlock: number = 0;
    private dataQueue: QueueObject<IncomingData> | null = null;
    private options: HyperionClientOptions & Record<string, any> = {
        async: true,
        libStream: false,
        endpoint: ''
    };

    private libDataQueue: QueueObject<IncomingData> | null = null;
    private reversibleBuffer: IncomingData[] = [];

    private onDataAsync?: AsyncHandlerFunction;
    private onLibDataAsync?: AsyncHandlerFunction;

    online: boolean = false;
    savedRequests: SavedRequest[] = [];

    eventListeners: Map<string, EventListener[]> = new Map();
    tempEventListeners: Map<string, EventListener[]> = new Map();

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
    constructor(options: HyperionClientOptions & Record<string, any>) {
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
        } else {
            throw new Error('Invalid options');
        }
    }

    /**
     * Disconnects from the API
     * @example
     *
     *     disconnect()
     */
    public disconnect() {
        if (this.socket) {
            this.lastReceivedBlock = 0;
            this.socket.disconnect();
            this.savedRequests = [];
        } else {
            console.log('Nothing to disconnect!');
        }
    }

    /**
     * Get the last block number received
     */
    get lastBlockNum(): number {
        return this.lastReceivedBlock;
    }

    /**
     *
     * @param endpoint - Hyperion API Endpoint
     */
    public setEndpoint(endpoint: string) {
        if (endpoint) {
            this.socketURL = trimTrailingSlash(endpoint);
        } else {
            console.error('URL not informed');
        }
    }

    private pushToBuffer(task: IncomingData): void {
        if (this.options.libStream) {
            this.reversibleBuffer.push(task);
        }
    }

    private setupIncomingQueue(): void {
        // setup incoming queue
        this.dataQueue = queue((task: IncomingData, taskCallback) => {
            task.irreversible = false;
            this.emit(StreamClientEvents.DATA, task);
            this.pushToBuffer(task);
            if (this.onDataAsync) {
                this.onDataAsync(task).then(() => {
                    taskCallback();
                });
            } else {
                taskCallback();
            }
        }, 1);

        // assign an error callback
        this.dataQueue.error((err) => {
            if (err) {
                console.error('task experienced an error');
            }
        });

        this.dataQueue.drain(() => {
            this.emit<void>(StreamClientEvents.DRAIN);
        });

        this.dataQueue.empty(() => {
            this.emit<void>(StreamClientEvents.EMPTY);
        });
    }

    private setupIrreversibleQueue(): void {
        // irreversible queue
        if (this.options.libStream) {
            this.libDataQueue = queue((task: IncomingData, callback) => {
                task.irreversible = true;
                this.emit(StreamClientEvents.LIBDATA, task);
                if (this.onLibDataAsync) {
                    this.onLibDataAsync(task).then(() => {
                        callback();
                    });
                } else {
                    callback();
                }
            }, 1);
        }
    }

    private handleLibUpdate(msg: any) {
        if (this.options.libStream) {
            while (this.reversibleBuffer.length > 0) {
                if (this.reversibleBuffer[0]) {
                    if (this.reversibleBuffer[0].content.block_num <= msg.block_num) {
                        if (this.libDataQueue) {
                            const data = this.reversibleBuffer.shift();
                            if (data) {
                                this.libDataQueue.push(data).catch(console.log);
                            } else {
                                break;
                            }
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
        }

        this.emit<LIBData>(StreamClientEvents.LIBUPDATE, msg);

        for (const request of this.savedRequests) {
            if (request.req.read_until && request.req.read_until !== 0) {
                if (request.req.read_until < msg.block_num) {
                    this.disconnect();
                }
            }
        }
    }

    private async setupSocket(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.socketURL) {
                reject();
            } else {
                this.socket = io(this.socketURL, {
                    transports: ["websocket"],
                    path: '/stream'
                });
                this.socket.on('connect', () => {
                    this.debugLog('connected');
                    this.online = true;
                    this.emit<void>(StreamClientEvents.CONNECT);
                    this.resendRequests().catch(console.log);
                    resolve();
                });

                this.socket.on('error', (msg) => {
                    console.log(msg);
                });

                this.socket.on('lib_update', this.handleLibUpdate.bind(this));

                this.socket.on('fork_event', (msg) => {
                    this.emit<ForkData>(StreamClientEvents.FORK, msg);
                });

                this.socket.on('message', (msg: any) => {
                    if ((this.onDataAsync || this.onLibDataAsync) && (msg.message || msg['messages'])) {
                        switch (msg.type) {
                            case 'delta_trace': {
                                if (msg['messages']) {
                                    msg['messages'].forEach((message: DeltaContent) => {
                                        this.processDeltaTrace(message, msg.mode);
                                    });
                                } else {
                                    this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                                }
                                break;
                            }
                            case 'action_trace': {
                                if (msg['messages']) {
                                    msg['messages'].forEach((message: ActionContent) => {
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
    }

    /**
     * Start session. Handlers should be defined before this method is called
     * @example
     * connect(()=>{
     *     console.log('Connection was successful!');
     * });
     */
    public async connect(): Promise<void> {
        this.setupIncomingQueue();
        this.setupIrreversibleQueue();
        if (!this.socketURL) {
            throw new Error('endpoint was not defined!');
        }
        this.debugLog(`Connecting to ${this.socketURL}...`);
        await this.setupSocket();
    }

    /**
     * Internal method to parse an action streaming trace
     * @param action
     * @param mode
     * @private
     */
    private processActionTrace(action: ActionContent, mode: "live" | "history") {
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
    private processDeltaTrace(delta: DeltaContent, mode: "live" | "history") {
        let metaKey = '@' + delta['table'];
        if (delta[metaKey + '.data']) {
            metaKey = metaKey + '.data'
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
    async resendRequests() {
        if (this.savedRequests.length === 0) {
            return;
        }
        this.debugLog(`Sending ${this.savedRequests.length} saved requests`);
        const savedReqs = [...this.savedRequests];
        this.savedRequests = [];
        for (const r of savedReqs) {
            switch (r.type) {
                case 'action': {
                    await this.streamActions(r.req as StreamActionsRequest);
                    break;
                }
                case 'delta': {
                    await this.streamDeltas(r.req as StreamDeltasRequest);
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
    async streamActions(request: StreamActionsRequest): Promise<any> {
        if (this.socket && this.socket.connected) {
            try {
                await this.checkLastBlock(request);
            } catch (e: any) {
                return {status: 'ERROR', error: e.message};
            }
            return new Promise((resolve, reject) => {
                if (this.socket) {
                    this.socket.emit('action_stream_request', request, (response: any) => {
                        this.debugLog(response);
                        if (response.status === 'OK') {
                            this.savedRequests.push({type: 'action', req: request});
                            response['startingBlock'] = request.start_from;
                            resolve(response);
                        } else {
                            reject(response);
                        }
                    });
                } else {
                    reject({status: false, error: 'socket was not created'});
                }
            });
        } else {
            throw new Error('Client is not connected! Please call connect before sending requests');
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
    async streamDeltas(request: StreamDeltasRequest): Promise<any> {
        if (this.socket && this.socket.connected) {
            try {
                await this.checkLastBlock(request);
            } catch (e: any) {
                return {status: 'ERROR', error: e.message};
            }
            return new Promise((resolve, reject) => {
                if (this.socket) {
                    this.socket.emit('delta_stream_request', request, (response: any) => {
                        this.debugLog(response);
                        if (response.status === 'OK') {
                            this.savedRequests.push({type: 'delta', req: request});
                            response['startingBlock'] = request.start_from;
                            resolve(response);
                        } else {
                            reject(response);
                        }
                    });
                } else {
                    reject({status: false, error: 'socket was not created'});
                }
            });
        } else {
            throw new Error('Client is not connected! Please call connect before sending requests');
        }
    }


    /**
     * Check if the start_from value should be updated or not
     * @param request - Request object to verify
     */
    private async checkLastBlock(request: StreamActionsRequest | StreamDeltasRequest) {
        if (String(request.start_from).toUpperCase() === 'LIB') {
            let url;
            url = this.options.chainApi ? this.options.chainApi : this.socketURL;
            url += '/v1/chain/get_info';
            if (url) {
                try {
                    const getInfoResponse = await fetch(url);
                    const json = await getInfoResponse.json() as any;
                    if (json) {
                        if (json['last_irreversible_block_num']) {
                            request.start_from = json['last_irreversible_block_num'];
                            this.debugLog(`Stream starting at lib (block ${request.start_from})`);
                        }
                    }
                } catch (e: any) {
                    throw new Error(`get_info failed on: ${url} | error: ${e.message}`);
                }
            }
        } else if (request.start_from !== 0 && this.lastReceivedBlock) {
            if (request.start_from < this.lastReceivedBlock) {
                request.start_from = this.lastReceivedBlock;
            }
        }
    }

    private debugLog(...args: any[]): void {
        if (this.options.debug) {
            console.log('[hyperion:debug]', ...args);
        }
    }

    public setAsyncDataHandler(handler: AsyncHandlerFunction) {
        this.onDataAsync = handler;
    }

    public setAsyncLibDataHandler(handler: AsyncHandlerFunction) {
        this.onLibDataAsync = handler;
    }

    private emit<T extends EventData>(event: StreamClientEvents | string, data?: T): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach((l: EventListener) => l(data));
        }

        const tempListeners = this.tempEventListeners.get(event);
        if (tempListeners && tempListeners.length > 0) {
            const listener = tempListeners.shift();
            if (listener) {
                listener(data);
            }
        }
    }

    public once(event: StreamClientEvents | string, listener: EventListener): void {
        if (typeof listener !== 'function') {
            throw new Error('Event listener must be a function');
        }
        if (!this.tempEventListeners.has(event)) {
            this.tempEventListeners.set(event, [listener]);
        } else {
            this.tempEventListeners.get(event)?.push(listener);
        }
    }

    public on(event: StreamClientEvents | string, listener: EventListener): void {
        if (typeof listener !== 'function') {
            throw new Error('Event listener must be a function');
        }
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, [listener]);
        } else {
            this.eventListeners.get(event)?.push(listener);
        }
    }

    public off(event: StreamClientEvents | string, listener: EventListener): void {
        // remove from fixed list
        const listeners = this.eventListeners.get(event);
        if (listeners && listeners.length > 0) {
            const idx = listeners.findIndex(l => l === listener);
            listeners.splice(idx, 1);
        }
        // remove from temporary list
        const tempListeners = this.tempEventListeners.get(event);
        if (tempListeners && tempListeners.length > 0) {
            const idx = tempListeners.findIndex(l => l === listener);
            tempListeners.splice(idx, 1);
        }
    }
}
