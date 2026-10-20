import type { Socket } from 'socket.io-client';
import type {
    EventMap,
    HyperionStreamEvent,
    IncomingData,
    MessageHandler,
    StreamRequestTypes,
    StreamResponseTypes,
    StreamTypes
} from './interfaces.js';
import type { HyperionStreamClient } from './hyperion-stream-client.js';
import { replaceMetaFields, toStreamError } from './functions.js';

/** Owns a subscription's ordering, bounded queues, and consumer lifecycle. */
export class HyperionStream<T extends StreamResponseTypes> {
    private handlers = new Map<string, Set<MessageHandler<any>>>();
    private messages: IncomingData<T>[] = [];
    private liveMessages: IncomingData<T>[] = [];
    private waiting?: {
        resolve: (value: IteratorResult<IncomingData<T>>) => void;
        reject: (error: Error) => void;
    };
    private iteratorActive = false;
    private messageListenerAttached = false;
    private ended = false;
    private failure?: Error;
    private historyComplete = false;
    private startPromise?: Promise<any>;
    private abortStart?: (error: Error) => void;
    private startedSocketId?: string;
    private maxQueueSize: number;
    readonly request: StreamRequestTypes;
    readonly type: StreamTypes;
    requestHash = '';
    reqUUID = '';
    started = false;
    live = false;
    firstReceivedBlock = 0;
    lastReceivedBlockNum = 0;
    historyResults = 0;
    deliveryCounter = 0;
    filtered = 0;

    constructor(
        private clientRef: HyperionStreamClient,
        type: StreamTypes,
        request: StreamRequestTypes
    ) {
        this.type = type;
        this.request = structuredClone(request);
        this.maxQueueSize = clientRef.queueSize;
    }

    async streamRequestHash(): Promise<string> {
        // Canonical identity includes delivery flags and does not require browser Web Crypto.
        const canonical = (value: any): any =>
            Array.isArray(value)
                ? value.map(canonical)
                : value && typeof value === 'object'
                  ? Object.fromEntries(
                        Object.keys(value)
                            .sort()
                            .filter((key) => value[key] !== undefined)
                            .map((key) => [key, canonical(value[key])])
                    )
                  : value;
        this.requestHash = JSON.stringify([this.type, canonical(this.request)]);
        return this.requestHash;
    }

    async start(socket: Socket, force = false): Promise<any> {
        if (this.ended) throw new Error('Stream has ended');
        if (this.startPromise) return this.startPromise;
        if (!force && this.startedSocketId === socket.id && this.started)
            return { status: 'OK', reqUUID: this.reqUUID };
        const request = structuredClone(this.request);
        // A block may contain many records: +1 skips the rest of a partially received block.
        if (this.started && request.replayOnReconnect && this.lastReceivedBlockNum > 0)
            request.start_from = this.lastReceivedBlockNum;
        this.live = !request.start_from;
        this.historyComplete = false;
        this.liveMessages = [];
        this.startPromise = new Promise((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error, response?: any) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                this.abortStart = undefined;
                if (error) reject(error);
                else resolve(response);
            };
            const timer = setTimeout(
                () =>
                    finish(
                        new Error(
                            `Stream request timed out after ${this.clientRef.requestTimeout}ms`
                        )
                    ),
                this.clientRef.requestTimeout
            );
            this.abortStart = (error) => finish(error);
            socket.emit(`${this.type}_stream_request`, request, (response: any) => {
                if (settled) {
                    if (response?.status === 'OK' && response.reqUUID)
                        this.clientRef.cancelRemote(response.reqUUID);
                    return;
                }
                if (
                    response?.status !== 'OK' ||
                    typeof response.reqUUID !== 'string' ||
                    !response.reqUUID
                ) {
                    finish(toStreamError(response?.error ?? response ?? 'Stream request rejected'));
                    return;
                }
                // Register synchronously: history packets can follow the acknowledgement immediately.
                this.clientRef.registerStream(this, response.reqUUID);
                this.started = true;
                this.startedSocketId = socket.id;
                const result = { ...response, startingBlock: request.start_from ?? 0 };
                finish(undefined, result);
                this.emit('start', result);
                if (this.live && request.ignore_live) this.finish();
            });
        });
        try {
            return await this.startPromise;
        } finally {
            this.startPromise = undefined;
        }
    }

    stop(): void {
        this.finish();
    }
    fail(error: Error): void {
        this.finish(error);
    }
    handleDisconnect(): void {
        this.startedSocketId = undefined;
        const error = new Error('Stream request interrupted by disconnect');
        error.name = 'StreamDisconnectedError';
        this.abortStart?.(error);
    }

    private finish(error?: Error): void {
        if (this.ended) return;
        this.ended = true;
        this.started = false;
        this.failure = error;
        this.abortStart?.(error ?? new Error('Stream stopped'));
        this.liveMessages = [];
        this.clientRef.removeStream(this);
        if (this.waiting) {
            const waiting = this.waiting;
            this.waiting = undefined;
            if (error) waiting.reject(error);
            else waiting.resolve({ done: true, value: undefined });
        }
        if (error) this.emit('error', error);
        this.emit('end', undefined);
    }

    on<K extends keyof EventMap<T>>(event: K, handler: MessageHandler<EventMap<T>[K]>): this {
        if (typeof handler !== 'function') throw new TypeError('Event listener must be a function');
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event)!.add(handler);
        if ((event === 'end' && this.ended) || (event === 'historyEnd' && this.historyComplete)) {
            try {
                handler(undefined as EventMap<T>[K]);
            } catch (error) {
                this.clientRef.reportError(error);
            }
        }
        if (event === 'error' && this.failure) {
            try {
                handler(this.failure as EventMap<T>[K]);
            } catch (error) {
                this.clientRef.reportError(error);
            }
        }
        // The server can deliver an entire batch in the setup ACK's transport frame.
        if (event === 'message' && !this.messageListenerAttached) {
            this.messageListenerAttached = true;
            if (!this.failure)
                for (const message of [...this.messages]) this.emit('message', message);
        }
        return this;
    }
    off<K extends keyof EventMap<T>>(event: K, handler: MessageHandler<EventMap<T>[K]>): this {
        this.handlers.get(event)?.delete(handler);
        return this;
    }
    once<K extends keyof EventMap<T>>(event: K, handler: MessageHandler<EventMap<T>[K]>): this {
        const onceHandler = (data: EventMap<T>[K]) => {
            this.off(event, onceHandler);
            handler(data);
        };
        return this.on(event, onceHandler);
    }
    setMaxQueueSize(size: number): this {
        if (!Number.isSafeInteger(size) || size <= 0)
            throw new RangeError('Queue size must be a positive integer');
        this.maxQueueSize = size;
        return this;
    }
    private emit<K extends keyof EventMap<T>>(event: K, data: EventMap<T>[K]): void {
        for (const handler of [...(this.handlers.get(event) ?? [])]) {
            try {
                handler(data);
            } catch (error) {
                this.clientRef.reportError(error);
            }
        }
    }

    emitMessage(message: IncomingData<T>): void {
        if (this.ended) return;
        const eventConsumer =
            this.handlers.get('message')?.size ||
            this.clientRef.hasDataListeners(message.irreversible ? 'libData' : 'data');
        if (
            (this.iteratorActive || !eventConsumer) &&
            !this.waiting &&
            this.messages.length >= this.maxQueueSize
        )
            throw new Error(`Stream iterator queue exceeded ${this.maxQueueSize} messages`);
        this.firstReceivedBlock ||= message.content.block_num;
        this.lastReceivedBlockNum = Math.max(this.lastReceivedBlockNum, message.content.block_num);
        this.clientRef.lastReceivedBlockNum = Math.max(
            this.clientRef.lastReceivedBlockNum,
            this.lastReceivedBlockNum
        );
        this.deliveryCounter++;
        if (message.mode === 'history') this.historyResults++;
        if (this.waiting) {
            const waiting = this.waiting;
            this.waiting = undefined;
            waiting.resolve({ done: false, value: message });
        } else {
            this.messages.push(message);
            // Event-only subscriptions retain a bounded cache for a later iterator.
            if (!this.iteratorActive && this.messages.length > this.maxQueueSize)
                this.messages.shift();
        }
        this.emit('message', message);
        this.clientRef.emit(message.irreversible ? 'libData' : 'data', message);
    }

    handleIncomingMessage(event: HyperionStreamEvent<T>, ack?: (response: any) => void): boolean {
        if (this.ended) {
            ack?.({ status: true });
            return true;
        }
        try {
            if (event.error) throw toStreamError(event.error);
            if (event.type === 'history_end') {
                this.historyComplete = true;
                this.live = true;
                this.emit('historyEnd', undefined);
                if (!this.request.ignore_live)
                    for (const message of this.liveMessages.splice(0))
                        this.clientRef.deliver(this, message);
                this.completeHistory();
            } else if (event.type === 'error') throw new Error('Stream error');
            else if (event.type === 'action_trace' || event.type === 'delta_trace') {
                const records = event.messages ?? [this.decode(event.message)];
                for (const record of records) {
                    if (!record || !Number.isSafeInteger(record.block_num) || record.block_num < 0)
                        throw new Error('Invalid stream record: missing block_num');
                    const content = structuredClone(record);
                    replaceMetaFields(content);
                    const message: IncomingData<T> = {
                        type: this.type,
                        mode: event.mode,
                        content,
                        uuid: this.reqUUID,
                        irreversible: false
                    };
                    if (event.mode === 'live' && this.request.ignore_live) continue;
                    if (event.mode === 'live' && !this.live) {
                        if (this.liveMessages.length >= this.maxQueueSize)
                            throw new Error('History-to-live queue overflow');
                        this.liveMessages.push(message);
                    } else this.clientRef.deliver(this, message);
                }
            }
            ack?.({ status: true });
            return true;
        } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.fail(failure);
            this.clientRef.reportError(failure);
            ack?.({ status: false, error: failure.message });
            return false;
        }
    }

    private decode(message: HyperionStreamEvent<T>['message']): T {
        if (typeof message === 'string') return JSON.parse(message);
        if (message instanceof ArrayBuffer || ArrayBuffer.isView(message))
            return JSON.parse(new TextDecoder().decode(message));
        throw new Error('Invalid stream payload');
    }
    completeHistory(): void {
        if (
            this.historyComplete &&
            this.request.ignore_live &&
            !this.clientRef.hasBufferedData(this)
        )
            this.finish();
    }
    handleFork(startingBlock: number): void {
        this.messages = this.messages.filter(
            (message) => message.content.block_num < startingBlock
        );
        this.liveMessages = this.liveMessages.filter(
            (message) => message.content.block_num < startingBlock
        );
        this.lastReceivedBlockNum = Math.min(this.lastReceivedBlockNum, startingBlock - 1);
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<IncomingData<T>> {
        if (this.iteratorActive) throw new Error('A stream supports one active iterator');
        this.iteratorActive = true;
        const stream = this;
        return {
            [Symbol.asyncIterator]() {
                return this;
            },
            next(): Promise<IteratorResult<IncomingData<T>>> {
                if (stream.failure) return Promise.reject(stream.failure);
                const message = stream.messages.shift();
                if (message) return Promise.resolve({ done: false, value: message });
                if (stream.ended) return Promise.resolve({ done: true, value: undefined });
                if (stream.waiting)
                    return Promise.reject(new Error('Concurrent iterator reads are not supported'));
                return new Promise((resolve, reject) => {
                    stream.waiting = { resolve, reject };
                });
            },
            return(): Promise<IteratorResult<IncomingData<T>>> {
                stream.messages = [];
                stream.stop();
                return Promise.resolve({ done: true, value: undefined });
            },
            throw(error: unknown): Promise<IteratorResult<IncomingData<T>>> {
                const failure = error instanceof Error ? error : new Error(String(error));
                stream.fail(failure);
                return Promise.reject(failure);
            }
        };
    }
}
