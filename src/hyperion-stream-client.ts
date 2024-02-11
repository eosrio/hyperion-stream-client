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
    StreamActionsRequest, StreamClientEvents,
    StreamDeltasRequest
} from "./interfaces";

import fetch from "cross-fetch";

import {trimTrailingSlash} from "./functions";

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
    requestMap: Map<string, SavedRequest> = new Map();

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
            const trackedRequest = this.requestMap.get(task.uuid);
            if (trackedRequest) {

                // Check if the first data payload was received, mark the request as started
                if (!trackedRequest.started) {
                    trackedRequest.started = true;

                    if (task.mode === 'live') {
                        trackedRequest.live = true;
                    }
                }

                console.log(`Task mode ${task.mode} | Tracked Live: ${trackedRequest.live} | Start on: ${trackedRequest.req.start_from}`);

                if (task.mode === 'history') {
                    trackedRequest.deliveryCounter++;
                    if (trackedRequest.deliveryCounter + trackedRequest.filtered === trackedRequest.historyResults) {
                        // allow 2 blocks before adding the live queue back in
                        trackedRequest.liveQueueStartTimer = setTimeout(() => {
                            this.debugLog('All history data was received, allow live data flow...');
                            trackedRequest.live = true;
                            this.dataQueue?.push(trackedRequest.pendingMessages);
                            trackedRequest.pendingMessages = [];
                        }, 2500) as unknown as number;
                    } else {
                        // if the live queue is about to start and another history message arrives, cancel the start
                        if (trackedRequest.liveQueueStartTimer) {
                            clearTimeout(trackedRequest.liveQueueStartTimer);
                        }
                    }
                }

                if (task.mode === "live" && !trackedRequest.live) {
                    // add any live message to pending
                    if (trackedRequest) {
                        trackedRequest.pendingMessages.push(task);
                        this.debugLog(`Received live message, adding to pending messages (${trackedRequest.pendingMessages.length})`);
                    }
                    taskCallback();
                } else {

                    if (task.mode === 'history') {
                        this.debugLog(task.mode, task.content.block_num, trackedRequest.deliveryCounter, trackedRequest.historyResults);
                    } else {
                        this.debugLog(task.mode, task.content.block_num);
                    }

                    // normal processing
                    task.irreversible = false;
                    this.emit(StreamClientEvents.DATA, task);
                    this.pushToBuffer(task);
                    // run user-defined async callback
                    if (this.onDataAsync && typeof this.onDataAsync === 'function') {
                        this.onDataAsync(task).then(() => {
                            taskCallback();
                        });
                    } else {
                        taskCallback();
                    }

                }
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

    private handleSocketMessage(msg: any) {
        let trackedRequest;
        if (msg.reqUUID) {
            trackedRequest = this.requestMap.get(msg.reqUUID);
        }

        if (msg.type === 'trace_init') {
            if (trackedRequest) {
                if (!trackedRequest.firstReceivedBlock) {
                    this.debugLog(`[${msg.reqUUID}] First Block received: ${msg.first_block} for ${msg.reqUUID} (${msg.results} docs)`);
                    trackedRequest.firstReceivedBlock = msg.first_block;
                    trackedRequest.historyResults = msg.results;
                } else {
                    this.debugLog(`[${msg.reqUUID}] Fill request received, from block ${msg.first_block} for (${msg.results} docs)`);
                    // increment total blocks in the case of a fill request
                    trackedRequest.historyResults = trackedRequest.historyResults + msg.results;
                }
            } else {
                console.log('Untracked request, something went wrong!');
            }
        }

        if ((this.onDataAsync || this.onLibDataAsync) && (msg.message || msg.messages)) {
            if (msg['error']) {
                console.log(msg['error']);
                this.socket?.close();
                return;
            }

            if (msg.messages && trackedRequest) {
                trackedRequest.filtered += msg.filtered;
                console.log(msg.type, msg.mode, msg.reqUUID, msg.filtered, msg.messages.length);
            }

            switch (msg.type) {
                case 'delta_trace': {
                    if (msg.messages) {
                        msg.messages.forEach((message: DeltaContent) => {
                            this.processDeltaTrace(message, msg.mode, msg.reqUUID);
                        });
                    } else if (msg.message) {
                        this.processDeltaTrace(JSON.parse(msg.message), msg.mode, msg.reqUUID);
                    }
                    break;
                }
                case 'action_trace': {
                    if (msg.messages) {
                        msg.messages.forEach((message: ActionContent) => {
                            this.processActionTrace(message, msg.mode, msg.reqUUID);
                        });
                    } else if (msg.message) {
                        this.processActionTrace(JSON.parse(msg.message), msg.mode, msg.reqUUID);
                    }
                    break;
                }
            }
        }
    }

    /**
     * Internal method to set up the socket connection
     * @private
     */
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
                    this.handleSocketMessage(msg);
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
        });
    }

    /**
     * Start session. Handlers should be defined before this method is called
     * @example
     * connect(() => {
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
     * @param uuid
     * @private
     */
    private processActionTrace(action: ActionContent, mode: "live" | "history", uuid: string) {
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
                uuid: uuid,
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
     * @param uuid
     * @private
     */
    private processDeltaTrace(delta: DeltaContent, mode: "live" | "history", uuid: string) {
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
                uuid: uuid,
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
                            const reqObj: SavedRequest = {
                                type: 'action',
                                live: false,
                                started: false,
                                req: request,
                                deliveryCounter: 0,
                                filtered: 0,
                                pendingMessages: [],
                            };
                            this.savedRequests.push(reqObj);
                            this.requestMap.set(response.reqUUID, reqObj);
                            response['startingBlock'] = request.start_from;
                        }
                        resolve(response);
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

                    if (!request.filters) {
                        request.filters = [];
                    }

                    this.socket.emit('delta_stream_request', request, (response: any) => {
                        this.debugLog(response);
                        if (response.status === 'OK') {
                            const reqObj = {
                                type: 'delta',
                                live: false,
                                started: false,
                                req: request,
                                deliveryCounter: 0,
                                filtered: 0,
                                pendingMessages: []
                            };
                            this.savedRequests.push(reqObj);
                            this.requestMap.set(response.reqUUID, reqObj);
                            response['startingBlock'] = request.start_from;
                            resolve(response);
                        }
                        resolve(response);
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
            if (typeof request.start_from) {

            }
            if (Number(request.start_from) < this.lastReceivedBlock) {
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
            listeners.forEach((listener: EventListener) => listener(data));
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
