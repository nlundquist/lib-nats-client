/// <reference types="node" />
import EventEmitter from 'events';
export interface NATSTopicHandler {
    (request: string, replyTo: string, topic: string): Promise<void>;
}
export declare class NATSClient extends EventEmitter {
    serviceName: string;
    private logLevel;
    private natsServer;
    private natsCluster;
    private natsPort;
    private natsUser;
    private natsPwd;
    private natsTimeout;
    private natsConnected;
    private natsClient;
    private natsSubscriptions;
    constructor(serviceName: string);
    init(): Promise<void>;
    shutdown(): void;
    log(level: string, correlation: string, entry: string): void;
    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string | null): void;
    deRegisterTopicHandlers(): void;
    publishTopic(topic: string, topicData: string): void;
    queryTopic(topic: string, query: string, timeOutOverride?: number): Promise<string>;
}
