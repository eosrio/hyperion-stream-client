import { ActionContent, DeltaContent, IncomingData, MessageHandler, StreamActionsRequest, StreamDeltasRequest } from "./interfaces.js";
import { Socket } from "socket.io-client";
export declare class HyperionStream {
    private eventHandlers;
    private messages;
    private resolveNext?;
    private isIteratorActive;
    private maxQueueSize;
    request: StreamActionsRequest | StreamDeltasRequest;
    type: 'action' | 'delta';
    live: boolean;
    firstReceivedBlock: number;
    historyResults: number;
    filtered: number;
    deliveryCounter: number;
    liveQueueStartTimer?: number;
    pendingMessages: IncomingData<ActionContent | DeltaContent>[];
    started: boolean;
    reqUUID: string;
    constructor(type: 'action' | 'delta', request: StreamActionsRequest | StreamDeltasRequest);
    start(socket: Socket): Promise<any>;
    on(event: string, handler: MessageHandler): this;
    off(event: string, handler: MessageHandler): this;
    once(event: string, handler: MessageHandler): this;
    /**
     * Set the maximum size for the message queue when the AsyncIterator isn't being used
     * @param size - Maximum number of messages to keep in the queue
     */
    setMaxQueueSize(size: number): this;
    private emit;
    emitMessage(msg: IncomingData<ActionContent | DeltaContent>): void;
    handleIncomingMessage(msg: any): void;
    [Symbol.asyncIterator](): AsyncIterator<ActionContent | DeltaContent>;
    /**
     * Internal method to parse a delta streaming trace
     * @param delta
     * @param mode
     * @param uuid
     * @private
     */
    private processDeltaTrace;
}
