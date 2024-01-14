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
    private natsServers;
    private natsJWT;
    private natsSeed;
    private natsTimeout;
    private natsClient;
    private natsClosed;
    private natsSubscriptions;
    constructor(serviceName: string, overrideJWT?: string, overrideSeed?: string);
    init(): Promise<void>;
    monitorNATSConnection(): Promise<void>;
    shutdown(): Promise<void>;
    logEvent(level: LogLevel, correlation: string, entry: string): void;
    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string | null): void;
    publishTopic(topic: string, jsonData: any): void;
    queryTopic(topic: string, jsonQuery: any, timeOutOverride?: number): Promise<any>;
}
