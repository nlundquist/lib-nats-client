import EventEmitter                                                   from 'events';
import { connect, Events, StringCodec, JSONCodec, jwtAuthenticator }  from 'nats';

const stringCodec = StringCodec();
const jsonCodec = JSONCodec();

export interface NATSTopicHandler {
    (json: any): Promise<any>;
}

export enum LogLevel {
    ERROR = 'error',
    INFO  = 'info',
    DEBUG = 'debug',
    TRACE = 'trace'
}

export class NATSClient extends EventEmitter {
    private logLevel: LogLevel         = <LogLevel>(process.env.LOG_LEVEL ?? LogLevel.INFO);

    private natsServers: string        = process.env.NATS_SERVERS   ?? '127.0.0.1:4222';
    private natsJWT: string | null     = null;
    private natsSeed: string | null    = null;

    private natsTimeout: number      = parseInt(process.env.NATS_TIMEOUT ?? '7500');

    private natsClient: any          = null;
    private natsClosed: any          = null;
    private natsSubscriptions: any[] = [];

    constructor(private serviceName: string, overrideJWT?: string, overrideSeed?: string) {
        super();

        this.natsJWT  = overrideJWT  ?? process.env.NATS_JWT  ?? null;
        this.natsSeed = overrideSeed ?? process.env.NATS_SEED ?? null;

        if(!this.natsJWT)  throw 'No NATS_JWT environment variable and no overrideJWT supplied to constructor';
        if(!this.natsSeed) throw 'No NATS_SEED environment variable and no overrideSeed supplied to constructor';

        //Register Global Cleanup Handler
        process.on('exit', () => {
            this.shutdown();
        });

        //Catch Microservices Events
        //TODO ROD HERE - must convert to new style
        /*
        this.on(LogLevel.TRACE, (correlation: string, eventInfo: string) => {
            this.logEvent(LogLevel.TRACE, correlation, eventInfo);
        });
        this.on(LogLevel.DEBUG, (correlation: string, eventInfo: string) => {
            this.logEvent(LogLevel.DEBUG, correlation, eventInfo);
        });
        this.on(LogLevel.INFO, (correlation: string, eventInfo: string) => {
            this.logEvent(LogLevel.INFO, correlation, eventInfo);
        });
        this.on(LogLevel.ERROR, (correlation: string, eventInfo: string) => {
            this.logEvent(LogLevel.ERROR, correlation, eventInfo);
            //NOTE:  If Shutdown is desired on Error - define an on Error handler in derived class
        });

        (async () => {
            for await (const s of nc.status()) {
              switch (s.type) {
                case Events.Disconnect:
                  t.log(`client disconnected - ${s.data}`);
                  break;
                case Events.LDM:
                  t.log("client has been requested to reconnect");
                  break;
                case Events.Update:
                  t.log(`client received a cluster update - ${s.data}`);
                  break;
                case Events.Reconnect:
                  t.log(`client reconnected - ${s.data}`);
                  break;
                case Events.Error:
                  t.log("client got a permissions error");
                  break;
                case DebugEvents.Reconnecting:
                  t.log("client is attempting to reconnect");
                  break;
                case DebugEvents.StaleConnection:
                  t.log("client has a stale connection");
                  break;
                default:
                  t.log(`got an unknown status ${s.type}`);
              }
            }
            })().then();
         */
    }

    async init(): Promise<void> {
        try {
            console.log(`LogLevel set to:  ${this.logLevel}`);

            let natsConfig: any = {
                servers:       this.natsServers,
                authenticator: jwtAuthenticator(<string>this.natsJWT, stringCodec.encode(<string>this.natsSeed))
            };

            this.emit(LogLevel.INFO, 'NATSClient', `Attempting to Connect ${this.serviceName} to NATS`);
            this.natsClient = await connect(natsConfig);

            this.emit(LogLevel.INFO, 'NATSClient', `${this.serviceName} Connected to: ${this.natsClient.getServer()}`);
            this.natsClosed = this.natsClient.closed();
            this.monitorNATSConnection();

            //Persistent Listeners
            this.natsClient.on(Events.Error, (err: any) => {
                this.emit(LogLevel.ERROR, 'NATSClient', `NATS Error:  ${err}`);
            });

            this.natsClient.on(Events.Disconnect, () => {
                this.emit(LogLevel.INFO, 'NATSClient', 'NATS Disconnected');
            });

            this.natsClient.on(Events.Reconnect, () => {
                this.emit(LogLevel.INFO, 'NATSClient', `NATS Reconnected: ${this.natsClient.currentServer.url.host}`);
            });

        } catch(err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `FATAL NATS Initialization Error:  ${err}`);
            throw err;
        }
    }

    async monitorNATSConnection() {
        const closeErr = await this.natsClosed;
        if(closeErr) {
            this.emit(LogLevel.ERROR, 'NATSClient', `NATS Close Error: ${JSON.stringify(closeErr)}`);
            process.exit(1);
        } else {
            this.emit(LogLevel.INFO, 'NATSClient', `NATS Client Connection has Closed`);
            process.exit(0);
        }
    }

    async shutdown(): Promise<void> {
        try {
            this.emit(LogLevel.INFO, 'NATSClient', 'Shutdown - deRegistering Handlers and Draining/Closing the NATS Connection');

            //this.deRegisterTopicHandlers();
            await this.natsClient.drain();
        } catch(err) {
            this.emit(LogLevel.INFO, 'NATSClient', `NATS Shutdown Error:  ${JSON.stringify(err)}`);
        }
    }

    logEvent(level: LogLevel, correlation: string, entry: string): void {
        try {
            //Supported Levels (highest to lowest): trace, debug, info, error
            // Higher levels inclusive of lower levels

            if( (this.logLevel === level)
                || ((this.logLevel === LogLevel.INFO) && (level === LogLevel.ERROR))
                || ((this.logLevel === LogLevel.DEBUG) && ((level === LogLevel.ERROR) || (level === LogLevel.INFO)))
                || ((this.logLevel === LogLevel.TRACE) && ((level === LogLevel.DEBUG) || (level === LogLevel.ERROR) || (level === LogLevel.INFO))) ) {
                console.log(`${this.serviceName} (${level}) | ${correlation} | ${entry}`);
            }
        } catch(err) {}
    }

    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string | null): void {
        try {
            let natsSubscription: any = null;
            if(!queue) natsSubscription = this.natsClient.subscribe(topic);
            else       natsSubscription = this.natsClient.subscribe(topic, { 'queue': queue });

            let subscriptionHandler = async (subscription: any) => {
                for await (const message of subscription) {
                    const correlation: string = `lib-nats-client: ${Date.now()}`;
                    const jsonMessage: any = jsonCodec.decode(message.data);
                    this.logEvent(LogLevel.TRACE, correlation, JSON.stringify(jsonMessage));

                    let topicResponse: any = topicHandler(jsonMessage);
                    if(typeof topicResponse != "object") topicResponse = { result: topicResponse };
                    if(topicResponse === {}) topicResponse = { result: 'SUCCESS' };

                    this.logEvent(LogLevel.TRACE, correlation, JSON.stringify(topicResponse));
                    message.respond(jsonCodec.encode(topicResponse));
                }
            };

            this.natsSubscriptions.push(subscriptionHandler);
            subscriptionHandler(natsSubscription);

            this.emit(LogLevel.INFO, 'NATSClient', `Registered Topic Handler for: ${topic}`);
        } catch(err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `registerTopicHandler Error: ${err}`);
        }
    }

    publishTopic(topic: string, jsonData: any): void {
        try {
            if(typeof jsonData !== 'object') throw 'Publish Data is not a JSON object';
            this.natsClient.publish(topic, jsonCodec.encode(jsonData));
        } catch(err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `publishTopic (${topic}) Error: ${err}`);
        }
    }

    async queryTopic(topic: string, jsonQuery: any, timeOutOverride?: number): Promise<any> {
        try {
            if(typeof jsonQuery !== 'object') throw 'Query Request Data is not a JSON object';
            const requestOptions: any = { timeout: timeOutOverride ?? this.natsTimeout };
            const response = await this.natsClient.request(topic, jsonCodec.encode(jsonQuery), requestOptions);
            return jsonCodec.decode(response.data);
        } catch(err) {
            let error = `queryTopic (${topic}') Error: ${err}`;
            this.emit(LogLevel.ERROR, 'NATSClient', error);
            throw err;
        }
    }
}


// deRegisterTopicHandlers(): void {
//     try {
//         for(let subscription of this.natsSubscriptions) {
//             this.natsClient.unsubscribe(subscription.sid);
//             this.emit(LogLevel.INFO, 'NATSClient', `deRegistered Topic: ${subscription.topic}`);
//         }
//     } catch(err) {
//         this.emit(LogLevel.ERROR, 'NATSClient', `deRegisterTopicHandlers Error: ${err}`);
//     }
// }

