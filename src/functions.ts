import type { ActionContent, DeltaContent, StreamError, StreamErrorDetails } from './interfaces.js';

/** Observers do not delay transport ACKs, but rejected promises still need an owner. */
export function invokeObserver<T>(
    listener: (value: T) => unknown,
    value: T,
    onError: (error: unknown) => void
): void {
    try {
        Promise.resolve(listener(value)).catch(onError);
    } catch (error) {
        onError(error);
    }
}

/** Keep retryability and status metadata supplied by the server. */
export function toStreamError(value: unknown): StreamError {
    if (value instanceof Error) return value;
    if (!value || typeof value !== 'object') return new Error(String(value));
    const details = value as StreamErrorDetails;
    const error: StreamError = new Error(
        typeof details.message === 'string' ? details.message : 'Stream request failed'
    );
    if (typeof details.statusCode === 'number') error.statusCode = details.statusCode;
    if (typeof details.retryable === 'boolean') error.retryable = details.retryable;
    if (typeof details.code === 'string') error.code = details.code;
    return error;
}

export function trimTrailingSlash(input: string) {
    if (input.endsWith('/')) {
        return input.slice(0, input.length - 1);
    } else {
        return input;
    }
}

export function replaceMetaFields(content: ActionContent | DeltaContent) {
    // Determine if the content is a delta or action
    if (content.table) {
        let metaKey = '@' + content.table;
        if (content[metaKey + '.data']) {
            metaKey = metaKey + '.data';
        }
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            if (!content.data) {
                content.data = {};
            }
            Object.keys(parsedData).forEach((key) => {
                content.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    } else if (content.act) {
        const metaKey = '@' + content.act.name;
        if (content[metaKey]) {
            const parsedData = content[metaKey];
            if (!content.act.data) {
                content.act.data = {};
            }
            Object.keys(parsedData).forEach((key) => {
                content.act.data[key] = parsedData[key];
            });
            delete content[metaKey];
        }
    }
}
