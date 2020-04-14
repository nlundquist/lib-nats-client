
declare interface NATSTopicHandler {
    (request: string, replyTo: string, topic: string): string;
}

declare class NATSClient {
    constructor(serviceName: string, logLevel?: string);

    init(): any;
    shutdown(): void;

    log(level: string, correlation: string, entry: string): void;
    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string): void;
    deRegisterTopicHandlers(): void;

    publishTopic(topic: string, topicData: string): void;
    queryTopic(topic: string, query: string, timeOutOverride: number): any;
}