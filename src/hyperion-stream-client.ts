import { io, type Socket } from 'socket.io-client';
import type {
    ActionContent,
    DeltaContent,
    ForkData,
    HyperionClientOptions,
    HyperionStreamEventMap,
    IncomingData,
    LIBUpdate,
    StreamActionsRequest,
    StreamDeltasRequest,
    StreamResponseTypes,
    StreamTypeMap,
    TypedEventListener
} from './interfaces.js';
import { HyperionStream } from './hyperion-stream.js';
import { invokeObserver, toStreamError } from './functions.js';

export class HyperionStreamClient {
    private socket?: Socket;
    private socketURL = '';
    private options: HyperionClientOptions;
    private connectionPromise?: Promise<void>;
    private abortConnect?: (error: Error) => void;
    private reversibleBuffer: { stream: HyperionStream<any>; message: IncomingData<any> }[] = [];
    private libMonitoringTimeout?: ReturnType<typeof setTimeout>;
    private handshakeTimeout?: ReturnType<typeof setTimeout>;
    online = false;
    chainId = '';
    lastReceivedBlockNum = 0;
    lastIrreversibleBlock = 0;
    lastConnectedId?: string;
    libTimestamp = 0;
    libOffsetArray: number[] = [];
    streams: HyperionStream<StreamResponseTypes>[] = [];
    streamMap = new Map<string, HyperionStream<StreamResponseTypes>>();
    streamMapByUUID = new Map<string, HyperionStream<StreamResponseTypes>>();
    private listeners = new Map<string, Set<(data: any) => void>>();
    private onceListeners = new Map<string, Set<(data: any) => void>>();

    constructor(options: HyperionClientOptions) {
        if (!options || typeof options !== 'object') throw new TypeError('Invalid options');
        this.options = {
            ...options,
            connectionTimeout: options.connectionTimeout ?? 5000,
            requestTimeout: options.requestTimeout ?? 10000,
            maxQueueSize: options.maxQueueSize ?? 1000,
            maxReversibleBufferSize: options.maxReversibleBufferSize ?? 10000
        };
        for (const key of [
            'connectionTimeout',
            'requestTimeout',
            'maxQueueSize',
            'maxReversibleBufferSize'
        ] as const) {
            if (!Number.isSafeInteger(this.options[key]) || this.options[key]! <= 0)
                throw new RangeError(`${key} must be a positive integer`);
        }
        this.setEndpoint(options.endpoint);
    }
    get lastBlockNum(): number {
        return this.lastReceivedBlockNum;
    }
    get queueSize(): number {
        return this.options.maxQueueSize!;
    }
    get requestTimeout(): number {
        return this.options.requestTimeout!;
    }

    setEndpoint(endpoint: string): void {
        if (this.socket?.active || this.online)
            throw new Error('Disconnect before changing endpoint');
        let url: URL;
        try {
            url = new URL(endpoint);
        } catch {
            throw new TypeError('Invalid endpoint URL');
        }
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
            throw new TypeError('Invalid endpoint protocol');
        if (url.username || url.password || url.search || url.hash)
            throw new TypeError('Endpoint must not contain credentials, query or fragment');
        this.socketURL = url
            .toString()
            .replace(/\/+$/, '')
            .replace(/\/stream$/, '');
        this.options.endpoint = this.socketURL;
    }

    /** Concurrent callers share a socket; completion includes the chain handshake. */
    async connect(): Promise<void> {
        if (this.online) return;
        if (this.connectionPromise) return this.connectionPromise;
        this.socket?.removeAllListeners();
        this.socket?.disconnect();
        const socket = io(this.socketURL, {
            autoConnect: false,
            reconnection: true,
            reconnectionDelay: 1000,
            transports: ['websocket'],
            path: '/stream',
            timeout: this.options.connectionTimeout
        });
        this.socket = socket;
        let handshakeReceived = false;
        const attempt = new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (this.socket === socket) this.abortConnect = undefined;
                if (error) {
                    socket.removeAllListeners();
                    socket.disconnect();
                    if (this.socket === socket) {
                        this.socket = undefined;
                        this.online = false;
                        this.connectionPromise = undefined;
                    }
                    this.reportError(error);
                    reject(error);
                } else resolve();
            };
            const timer = setTimeout(
                () =>
                    finish(
                        new Error(
                            `Connection handshake timed out after ${this.options.connectionTimeout}ms`
                        )
                    ),
                this.options.connectionTimeout
            );
            this.abortConnect = (error) => finish(error);
            socket.on('connect_error', (error) => {
                if (!settled) finish(error);
                else this.reportError(error);
            });
            socket.on('handshake', (message) => {
                if (typeof message?.chain_id !== 'string' || !message.chain_id) {
                    const error = new Error('Invalid server handshake');
                    if (!settled) finish(error);
                    else {
                        this.disconnect();
                        this.reportError(error);
                    }
                    return;
                }
                if (this.chainId && message.chain_id !== this.chainId) {
                    const error = new Error('Endpoint chain ID changed');
                    if (!settled) finish(error);
                    else {
                        this.disconnect();
                        this.reportError(error);
                    }
                    return;
                }
                this.chainId = message.chain_id;
                handshakeReceived = true;
                clearTimeout(this.handshakeTimeout);
                if (socket.connected) {
                    this.handleConnect();
                    finish();
                }
            });
            socket.on('connect', () => {
                if (handshakeReceived) {
                    this.handleConnect();
                    finish();
                } else if (settled) {
                    clearTimeout(this.handshakeTimeout);
                    this.handshakeTimeout = setTimeout(() => {
                        const error = new Error('Reconnect handshake timed out');
                        this.disconnect();
                        this.reportError(error);
                    }, this.options.connectionTimeout);
                }
            });
            socket.on('disconnect', (reason) => {
                this.online = false;
                handshakeReceived = false;
                this.clearLibTimer();
                this.debugLog('Disconnected:', reason);
                clearTimeout(this.handshakeTimeout);
                this.suspendStreams();
            });
            socket.on('resend_requests', () => {
                void this.resendRequests();
            });
            socket.on('message', (message, ack) => this.handleSocketMessage(message, ack));
            socket.on('lib_update', (message) => this.handleLibUpdate(message));
            socket.on('fork_event', (message) => this.handleForkEvent(message));
            socket.on('status', (status) => {
                if (status === 'relay_down') {
                    this.online = false;
                    this.clearLibTimer();
                    this.suspendStreams();
                }
                if (status === 'relay_restored') {
                    this.online = true;
                    void this.resendRequests(true);
                }
            });
            socket.connect();
        });
        this.connectionPromise = attempt;
        try {
            await attempt;
        } finally {
            if (this.connectionPromise === attempt) this.connectionPromise = undefined;
        }
    }
    private handleConnect(): void {
        if (this.online) return;
        const previousId = this.lastConnectedId;
        this.lastConnectedId = this.socket?.id;
        this.online = true;
        if (previousId) this.socket?.emit('reconnect', { last_id: previousId });
        this.emit('connect');
        void this.resendRequests(false, true);
    }
    private suspendStreams(): void {
        const pending = this.reversibleBuffer;
        this.reversibleBuffer = [];
        const earliest = new Map<HyperionStream<any>, number>();
        for (const { stream, message } of pending)
            earliest.set(
                stream,
                Math.min(earliest.get(stream) ?? Infinity, message.content.block_num)
            );
        for (const stream of [...this.streams]) {
            if (stream.request.replayOnReconnect) this.streamMapByUUID.delete(stream.reqUUID);
            const pendingBlock = earliest.get(stream);
            stream.handleDisconnect(pendingBlock);
            if (pendingBlock !== undefined && !stream.request.replayOnReconnect) {
                const error = Object.assign(
                    new Error('Unconfirmed stream data requires replay after disconnect'),
                    { retryable: true, code: 'STREAM_REPLAY_REQUIRED' }
                );
                stream.fail(error);
                this.reportError(error);
            }
        }
    }
    disconnect(): void {
        const socket = this.socket;
        const abortConnect = this.abortConnect;
        const streams = [...this.streams];
        this.abortConnect = undefined;
        this.connectionPromise = undefined;
        clearTimeout(this.handshakeTimeout);
        this.socket = undefined;
        this.online = false;
        this.lastConnectedId = undefined;
        this.lastReceivedBlockNum = 0;
        this.lastIrreversibleBlock = 0;
        this.chainId = '';
        this.libTimestamp = 0;
        this.libOffsetArray = [];
        this.reversibleBuffer = [];
        this.clearLibTimer();
        socket?.removeAllListeners();
        socket?.disconnect();
        for (const stream of streams) stream.stop();
        abortConnect?.(new Error('Connection cancelled'));
    }
    async resendRequests(force = false, onConnect = false): Promise<void> {
        const socket = this.socket;
        if (!socket?.connected) return;
        for (const stream of [...this.streams]) {
            if (onConnect && stream.started && !stream.request.replayOnReconnect) continue;
            try {
                if (force || (onConnect && stream.started && stream.request.replayOnReconnect))
                    this.cancelRemote(stream.reqUUID);
                await stream.start(socket, force);
            } catch (error) {
                const failure = this.reportError(error);
                if (failure.name !== 'StreamDisconnectedError') stream.fail(failure);
            }
        }
    }
    private handleSocketMessage(message: any, ack?: (response: any) => void): void {
        if (!message || typeof message !== 'object') {
            ack?.({ status: false, error: 'Invalid stream packet' });
            return;
        }
        const targets: string[] = Array.isArray(message.targets)
            ? [...new Set<string>(message.targets)]
            : [message.reqUUID];
        let accepted = true;
        let tracked = false;
        for (const target of targets) {
            const stream = this.streamMapByUUID.get(target);
            if (stream) tracked = true;
            if (stream && !stream.handleIncomingMessage(message)) accepted = false;
        }
        if (!tracked && message.error) this.reportError(toStreamError(message.error));
        ack?.({ status: accepted && (tracked || message.mode !== 'history') });
    }
    registerStream(stream: HyperionStream<any>, reqUUID: string): void {
        if (stream.reqUUID) this.streamMapByUUID.delete(stream.reqUUID);
        stream.reqUUID = reqUUID;
        this.streamMapByUUID.set(reqUUID, stream);
    }
    removeStream(stream: HyperionStream<any>): void {
        const index = this.streams.indexOf(stream);
        if (index < 0) return;
        this.streams.splice(index, 1);
        this.streamMap.delete(stream.requestHash);
        this.streamMapByUUID.delete(stream.reqUUID);
        this.reversibleBuffer = this.reversibleBuffer.filter((item) => item.stream !== stream);
        this.cancelRemote(stream.reqUUID);
    }
    cancelRemote(reqUUID: string): void {
        if (reqUUID && this.socket?.connected) {
            this.socket
                .timeout(this.requestTimeout)
                .emit(
                    'cancel_stream_request',
                    { reqUUID },
                    (error: Error | null, response: unknown) => {
                        this.debugLog(
                            error ? 'Remote cancellation timed out' : 'Remote cancellation',
                            response
                        );
                    }
                );
        }
    }
    stop(reqUUID: string): void {
        this.streamMapByUUID.get(reqUUID)?.stop();
    }

    private async createRequest<K extends keyof StreamTypeMap>(
        request: StreamTypeMap[K]['request'],
        type: K
    ): Promise<HyperionStream<StreamTypeMap[K]['response']>> {
        if (!request || typeof request !== 'object' || Array.isArray(request))
            throw new TypeError('Invalid stream request');
        const copy: any = structuredClone(request);
        for (const field of type === 'action'
            ? ['contract', 'action', 'account']
            : ['code', 'table', 'scope', 'payer'])
            copy[field] ??= '';
        if (type === 'action' && !copy.account && (!copy.contract || !copy.action))
            throw new Error('account or contract and action are required');
        if (type === 'delta' && (!copy.code || !copy.table))
            throw new Error('code and table are required');
        copy.start_from ??= 0;
        copy.read_until ??= 0;
        copy.ignore_live ??= false;
        copy.replayOnReconnect ??= false;
        copy.filter_op ??= 'and';
        copy.filters ??= [];
        for (const field of ['start_from', 'read_until']) {
            if (
                field === 'start_from' &&
                typeof copy[field] === 'string' &&
                copy[field].toUpperCase() === 'LIB'
            ) {
                if (this.lastIrreversibleBlock > 0) copy[field] = this.lastIrreversibleBlock;
                else {
                    const endpoint = (this.options.chainApi ?? this.socketURL)
                        .replace(/^ws/, 'http')
                        .replace(/\/+$/, '');
                    const response = await fetch(`${endpoint}/v1/chain/get_info`, {
                        method: 'POST',
                        body: '{}',
                        headers: { 'content-type': 'application/json' },
                        signal: AbortSignal.timeout(this.requestTimeout)
                    });
                    if (!response.ok)
                        throw new Error(`Failed to resolve LIB: HTTP ${response.status}`);
                    const info = (await response.json()) as {
                        last_irreversible_block_num?: number;
                    };
                    if (
                        !Number.isSafeInteger(info.last_irreversible_block_num) ||
                        info.last_irreversible_block_num! < 0
                    )
                        throw new Error('Invalid LIB response');
                    copy[field] = info.last_irreversible_block_num;
                }
            }
            if (typeof copy[field] === 'string' && /^-?\d+$/.test(copy[field]))
                copy[field] = Number(copy[field]);
            if (
                !(typeof copy[field] === 'number' && Number.isSafeInteger(copy[field])) &&
                !(
                    typeof copy[field] === 'string' &&
                    /^\d{4}-\d\d-\d\dT/.test(copy[field]) &&
                    Number.isFinite(Date.parse(copy[field]))
                )
            ) {
                throw new TypeError(`${field} must be an integer block number or ISO timestamp`);
            }
        }
        const stream = new HyperionStream<StreamTypeMap[K]['response']>(this, type, copy);
        const key = await stream.streamRequestHash();
        const existing = this.streamMap.get(key);
        if (existing) {
            if (this.socket?.connected && this.online) await existing.start(this.socket);
            return existing as HyperionStream<StreamTypeMap[K]['response']>;
        }
        this.streams.push(stream);
        this.streamMap.set(key, stream);
        if (this.socket?.connected && this.online) {
            try {
                await stream.start(this.socket);
            } catch (error) {
                const failure = this.reportError(error);
                stream.fail(failure);
                throw failure;
            }
        }
        return stream;
    }
    streamActions(request: StreamActionsRequest): Promise<HyperionStream<ActionContent>> {
        return this.createRequest(request, 'action');
    }
    streamDeltas(request: StreamDeltasRequest): Promise<HyperionStream<DeltaContent>> {
        return this.createRequest(request, 'delta');
    }

    deliver<T extends StreamResponseTypes>(
        stream: HyperionStream<T>,
        message: IncomingData<T>
    ): void {
        if (!Object.is(this.streamMap.get(stream.requestHash), stream)) return;
        if (!this.options.libStream) {
            stream.emitMessage(message);
            return;
        }
        if (message.content.block_num <= this.lastIrreversibleBlock)
            stream.emitMessage({ ...message, irreversible: true });
        else {
            if (this.reversibleBuffer.length >= this.options.maxReversibleBufferSize!)
                throw new Error('Irreversible buffer overflow');
            this.reversibleBuffer.push({ stream, message });
        }
    }
    hasBufferedData(stream: HyperionStream<any>): boolean {
        return this.reversibleBuffer.some((item) => item.stream === stream);
    }
    private handleLibUpdate(message: LIBUpdate): void {
        if (
            !Number.isSafeInteger(message?.block_num) ||
            message.block_num <= this.lastIrreversibleBlock
        )
            return;
        if (message.chain_id && message.chain_id !== this.chainId) {
            this.reportError(new Error('LIB chain ID mismatch'));
            return;
        }
        this.lastIrreversibleBlock = message.block_num;
        const pending = this.reversibleBuffer;
        this.reversibleBuffer = [];
        for (const item of pending) {
            if (!this.streams.includes(item.stream)) continue;
            try {
                if (item.message.content.block_num <= message.block_num)
                    item.stream.emitMessage({ ...item.message, irreversible: true });
                else this.reversibleBuffer.push(item);
            } catch (error) {
                item.stream.fail(this.reportError(error));
            }
        }
        for (const stream of [...this.streams]) stream.completeHistory();
        if (this.options.libMonitor) {
            this.clearLibTimer();
            if (this.libTimestamp) this.libOffsetArray.push(Date.now() - this.libTimestamp);
            this.libOffsetArray = this.libOffsetArray.slice(-10);
            this.libTimestamp = Date.now();
            const delay = this.libOffsetArray.length
                ? this.libOffsetArray.reduce((sum, value) => sum + value, 0) /
                      this.libOffsetArray.length +
                  5000
                : 5000;
            this.libMonitoringTimeout = setTimeout(
                () => this.reportError(new Error(`Last irreversible block stalled for ${delay}ms`)),
                delay
            );
        }
        this.emit('libUpdate', message);
    }
    private handleForkEvent(message: ForkData): void {
        if (!Number.isSafeInteger(message?.starting_block) || message.starting_block <= 0) return;
        this.reversibleBuffer = this.reversibleBuffer.filter(
            (item) => item.message.content.block_num < message.starting_block
        );
        for (const stream of this.streams) stream.handleFork(message.starting_block);
        this.lastReceivedBlockNum = Math.min(this.lastReceivedBlockNum, message.starting_block - 1);
        this.emit('fork', message);
    }
    private clearLibTimer(): void {
        if (this.libMonitoringTimeout) clearTimeout(this.libMonitoringTimeout);
        this.libMonitoringTimeout = undefined;
    }
    debugLog(...args: any[]): void {
        if (this.options.debug) console.log('[hyperion:debug]', ...args);
    }
    hasDataListeners(event: 'data' | 'libData'): boolean {
        return Boolean(this.listeners.get(event)?.size || this.onceListeners.get(event)?.size);
    }
    reportError(error: unknown): Error {
        const failure = toStreamError(error);
        this.emit('error', failure);
        return failure;
    }
    emit<K extends keyof HyperionStreamEventMap<StreamResponseTypes>>(
        event: K,
        data?: HyperionStreamEventMap<StreamResponseTypes>[K]
    ): void {
        const temporary = [...(this.onceListeners.get(event) ?? [])];
        this.onceListeners.delete(event);
        for (const listener of [...(this.listeners.get(event) ?? []), ...temporary]) {
            invokeObserver(listener, data, (error) => {
                if (event !== 'error') this.reportError(error);
            });
        }
    }
    on<K extends keyof HyperionStreamEventMap<StreamResponseTypes>>(
        event: K,
        listener: TypedEventListener<StreamResponseTypes, K>
    ): this {
        if (typeof listener !== 'function')
            throw new TypeError('Event listener must be a function');
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(listener);
        return this;
    }
    once<K extends keyof HyperionStreamEventMap<StreamResponseTypes>>(
        event: K,
        listener: TypedEventListener<StreamResponseTypes, K>
    ): this {
        if (typeof listener !== 'function')
            throw new TypeError('Event listener must be a function');
        if (!this.onceListeners.has(event)) this.onceListeners.set(event, new Set());
        this.onceListeners.get(event)!.add(listener);
        return this;
    }
    off<K extends keyof HyperionStreamEventMap<StreamResponseTypes>>(
        event: K,
        listener: TypedEventListener<StreamResponseTypes, K>
    ): this {
        this.listeners.get(event)?.delete(listener);
        this.onceListeners.get(event)?.delete(listener);
        return this;
    }
}
