import EventEmitter from 'events';
import NATS         from 'nats';

export interface NATSTopicHandler {
    (request: string, replyTo: string, topic: string): Promise<void>;
}

export class NATSClient extends EventEmitter {
    private logLevel: string        = process.env.LOG_LEVEL     || 'info';
    private natsServer: string      = process.env.NATS_SERVER   || '127.0.0.1';
    private natsCluster: string     = process.env.NATS_CLUSTER  || '';
    private natsPort: string        = process.env.NATS_PORT     || '4222';
    private natsUser: string        = process.env.NATS_USER     || '';
    private natsPwd: string         = process.env.NATS_PWD      || '';
    private natsTimeout: number     = parseInt(process.env.NATS_TIMEOUT  || '7500');

    private natsConnected: boolean  = false;
    private natsClient: any         = null;
    private natsSubscriptions: any  = [];
    
    constructor(public serviceName: string) {
        super();

        //Register Global Cleanup Handler
        process.on('exit', () => {
            this.shutdown();
        });

        //Catch Microservices Events
        this.on('debug', (correlation: string, eventInfo: string) => {
            this.log('debug', correlation, eventInfo);
        });
        this.on('info', (correlation: string, eventInfo: string) => {
            this.log('info', correlation, eventInfo);
        });
        this.on('error', (correlation: string, eventInfo: string) => {
            this.log('error', correlation, eventInfo);
            //NOTE:  If Shutdown is desired on Error - define an on Error handler in derived class
        });
    }

    init(): Promise<void> {
        return new Promise<void>( async (resolve, reject) => {
            try {
                let natsConfig: any = {
                    servers: [],
                    user: this.natsUser,
                    pass: this.natsPwd
                };

                if(this.natsCluster.length > 0) {
                    let servers = this.natsCluster.split(',');
                    for(let server of servers) {
                        natsConfig.servers.push(`nats://${server}:${this.natsPort}`);
                    }
                } else {
                    natsConfig.servers.push(`nats://${this.natsServer}:${this.natsPort}`);
                }

                this.emit('info', 'NATSClient', `Attempting to Connect to NATS as User: ${this.natsUser}`);
                this.natsClient = NATS.connect(natsConfig);

                //One-time Listeners
                this.natsClient.once('connect', () => {
                    this.natsConnected = true;
                    this.emit('info', 'NATSClient', `NATS Connected: ${this.natsClient.currentServer.url.host}`);
                    return resolve();
                });

                this.natsClient.once('error', (err: any) => {
                    this.emit('error', 'NATSClient', `FATAL NATS Error:  ${err}`);
                    return reject();
                });

                //Persistent Listeners
                this.natsClient.on('error', (err: any) => {
                    this.emit('error', 'NATSClient', `NATS Error:  ${err}`);
                });

                this.natsClient.on('disconnect', () => {
                    this.natsConnected = false;
                    this.emit('info', 'NATSClient', 'NATS Disconnected');
                });

                this.natsClient.on('reconnecting', () => {
                    this.natsConnected = false;
                    this.emit('info', 'NATSClient', 'NATS Reconnecting');
                });

                this.natsClient.on('reconnect', () => {
                    this.natsConnected = true;
                    this.emit('info', 'NATSClient', `NATS Reconnected: ${this.natsClient.currentServer.url.host}`);
                });

                this.natsClient.on('close', () => {
                    this.natsConnected = false;
                    this.emit('info', 'NATSClient', 'NATS Closed');
                    this.emit('exit', 'NATSClient', 'Max NATS Connect or Reconnect Attempts Reached, Shutting Down');
                });
                
            } catch(err) {
                this.emit('error', 'NATSClient', `FATAL NATS Initialization Error:  ${err}`);
                return reject();
            }
        });
    }

    shutdown(): void {
        if(this.natsConnected) {
            try {
                this.emit('info', 'NATSClient', 'Shutdown - deRegistering Handlers and Closing NATS Connection');

                this.deRegisterTopicHandlers();
                this.natsClient.close();

                //This is to avoid this executing twice, if this function is called manually
                this.natsConnected = false;

            } catch(err) {
                this.emit('info', 'NATSClient', `Shutdown Error:  ${err}`);
            }
        } else {
            this.emit('info', 'NATSClient', 'Shutdown - NATS is not connected');
        }
    }

    log(level: string, correlation: string, entry: string): void {
        try {
            //Supported Levels (highest to lowest): debug, info, error
            // Higher levels inclusive of lower levels
            
            if( (this.logLevel === level)
                || ((this.logLevel === 'info') && (level === 'error'))
                || ((this.logLevel === 'debug') && ((level === 'error') || (level === 'info')))) {
                console.log(`${this.serviceName} (${level}) | ${correlation} | ${entry}`);
            }
        } catch(err) {}
    }

    registerTopicHandler(topic: string, topicHandler: NATSTopicHandler, queue: string | null): void {
        try {
            let subscription = {
                topic: topic,
                sid: null,
            };

            if(!queue) subscription.sid = this.natsClient.subscribe(topic, topicHandler);
            else       subscription.sid = this.natsClient.subscribe(topic, { 'queue': queue }, topicHandler);

            this.natsSubscriptions.push(subscription);
            this.emit('info', 'NATSClient', `Registered Topic Handler (sid: ${subscription.sid}) for: ${topic}`);

        } catch(err) {
            this.emit('error', 'NATSClient', `registerTopicHandler Error: ${err}`);
        }
    }

    deRegisterTopicHandlers(): void {
        try {
            for(let subscription of this.natsSubscriptions) {
                this.natsClient.unsubscribe(subscription.sid);
                this.emit('info', 'NATSClient', `deRegistered Topic: ${subscription.topic}`);
            }
        } catch(err) {
            this.emit('error', 'NATSClient', `deRegisterTopicHandlers Error: ${err}`);
        }
    }

    publishTopic(topic: string, topicData: string): void {
        try {
            this.natsClient.publish(topic, topicData);
        } catch(err) {
            this.emit('error', 'NATSClient', `publishTopic (${topic}) Error: ${err}`);
        }
    }

    queryTopic(topic: string, query: string, timeOutOverride?: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                this.natsClient.requestOne(topic, query, {}, ((timeOutOverride) ? timeOutOverride : this.natsTimeout), (response: any) => {

                    if(response?.code === NATS.REQ_TIMEOUT) {
                        let error = `queryTopic (${topic}) TIMEOUT`;
                        return reject(error);
                    }
                    
                    return resolve(response);
                });
            } catch(err) {
                let error = `queryTopic (${topic}') Error: ${err}`;
                this.emit('error', 'NATSClient', error);
                return reject(error);
            }
        });
    }
}