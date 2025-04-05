export class HyperionStream {
    eventHandlers = new Map();
    messages = []; // Keep for backward compatibility
    resolveNext;
    isIteratorActive = false; // Track if iterator is being consumed
    maxQueueSize = 10; // Default max queue size when iterator isn't used
    request;
    type;
    live = false;
    firstReceivedBlock = 0;
    historyResults = 0;
    filtered = 0;
    deliveryCounter = 0;
    liveQueueStartTimer;
    pendingMessages = [];
    started = false;
    reqUUID = '';
    constructor(type, request) {
        this.request = request;
        this.type = type;
    }
    async start(socket) {
        return await new Promise((resolve, reject) => {
            if (socket) {
                socket.emit('delta_stream_request', this.request, (response) => {
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
            }
            else {
                reject({ status: false, error: 'socket was not created' });
            }
        });
    }
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }
        this.eventHandlers.get(event)?.add(handler);
        return this;
    }
    off(event, handler) {
        this.eventHandlers.get(event)?.delete(handler);
        return this;
    }
    once(event, handler) {
        const onceHandler = (data) => {
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
    setMaxQueueSize(size) {
        if (size > 0) {
            this.maxQueueSize = size;
        }
        return this;
    }
    emit(event, data) {
        const handlers = this.eventHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                }
                catch (error) {
                    console.error('Error in event handler:', error);
                }
            });
        }
    }
    emitMessage(msg) {
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
        }
        else if (!this.isIteratorActive) {
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
    handleIncomingMessage(msg) {
        switch (msg.type) {
            case 'delta_trace': {
                if (msg.messages) {
                    msg.messages.forEach((message) => {
                        this.processDeltaTrace(message, msg.mode);
                    });
                }
                else if (msg.message) {
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
    async *[Symbol.asyncIterator]() {
        // This flag helps us track if the iterator is being actively consumed
        const isActive = true;
        while (isActive) {
            if (this.messages.length > 0) {
                const next = this.messages.shift();
                yield next;
            }
            else {
                // Wait for new messages to arrive
                yield await new Promise((resolve) => {
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
        this.emitMessage({
            irreversible: false,
            mode,
            type: 'delta',
            content: delta,
            uuid: this.reqUUID
        });
    }
}
//# sourceMappingURL=hyperion-stream.js.map