import {
    ActionContent,
    DeltaContent,
    EventMap,
    HyperionStreamEvent,
    IncomingData,
    MessageHandler,
    StreamActionsRequest,
    StreamDeltasRequest
} from "./interfaces.js";
import {Socket} from "socket.io-client";
import {HyperionStreamClient} from "./hyperion-stream-client.js";
import {replaceMetaFields} from "./functions.js";
import {queue, QueueObject} from "async";


export class HyperionStream {

    private eventHandlers: Map<string, Set<MessageHandler<any>>> = new Map();
    private messages: any[] = []; // Keep for backward compatibility
    private resolveNext?: (value: ActionContent | DeltaContent | null) => void;
    private isIteratorActive: boolean = false; // Track if iterator is being consumed
    private maxQueueSize: number = 1000; // Default max queue size when iterator isn't used
    request: StreamActionsRequest | StreamDeltasRequest;
    type: 'action' | 'delta';
    live: boolean = false;
    firstReceivedBlock: number = 0;
    historyResults: number = 0;
    filtered: number = 0;
    deliveryCounter: number = 0;
    liveQueueStartTimer?: number;
    pendingMessages: IncomingData<ActionContent | DeltaContent>[] = [];
    started: boolean = false;
    reqUUID = '';
    private clientRef: HyperionStreamClient;
    lastBlockReceived: number = 0;

    // live data queue
    private liveQueue: QueueObject<IncomingData<ActionContent | DeltaContent>>;
    private currentAckCallback?: (ackResponse: any) => void;

    constructor(
        client: HyperionStreamClient,
        type: 'action' | 'delta',
        request: StreamActionsRequest | StreamDeltasRequest
    ) {
        this.clientRef = client;
        this.request = request;
        this.type = type;
        this.liveQueue = queue((task: IncomingData<ActionContent | DeltaContent>, taskCallback) => {
            this.clientRef.debugLog('Processing task:', task.type, task.mode);
            this.emitMessage(task);
            taskCallback();
        });
    }

    // get stream hash
    async streamRequestHash(): Promise<string> {
        let payload = `${this.type}:`
        if (this.type === 'action') {
            const req = this.request as StreamActionsRequest;
            payload += `${req.contract}:${req.action}:${req.account}:`;
        } else if (this.type === 'delta') {
            const req = this.request as StreamDeltasRequest;
            payload += `${req.code}:${req.table}:${req.scope}:${req.payer}:`;
        }
        payload += `${this.request.start_from}:${this.request.read_until}:${this.request.filter_op}`;
        if (this.request.filters && this.request.filters.length > 0) {
            payload += JSON.stringify(this.request.filters);
        }
        // get the hash of the payload
        const msg = new TextEncoder().encode(payload);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msg);
        const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
         // convert bytes to hex string
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async start(socket: Socket): Promise<any> {

        if (this.request.replayOnReconnect && this.started) {
            this.request.start_from = this.lastBlockReceived + 1;
        }

        console.log('Starting stream:', this.request);

        return await new Promise((resolve, reject) => {
            if (socket) {

                // flag the request mode as live or history
                // pause the live queue if the request is for history
                this.live = !(this.request.start_from && parseInt(this.request.start_from.toString()) !== 0);

                if (!this.live) {
                    this.liveQueue.pause();
                }

                if (this.request.start_from && parseInt(this.request.start_from.toString()) !== 0) {
                    if (this.request.read_until && parseInt(this.request.read_until.toString()) !== 0) {
                        console.log(`Requesting deltas from block: ${this.request.start_from} until: ${this.request.read_until}`);
                    }
                }

                socket.emit(`${this.type}_stream_request`, this.request, (response: any) => {
                    if (response.status === 'OK') {
                        this.started = true;
                        this.reqUUID = response.reqUUID;
                        this.deliveryCounter = 0;
                        this.filtered = 0;
                        this.pendingMessages = [];
                        response['startingBlock'] = this.request.start_from;
                        this.emit('start', response);
                        resolve(response);
                    } else {
                        console.error('Error in stream request:', response);
                        this.emit('error', response);
                        reject(response);
                    }
                });
            } else {
                reject({status: false, error: 'socket was not created'});
            }
        });
    }

    stop() {
        if (this.started) {
            this.clientRef.stop(this.reqUUID);
            this.started = false;
        }
    }

    on<K extends keyof EventMap>(event: K, handler: MessageHandler<EventMap[K]>): this {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)?.add(handler);
        return this;
    }

    off<K extends keyof EventMap>(event: K, handler: MessageHandler<EventMap[K]>):
        this {
        this.eventHandlers.get(event)?.delete(handler);
        return this;
    }

    once<K extends keyof EventMap>(event: K, handler: MessageHandler<EventMap[K]>):
        this {
        const onceHandler = (data: any) => {
            handler(data);
            this.off(event, onceHandler);
        };
        this.on(event, onceHandler);
        return this;
    }

    /**
     * Set the maximum size for the message queue when the AsyncIterator isn't being used
     * @param size - Maximum number of messages to keep in the queue
     */
    setMaxQueueSize(size: number): this {
        if (size > 0) {
            this.maxQueueSize = size;
        }
        return this;
    }

    private emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error('Error in event handler:', error);
                }
            });
        }
    }

    emitMessage(msg: IncomingData<ActionContent | DeltaContent>): void {

        // live messages received during history replay must be enqueued
        // console.log(`Incoming message: ${msg.type} - ${msg.mode} ~ Global Live: ${this.live}`);

        // record the last block number
        if (msg.content.block_num) {
            this.lastBlockReceived = msg.content.block_num;
        }

        // Emit the event
        this.emit('message', msg);

        // Maintain backward compatibility with the iterator approach
        this.messages.push(msg);

        // If the iterator is active and waiting for data, resolve its promise
        if (this.resolveNext) {
            const next = this.messages.shift();
            const resolveFunc = this.resolveNext;
            this.resolveNext = undefined;
            resolveFunc(next);
            // Mark that the iterator is being used
            this.isIteratorActive = true;
        } else if (!this.isIteratorActive) {
            // If the iterator isn't being used, limit the size of the messages array
            // to prevent memory leaks when only event handlers are used
            while (this.messages.length > this.maxQueueSize) {
                this.messages.shift();
            }
        }
    }

    handleIncomingMessage(msg: HyperionStreamEvent, ackCallback?: (ackResponse: any) => void) {
        this.clientRef.debugLog(`[STREAM] Incoming message: ${msg.type} - ${msg.mode}`);
        if (typeof ackCallback === 'function') {
            this.currentAckCallback = ackCallback;
        }

        switch (msg.type) {
            case 'trace_init': {
                console.log(msg);
                break;
            }
            case 'action_trace': {
                this.processActionTrace(msg);
                break;
            }
            case 'delta_trace': {
                this.processDeltaTrace(msg);
                break;
            }
            case 'delta_history_end': {
                this.clientRef.debugLog('History end');
                if (!this.request.ignore_live) {
                    this.liveQueue.resume();
                } else {
                    this.isIteratorActive = false;
                    if (this.resolveNext) {
                        this.resolveNext(null);
                    }
                }
                break;
            }
        }
    }

    async* [Symbol.asyncIterator](): AsyncIterator<ActionContent | DeltaContent | null> {
        const isActive = true;
        while (isActive) {
            if (this.messages.length > 0) {
                yield this.messages.shift();
            } else {
                // If the iterator is not being used, wait for the next message
                // When the queue is empty we can call the ack callback
                if (this.currentAckCallback) {
                    this.currentAckCallback({status: true});
                    this.currentAckCallback = undefined;
                }
                yield await new Promise<any>((resolve) => {
                    this.resolveNext = resolve;
                });
            }
        }
    }

    private processDeltaTrace(streamEvent: HyperionStreamEvent) {

        if (streamEvent.messages && streamEvent.messages.length > 0) {
            for (const delta of streamEvent.messages) {
                replaceMetaFields(delta);
                this.emitMessage({
                    irreversible: false,
                    mode: streamEvent.mode,
                    type: 'delta',
                    content: delta,
                    uuid: this.reqUUID
                } as IncomingData<DeltaContent>);
            }
        } else if (streamEvent.message) {
            const delta = JSON.parse(streamEvent.message);
            replaceMetaFields(delta);
            this.clientRef.debugLog(`Enqueuing LIVE delta trace: ${delta.block_num}`);
            this.liveQueue.push({
                irreversible: false,
                mode: streamEvent.mode,
                type: 'delta',
                content: delta,
                uuid: this.reqUUID
            } as IncomingData<DeltaContent>).catch(reason => {
                console.error('Error processing delta trace:', reason);
            }).then((value) => {
                this.clientRef.debugLog(`Dequeued LIVE delta trace`, value);
            });
        }
    }

    /**
     * Internal method to parse an action streaming trace
     * @param streamEvent
     * @private
     */
    private processActionTrace(streamEvent: HyperionStreamEvent) {
        if (streamEvent.messages && streamEvent.messages.length > 0) {
            for (const action of streamEvent.messages) {
                replaceMetaFields(action);
                this.emitMessage({
                    irreversible: false,
                    mode: streamEvent.mode,
                    type: 'action',
                    content: action,
                    uuid: this.reqUUID
                } as IncomingData<ActionContent>);
            }
        } else if (streamEvent.message) {
            const action = JSON.parse(streamEvent.message);
            replaceMetaFields(action);
            this.emitMessage({
                irreversible: false,
                mode: streamEvent.mode,
                type: 'action',
                content: action,
                uuid: this.reqUUID
            } as IncomingData<ActionContent>);
        }
    }
}
