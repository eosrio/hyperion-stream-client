import {
    ActionContent,
    DeltaContent, EventMap, HyperionStreamEvent,
    IncomingData,
    MessageHandler,
    StreamActionsRequest,
    StreamDeltasRequest
} from "./interfaces.js";
import {Socket} from "socket.io-client";
import {HyperionStreamClient} from "./hyperion-stream-client.js";

function replaceMetaFields(content: ActionContent | DeltaContent) {

    // Determine if the content is a delta or action
    if (content.table) {
        let metaKey = '@' + content.table;
        if (content[metaKey + '.data']) {
            metaKey = metaKey + '.data'
        }
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!content.data) {
                    content.data = {};
                }
                content.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    } else if (content.act) {
        const metaKey = '@' + content.act.name;
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            Object.keys(parsedData).forEach((key) => {
                if (!content.act.data) {
                    content.act.data = {};
                }
                content.act.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    }
}

export class HyperionStream {

    private eventHandlers: Map<string, Set<MessageHandler<any>>> = new Map();
    private messages: any[] = []; // Keep for backward compatibility
    private resolveNext?: (value: IteratorResult<any>) => void;
    private isIteratorActive: boolean = false; // Track if iterator is being consumed
    private maxQueueSize: number = 10; // Default max queue size when iterator isn't used
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

    constructor(
        client: HyperionStreamClient,
        type: 'action' | 'delta',
        request: StreamActionsRequest | StreamDeltasRequest
    ) {
        this.clientRef = client;
        this.request = request;
        this.type = type;
    }

    async start(socket: Socket): Promise<any> {
        return await new Promise((resolve, reject) => {
            if (socket) {
                socket.emit('delta_stream_request', this.request, (response: any) => {
                    console.log(response);
                    if (response.status === 'OK') {
                        this.live = false;
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

    handleIncomingMessage(msg: HyperionStreamEvent) {
        // console.log(`Incoming message: ${msg.type} - ${msg.mode}`);
        switch (msg.type) {
            case 'delta_trace': {
                this.processDeltaTrace(msg);
                break;
            }
            case 'action_trace': {
                this.processActionTrace(msg);
                break;
            }
        }
    }

    async* [Symbol.asyncIterator](): AsyncIterator<ActionContent | DeltaContent> {
        const isActive = true;
        while (isActive) {
            if (this.messages.length > 0) {
                const next = this.messages.shift();
                yield next;
            } else {
                yield await new Promise<any>((resolve) => {
                    this.resolveNext = resolve;
                });
            }
        }
    }

    /**
     * Internal method to parse a delta streaming trace
     * @private
     * @param streamEvent
     */
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
            this.emitMessage({
                irreversible: false,
                mode: streamEvent.mode,
                type: 'delta',
                content: delta,
                uuid: this.reqUUID
            } as IncomingData<DeltaContent>);
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
