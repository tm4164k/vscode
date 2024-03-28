/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { patternsEquals } from 'vs/base/common/glob';
import { BaseWatcher } from 'vs/platform/files/node/watcher/baseWatcher';
import { isLinux } from 'vs/base/common/platform';
import { INonRecursiveWatchRequest, INonRecursiveWatcher, IRecursiveWatcherWithSubscribe } from 'vs/platform/files/common/watcher';
import { NodeJSFileWatcherLibrary } from 'vs/platform/files/node/watcher/nodejs/nodejsWatcherLib';
import { isEqual } from 'vs/base/common/extpath';

export interface INodeJSWatcherInstance {

	/**
	 * The watcher instance.
	 */
	readonly instance: NodeJSFileWatcherLibrary;

	/**
	 * The watch request associated to the watcher.
	 */
	readonly request: INonRecursiveWatchRequest;
}

export interface IMergedNonRecursiveWatchRequest extends INonRecursiveWatchRequest {
	readonly additionalRequests: INonRecursiveWatchRequest[];
}

export class NodeJSWatcher extends BaseWatcher implements INonRecursiveWatcher {

	readonly onDidError = Event.None;

	readonly watchers = new Set<INodeJSWatcherInstance>();

	private verboseLogging = false;

	constructor(protected readonly recursiveWatcher: IRecursiveWatcherWithSubscribe | undefined) {
		super();
	}

	protected override async doWatch(requests: INonRecursiveWatchRequest[]): Promise<void> {

		// Figure out duplicates to remove from the requests
		requests = this.mergeRequests(requests);

		// Figure out which watchers to start and which to stop
		const requestsToStart: INonRecursiveWatchRequest[] = [];
		const watchersToStop = new Set(Array.from(this.watchers));
		for (const request of requests) {
			const watcher = this.findWatcher(request);
			if (watcher) {
				watchersToStop.delete(watcher); // keep watcher
			} else {
				requestsToStart.push(request); // start watching
			}
		}

		// Logging

		if (requestsToStart.length) {
			this.trace(`Request to start watching: ${requestsToStart.map(request => this.requestToString(request)).join(',')}`);
		}

		if (watchersToStop.size) {
			this.trace(`Request to stop watching: ${Array.from(watchersToStop).map(watcher => this.requestToString(watcher.request)).join(',')}`);
		}

		// Stop watching as instructed
		for (const watcher of watchersToStop) {
			this.stopWatching(watcher);
		}

		// Start watching as instructed
		for (const request of requestsToStart) {
			this.startWatching(request);
		}
	}

	private findWatcher(request: INonRecursiveWatchRequest): INodeJSWatcherInstance | undefined {
		for (const watcher of this.watchers) {
			if (isEqual(watcher.request.path, request.path, !isLinux /* ignorecase */) && patternsEquals(watcher.request.excludes, request.excludes) && patternsEquals(watcher.request.includes, request.includes)) {
				return watcher;
			}
		}

		return undefined;
	}

	private startWatching(request: INonRecursiveWatchRequest): void {

		// Start via node.js lib
		const instance = new NodeJSFileWatcherLibrary(request, this.recursiveWatcher, changes => this._onDidChangeFile.fire(changes), () => this._onDidWatchFail.fire(request), msg => this._onDidLogMessage.fire(msg), this.verboseLogging);

		// Remember as watcher instance
		this.watchers.add({ request, instance });
	}

	override async stop(): Promise<void> {
		await super.stop();

		for (const watcher of this.watchers) {
			this.stopWatching(watcher);
		}
	}

	private stopWatching(watcher: INodeJSWatcherInstance): void {
		this.trace(`stopping file watcher`, watcher);

		this.watchers.delete(watcher);

		watcher.instance.dispose();
	}

	private mergeRequests(requests: INonRecursiveWatchRequest[]): IMergedNonRecursiveWatchRequest[] {
		const mergedRequests = new Set<IMergedNonRecursiveWatchRequest>();

		// Group requests by path
		const mapPathToRequests = new Map<string, INonRecursiveWatchRequest[]>();
		for (const request of requests) {
			const path = isLinux ? request.path : request.path.toLowerCase(); // adjust for case sensitivity

			let requestsForPath = mapPathToRequests.get(path);
			if (!requestsForPath) {
				requestsForPath = [];
				mapPathToRequests.set(path, requestsForPath);
			}

			requestsForPath.push(request);
		}

		// Merge requests for the same path and same ignore/exclude rules
		for (const requestsForPath of mapPathToRequests.values()) {
			const mergedRequestsForPath = new Set<IMergedNonRecursiveWatchRequest>();

			// Eagerly add them all at first
			for (const requestForPath of requestsForPath) {
				mergedRequestsForPath.add({ ...requestForPath, additionalRequests: [] });
			}

			// Then try to merge them
			// TODO: prefer a correlated request for the main-request since that will support suspend/resume
			for (const mergedRequestForPath of mergedRequestsForPath) {
				for (const otherMergedRequestForPath of mergedRequestsForPath) {
					if (mergedRequestForPath === otherMergedRequestForPath) {
						continue;
					}

					if (patternsEquals(mergedRequestForPath.excludes, otherMergedRequestForPath.excludes) && patternsEquals(mergedRequestForPath.includes, otherMergedRequestForPath.includes)) {
						const additionalRequests: INonRecursiveWatchRequest[] = [];
						for (const additionalRequest of [mergedRequestForPath, ...mergedRequestForPath.additionalRequests]) {
							if (otherMergedRequestForPath.correlationId !== additionalRequest.correlationId) {
								additionalRequests.push(additionalRequest);
							}
						}

						otherMergedRequestForPath.additionalRequests.push(...additionalRequests);
						mergedRequestsForPath.delete(mergedRequestForPath);
						break;
					}
				}
			}

			for (const mergedRequestForPath of mergedRequestsForPath) {
				mergedRequests.add(mergedRequestForPath);
			}
		}

		return Array.from(mergedRequests);
	}

	async setVerboseLogging(enabled: boolean): Promise<void> {
		this.verboseLogging = enabled;

		for (const watcher of this.watchers) {
			watcher.instance.setVerboseLogging(enabled);
		}
	}

	protected trace(message: string, watcher?: INodeJSWatcherInstance): void {
		if (this.verboseLogging) {
			this._onDidLogMessage.fire({ type: 'trace', message: this.toMessage(message, watcher) });
		}
	}

	protected warn(message: string): void {
		this._onDidLogMessage.fire({ type: 'warn', message: this.toMessage(message) });
	}

	private toMessage(message: string, watcher?: INodeJSWatcherInstance): string {
		return watcher ? `[File Watcher (node.js)] ${message} (${this.requestToString(watcher.request)})` : `[File Watcher (node.js)] ${message}`;
	}
}
