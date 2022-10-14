import {HyperionStreamClient} from "./hyperion-stream-client";

if (typeof window !== 'undefined') {
	// @ts-ignore
	window['HyperionStreamClient'] = HyperionStreamClient;
}

export * from './interfaces';
export * from './hyperion-stream-client';
