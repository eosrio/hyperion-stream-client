export type MessageHandler = (msg: any) => void;
export interface HyperionStreamEvents {
    type: string;
    reqUUID: string;
    mode: string;
    message: any;
    error: Error;
}
export interface SavedRequest {
    started: boolean;
    live: boolean;
    liveQueueStartTimer?: number;
    reqUUID?: string;
    type: string;
    error?: string;
    req: StreamActionsRequest | StreamDeltasRequest;
    firstReceivedBlock?: number;
    historyResults?: number;
    deliveryCounter: number;
    pendingMessages: any[];
    filtered: number;
}
export declare enum StreamClientEvents {
    DATA = "data",
    LIBUPDATE = "libUpdate",
    FORK = "fork",
    EMPTY = "empty",
    CONNECT = "connect",
    DRAIN = "drain",
    LIBDATA = "libData"
}
/**
 * Options used to configure the streaming client
 */
export interface HyperionClientOptions {
    /** Hyperion HTTP API w/ streaming enabled */
    endpoint: string;
    chainApi?: string;
    debug?: boolean;
    libStream?: boolean;
}
export interface StreamDeltasRequest {
    code: string;
    table: string;
    scope: string;
    payer: string;
    start_from: number | string;
    read_until: number | string;
    filter_op?: 'and' | 'or';
    filters?: RequestFilter[];
}
export interface RequestFilter {
    field: string;
    value: string | number | boolean;
    operator?: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'starts_with' | 'ends_with';
}
export interface StreamActionsRequest {
    contract: string;
    account: string;
    action: string;
    start_from: number | string;
    read_until: number | string;
    filter_op?: 'and' | 'or';
    filters?: RequestFilter[];
}
export interface ActionContent {
    "@timestamp": string;
    global_sequence: number;
    account_ram_deltas: {
        delta: number;
        account: string;
    };
    act: {
        authorization: {
            permission: string;
            actor: string;
        };
        account: string;
        name: string;
        data: any;
    };
    block_num: number;
    action_ordinal: number;
    creator_action_ordinal: number;
    cpu_usage_us: number;
    net_usage_words: number;
    code_sequence: number;
    abi_sequence: number;
    trx_id: string;
    producer: string;
    notified: string;
    [key: string]: any;
}
export interface DeltaContent {
    code: string;
    scope: string;
    table: string;
    primary_key: string;
    payer: string;
    "@timestamp": string;
    present: number;
    block_num: number;
    block_id: string;
    data: Record<string, any>;
    [key: string]: any;
}
export interface IncomingData<T> {
    uuid: string;
    type: "action" | "delta";
    mode: "live" | "history";
    content: T;
    irreversible: boolean;
}
export interface LIBData {
    chain_id: string;
    block_num: number;
    block_id: string;
}
export interface ForkData {
    chain_id: string;
    starting_block: number;
    ending_block: number;
    new_id: string;
}
export interface HyperionStreamEventMap<T> {
    'connect': void;
    'drain': void;
    'empty': void;
    'data': IncomingData<T>;
    'libData': IncomingData<T>;
    'libUpdate': LIBData;
    'fork': ForkData;
}
export type TypedEventListener<T, K extends keyof HyperionStreamEventMap<T>> = (data: HyperionStreamEventMap<T>[K]) => void;
export type AsyncHandlerFunction<T> = (data: IncomingData<T>) => Promise<void>;
export type EventData<T> = IncomingData<T> | LIBData | ForkData | void | undefined;
export type EventListener<T> = (data?: EventData<T>) => void;
