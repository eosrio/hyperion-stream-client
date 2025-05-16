// noinspection JSUnusedGlobalSymbols

import {queue, QueueObject} from "async";
import {io, Socket} from "socket.io-client";

import {
    ActionContent,
    AsyncHandlerFunction,
    DeltaContent,
    EventListener,
    HyperionClientOptions,
    HyperionStreamEventMap,
    IncomingData,
    SavedRequest,
    StreamActionsRequest,
    StreamClientEvents,
    StreamDeltasRequest,
    TypedEventListener
} from "./interfaces.js";

import {trimTrailingSlash} from "./functions.js";
import {HyperionStream} from "hyperion-stream.js";

export class HyperionStreamClient {

    private socket?: Socket;
    private socketURL?: string;

    private lastReceivedBlock: number = 0;

    private dataQueue: QueueObject<IncomingData<ActionContent | DeltaContent>> | null = null;
    private options: HyperionClientOptions & Record<string, any> = {
        async: true,
        libStream: false,
        endpoint: ''
    };

    private libDataQueue: QueueObject<IncomingData<ActionContent | DeltaContent>> | null = null;
    private reversibleBuffer: IncomingData<ActionContent | DeltaContent>[] = [];

    private onDataAsync?: AsyncHandlerFunction<ActionContent | DeltaContent>;
    private onLibDataAsync?: AsyncHandlerFunction<ActionContent | DeltaContent>;

    online: boolean = false;
    savedRequests: SavedRequest[] = [];
    requestMap: Map<string, SavedRequest> = new Map();

    streams: HyperionStream<ActionContent | DeltaContent>[] = [];
    // map by request content (prevent duplicated streams)
    streamMap: Map<string, HyperionStream<ActionContent | DeltaContent>> = new Map();
    // map by request UUID
    streamMapByUUID: Map<string, HyperionStream<ActionContent | DeltaContent>> = new Map();

    eventListeners: Map<string, EventListener<ActionContent | DeltaContent>[]> = new Map();
    tempEventListeners: Map<string, EventListener<ActionContent | DeltaContent>[]> = new Map();
    lastConnectedId?: string;
    lastIrreversibleBlock = 0;
    libTimestamp: number = 0;
    libOffsetArray: number[] = [];

    // private disconnectedOnce = false;
    private libMonitoringTimeout: any | null = null;

    chainId: string = '';

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
            if (this.socketURL.endsWith('/stream')) {
                this.socketURL = this.socketURL.slice(0, -7);
            }
        } else {
            console.error('URL not informed');
        }
    }

    private pushToBuffer(task: IncomingData<ActionContent | DeltaContent>): void {
        if (this.options.libStream) {
            this.reversibleBuffer.push(task);
        }
    }

    private setupIncomingQueue(): void {
        // setup incoming queue
        this.dataQueue = queue((task: IncomingData<ActionContent | DeltaContent>, taskCallback) => {
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
            this.emit(StreamClientEvents.DRAIN);
        });

        this.dataQueue.empty(() => {
            this.emit(StreamClientEvents.EMPTY);
        });
    }

    private setupIrreversibleQueue(): void {
        // irreversible queue
        if (this.options.libStream) {
            this.libDataQueue = queue((task: IncomingData<ActionContent | DeltaContent>, callback) => {
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

        if (msg.block_num && this.options.libMonitor) {
            if (this.lastIrreversibleBlock > 0 && this.libTimestamp > 0) {
                this.libOffsetArray.push(Date.now() - this.libTimestamp);
                if (this.libOffsetArray.length > 10) {
                    this.libOffsetArray.shift();
                }
            }
            this.lastIrreversibleBlock = msg.block_num;
            this.libTimestamp = Date.now();
            if (this.libMonitoringTimeout) {
                clearTimeout(this.libMonitoringTimeout);
            }
            if (this.libOffsetArray.length > 1) {
                const averageOffset = this.libOffsetArray.reduce((a, b) => a + b, 0) / this.libOffsetArray.length;
                const nextLibLimit = averageOffset + 5000;
                if (this.lastIrreversibleBlock > 0) {
                    this.libMonitoringTimeout = setTimeout(() => {
                        console.error(`Last irreversible block is stuck for ${nextLibLimit}ms`);
                    }, nextLibLimit);
                }
            }
        }

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

        this.emit(StreamClientEvents.LIBUPDATE, msg);

        for (const request of this.savedRequests) {
            if (request.req.read_until && request.req.read_until !== 0) {
                if (request.req.read_until < msg.block_num) {
                    this.disconnect();
                }
            }
        }
    }

    private handleSocketMessage(msg: any, ackCallback?: (ackResponse: any) => void) {

        if (msg.targets) {
            msg.targets.forEach((target: string) => {
                this.streamMapByUUID.get(target)?.handleIncomingMessage(msg);
            });
            if (ackCallback) {
                ackCallback({status: true});
            }
        }

        if (msg.reqUUID) {
            this.debugLog(`[CLIENT] Received message for ${msg.reqUUID} (${msg.type})`);
            const trackedStream = this.streamMapByUUID.get(msg.reqUUID);
            if (!trackedStream) {
                console.log(`Untracked stream (${msg.reqUUID}), something went wrong!`);
                return;
            }
            this.streamMapByUUID.get(msg.reqUUID)?.handleIncomingMessage(msg, ackCallback);
        }

        //
        // if (!trackedStream) {
        //     console.log(`Untracked stream (${msg.reqUUID}), something went wrong!`);
        //     // this.requestServerCancel(msg.reqUUID);
        //     return;
        // }
        //
        // trackedStream.handleIncomingMessage(msg);

        // console.log("Stream ->>", trackedStream.started);
        // console.log("Request ->>", trackedRequest);

        // if (msg.type === 'trace_init') {
        //     if (trackedRequest) {
        //         if (!trackedRequest.firstReceivedBlock) {
        //             this.debugLog(`[${msg.reqUUID}] First Block received: ${msg.first_block} for ${msg.reqUUID} (${msg.results} docs)`);
        //             trackedRequest.firstReceivedBlock = msg.first_block;
        //             trackedRequest.historyResults = msg.results;
        //         } else {
        //             this.debugLog(`[${msg.reqUUID}] Fill request received, from block ${msg.first_block} for (${msg.results} docs)`);
        //             // increment total blocks in the case of a fill request
        //             trackedRequest.historyResults = trackedRequest.historyResults + msg.results;
        //         }
        //     } else {
        //         console.log(`Untracked stream (${msg.reqUUID}), something went wrong!`);
        //     }
        // }
        //
        // if ((this.onDataAsync || this.onLibDataAsync) && (msg.message || msg.messages)) {
        //     if (msg['error']) {
        //         console.log(msg['error']);
        //         this.socket?.close();
        //         return;
        //     }
        //
        //     if (msg.messages && trackedRequest) {
        //         trackedRequest.filtered += msg.filtered;
        //         console.log(msg.type, msg.mode, msg.reqUUID, msg.filtered, msg.messages.length);
        //     }
        //
        //     switch (msg.type) {
        //         case 'delta_trace': {
        //             if (msg.messages) {
        //                 msg.messages.forEach((message: DeltaContent) => {
        //                     this.processDeltaTrace(message, msg.mode, msg.reqUUID);
        //                 });
        //             } else if (msg.message) {
        //                 this.processDeltaTrace(JSON.parse(msg.message), msg.mode, msg.reqUUID);
        //             }
        //             break;
        //         }
        //         case 'action_trace': {
        //             if (msg.messages) {
        //                 msg.messages.forEach((message: ActionContent) => {
        //                     this.processActionTrace(message, msg.mode, msg.reqUUID);
        //                 });
        //             } else if (msg.message) {
        //                 this.processActionTrace(JSON.parse(msg.message), msg.mode, msg.reqUUID);
        //             }
        //             break;
        //         }
        //     }
        // }
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
                    reconnection: true,
                    reconnectionDelay: 1000,
                    transports: ["websocket"],
                    path: '/stream',
                    extraHeaders: {
                        'x-hyperion-client-last-id': this.lastConnectedId || '',
                    }
                });

                // if (!this.disconnectedOnce) {
                //     setTimeout(() => {
                //         this.socket?.disconnect();
                //         this.disconnectedOnce = true;
                //         setTimeout(() => {
                //             this.setupSocket();
                //         }, 2000);
                //     }, 3000);
                // }

                this.socket.on('connect', () => {
                    if (this.lastConnectedId) {
                        this.debugLog(`Reconnecting to ${this.socketURL} - sending previous socket id: ${this.lastConnectedId})`);
                        this.socket?.emit('reconnect', {last_id: this.lastConnectedId});
                    }
                    this.lastConnectedId = this.socket?.id;
                    this.debugLog(`Connected - socket id: ${this.socket?.id}`);
                    this.online = true;
                    this.emit(StreamClientEvents.CONNECT);
                    this.processPendingStreams();
                    resolve();
                });

                this.socket.on('resend_requests', async (args) => {
                    try {
                        if (args.last_id) {
                            // call streams to resend requests
                            this.debugLog(`Resending requests...`);
                            for (const stream of this.streams) {
                                if (this.socket) {
                                    this.streamMapByUUID.delete(stream.reqUUID);

                                    // continue from the last block received
                                    if (stream.lastBlockReceived > 0) {
                                        stream.request.start_from = stream.lastBlockReceived + 1;
                                    }

                                    const resp = await stream.start(this.socket);
                                    if (resp.status === 'OK') {
                                        this.streamMapByUUID.set(resp.reqUUID, stream);
                                    }
                                }
                            }
                        }
                    } catch (e: any) {
                        console.log(`Error resending requests: ${e.message}`);
                    }
                });

                this.socket.on('handshake', (msg) => {
                    this.debugLog('handshake', msg);
                    if (msg.chain_id) {
                        this.chainId = msg.chain_id;
                    }
                });

                this.socket.on('error', (msg) => {
                    console.log(msg);
                });

                this.socket.on('lib_update', this.handleLibUpdate.bind(this));

                this.socket.on('fork_event', (msg) => {
                    this.emit(StreamClientEvents.FORK, msg);
                });

                this.socket.on('message', (msg: any, ackCallback?: (data: any) => void) => {
                    this.handleSocketMessage(msg, ackCallback);
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
     * Start session
     * @example
     * connect(() => {
     *     console.log('Connection was successful!');
     * });
     */
    public async connect(): Promise<void> {
        if (!this.socketURL) {
            throw new Error('endpoint was not defined!');
        }
        this.setupIncomingQueue();
        this.setupIrreversibleQueue();
        this.debugLog(`Connecting to ${this.socketURL}...`);
        await this.setupSocket();
    }

    // /**
    //  * Internal method to parse an action streaming trace
    //  * @param action
    //  * @param mode
    //  * @param uuid
    //  * @private
    //  */
    // private processActionTrace(action: ActionContent, mode: "live" | "history", uuid: string) {
    //     const metaKey = '@' + action['act'].name;
    //     if (action[metaKey]) {
    //         const parsedData = action[metaKey];
    //         Object.keys(parsedData).forEach((key) => {
    //             if (!action['act']['data']) {
    //                 action['act']['data'] = {};
    //             }
    //             action['act']['data'][key] = parsedData[key];
    //         });
    //         delete action[metaKey];
    //     }
    //     if (this.dataQueue) {
    //         this.dataQueue.push({
    //             uuid: uuid,
    //             type: 'action',
    //             mode: mode,
    //             content: action,
    //             irreversible: false
    //         }).catch(console.log);
    //         this.lastReceivedBlock = action['block_num'];
    //     }
    // }

    // /**
    //  * Internal method to parse a delta streaming trace
    //  * @param delta
    //  * @param mode
    //  * @param uuid
    //  * @private
    //  */
    // private processDeltaTrace(delta: DeltaContent, mode: "live" | "history", uuid: string) {
    //     let metaKey = '@' + delta['table'];
    //     if (delta[metaKey + '.data']) {
    //         metaKey = metaKey + '.data'
    //     }
    //     if (delta[metaKey]) {
    //         const parsedData = delta[metaKey];
    //         Object.keys(parsedData).forEach((key) => {
    //             if (!delta['data']) {
    //                 delta['data'] = {};
    //             }
    //             delta['data'][key] = parsedData[key];
    //         });
    //         delete delta[metaKey];
    //     }
    //     if (this.dataQueue) {
    //         this.dataQueue.push({
    //             uuid: uuid,
    //             type: 'delta',
    //             mode: mode,
    //             content: delta,
    //             irreversible: false
    //         }).catch(console.log);
    //         this.lastReceivedBlock = delta['block_num'];
    //     }
    // }

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
     * Internal method to create a new stream request
     * @param request
     * @param type
     * @private
     */
    private async createRequest<T extends ActionContent | DeltaContent>(request: StreamActionsRequest | StreamDeltasRequest, type: "action" | "delta"): Promise<HyperionStream<T>> {
        // create stream instance
        const stream = new HyperionStream<T>(this, type, request);
        // get the request hash to identify unique requests
        const key = await stream.streamRequestHash();
        if (this.streamMap.has(key)) {
            throw new Error('Similar stream request already exists');
        }
        // save the stream
        this.streams.push(stream);
        // index the stream by request hash
        this.streamMap.set(key, stream);
        // check if the client socket is connected
        if (this.socket && this.socket.connected) {
            // the socket is already connected, attach the socket to start the stream
            const resp = await stream.start(this.socket);
            if (resp.status === 'OK') {
                this.streamMapByUUID.set(resp.reqUUID, stream);
            }
            return stream;
        } else {
            return stream;
        }
    }

    /**
     * Send a request for a filtered action traces stream
     * @param {StreamActionsRequest} request - Action Request Options
     */
    async streamActions(request: StreamActionsRequest): Promise<HyperionStream<ActionContent>> {
        return this.createRequest<ActionContent>(request, 'action');
    }

    /**
     * Send a request for a filtered delta traces stream
     * @param {StreamDeltasRequest} request - Delta Request Options
     */
    async streamDeltas(request: StreamDeltasRequest): Promise<HyperionStream<DeltaContent>> {
        return this.createRequest<DeltaContent>(request, 'delta');
    }

    debugLog(...args: any[]): void {
        if (this.options.debug) {
            console.log('[hyperion:debug]', ...args);
        }
    }

    private emit<K extends keyof HyperionStreamEventMap<ActionContent | DeltaContent>>(event: K, data?: HyperionStreamEventMap<ActionContent | DeltaContent>[K]): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach((listener: EventListener<ActionContent | DeltaContent>) => listener(data));
        }
        const tempListeners = this.tempEventListeners.get(event);
        if (tempListeners && tempListeners.length > 0) {
            const listener = tempListeners.shift();
            if (listener) {
                listener(data);
            }
        }
    }

    public once<K extends keyof HyperionStreamEventMap<ActionContent | DeltaContent>>(event: K, listener: TypedEventListener<ActionContent | DeltaContent, K>): void {
        if (typeof listener !== 'function') {
            throw new Error('Event listener must be a function');
        }
        if (!this.tempEventListeners.has(event)) {
            this.tempEventListeners.set(event, [listener as EventListener<ActionContent | DeltaContent>]);
        } else {
            this.tempEventListeners.get(event)?.push(listener as EventListener<ActionContent | DeltaContent>);
        }
    }

    public on(event: StreamClientEvents | string, listener: EventListener<ActionContent | DeltaContent>): void {
        if (typeof listener !== 'function') {
            throw new Error('Event listener must be a function');
        }
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, [listener]);
        } else {
            this.eventListeners.get(event)?.push(listener);
        }
    }

    public off(event: StreamClientEvents | string, listener: EventListener<ActionContent | DeltaContent>): void {
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

    private async processPendingStreams() {
        if (!this.socket) {
            return;
        }
        for (let stream of this.streams) {
            if (!stream.started) {
                const resp = await stream.start(this.socket);
                if (resp.status === 'OK') {
                    this.streamMapByUUID.set(resp.reqUUID, stream);
                }
            } else {
                console.log('Stream already started:', stream.reqUUID);
                if (stream.request.replayOnReconnect) {
                    console.log('Replaying stream:', stream.reqUUID);
                    this.streamMapByUUID.delete(stream.reqUUID);
                    const resp = await stream.start(this.socket);
                    if (resp.status === 'OK') {
                        this.streamMapByUUID.set(resp.reqUUID, stream);
                    }
                }
            }
        }
    }

    stop(reqUUID: string) {
        console.log('Stopping stream:', reqUUID);
        this.requestServerCancel(reqUUID);
    }

    private requestServerCancel(reqUUID: string) {
        if (this.socket) {
            this.socket.emit('cancel_stream_request', {reqUUID}, (response: any) => {
                console.log('Cancel response:', response);
                const stream = this.streamMapByUUID.get(reqUUID);
                if (stream) {

                }
                this.streamMapByUUID.delete(reqUUID);
                this.streams.splice(this.streams.findIndex(s => s.reqUUID === reqUUID), 1);
                console.log('Stream removed from map:', reqUUID);
                console.log(this.streams.map(s => s.reqUUID));
                // remove from streamMap
            });
        } else {
            console.error('Socket not connected');
        }
    }
}
