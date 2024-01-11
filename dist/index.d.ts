/// <reference types="node" />
import EventEmitter from 'events';
export interface NATSTopicHandler {
    (json: any): Promise<any>;
}
export declare enum LogLevel {
    ERROR = "error",
    INFO = "info",
    DEBUG = "debug",
    TRACE = "trace"
}
export declare class NATSClient extends EventEmitter {
    private serviceName;
    private logLevel;
    private stsEndpoint;
    private natsServers;
    private natsNamespace;
    private natsSeed;
    private natsJWT;
    private natsTimeout;
    private natsClient;
    private natsClosed;
    private natsSubscriptions;
    constructor(serviceName: string);
    init(): Promise<void>;
    monitorNATSConnection(): Promise<void>;
    shutdown(): Promise<void>;
    private createAuthenticator;
    private requestJWTFromSTS;
    logEvent(level: LogLevel, correlation: string, entry: string): void;
    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string | null): void;
    publishTopic(topic: string, jsonData: any): void;
    queryTopic(topic: string, jsonQuery: any, timeOutOverride?: number): Promise<any>;
}
