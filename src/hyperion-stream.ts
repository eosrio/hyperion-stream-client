import {
    ActionContent,
    DeltaContent,
    IncomingData,
    MessageHandler,
    StreamActionsRequest,
    StreamDeltasRequest
} from "./interfaces.js";
import {Socket} from "socket.io-client";

function replaceMetaFields(content: ActionContent | DeltaContent) {
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
    private eventHandlers: Map<string, Set<MessageHandler>> = new Map();
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

    constructor(type: 'action' | 'delta', request: StreamActionsRequest | StreamDeltasRequest) {
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
                        resolve(response);
                    }
                    resolve(response);
                });
            } else {
                reject({status: false, error: 'socket was not created'});
            }
        });
    }

    on(event: string, handler: MessageHandler): this {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)?.add(handler);
        return this;
    }

    off(event: string, handler: MessageHandler): this {
        this.eventHandlers.get(event)?.delete(handler);
        return this;
    }

    once(event: string, handler: MessageHandler): this {
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

    private emit(event: string, data: any): void {
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

        // log the messages queue percentage filled for debugging
        if (this.messages.length > 0) {
            const queuePercentage = (this.messages.length / this.maxQueueSize) * 100;
            console.log(`Queue percentage filled: ${queuePercentage.toFixed(2)}%`);
        }
    }

    handleIncomingMessage(msg: any) {
        switch (msg.type) {
            case 'delta_trace': {
                if (msg.messages) {
                    msg.messages.forEach((message: DeltaContent) => {
                        this.processDeltaTrace(message, msg.mode);
                    });
                } else if (msg.message) {
                    this.processDeltaTrace(JSON.parse(msg.message), msg.mode);
                }
                break;
            }
            // case 'action_trace': {
            //     if (msg.messages) {
            //         msg.messages.forEach((message: ActionContent) => {
            //             this.processActionTrace(message, msg.mode, msg.reqUUID);
            //         });
            //     } else if (msg.message) {
            //         this.processActionTrace(JSON.parse(msg.message), msg.mode, msg.reqUUID);
            //     }
            //     break;
            // }
        }
    }

    // Keep for backward compatibility
    async* [Symbol.asyncIterator](): AsyncIterator<ActionContent | DeltaContent> {
        // This flag helps us track if the iterator is being actively consumed
        const isActive = true;

        while (isActive) {
            if (this.messages.length > 0) {
                const next = this.messages.shift();
                yield next;
            } else {
                // Wait for new messages to arrive
                yield await new Promise<any>((resolve) => {
                    this.resolveNext = resolve;
                });
            }
        }
    }

    /**
     * Internal method to parse a delta streaming trace
     * @param delta
     * @param mode
     * @param uuid
     * @private
     */
    private processDeltaTrace(delta: DeltaContent, mode: "live" | "history") {
        console.log(delta);

        replaceMetaFields(delta);

        this.emitMessage({
            irreversible: false,
            mode,
            type: 'delta',
            content: delta,
            uuid: this.reqUUID
        } as IncomingData<DeltaContent>);
    }

    // private processActionTrace(message: ActionContent, mode: any, reqUUID: any) {
    //
    // }
}
