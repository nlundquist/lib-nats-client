import EventEmitter from 'events';
import NATS from 'nats';
export class NATSClient extends EventEmitter {
    constructor(serviceName) {
        super();
        this.serviceName = serviceName;
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.natsServer = process.env.NATS_SERVER || '127.0.0.1';
        this.natsCluster = process.env.NATS_CLUSTER || '';
        this.natsPort = process.env.NATS_PORT || '4222';
        this.natsUser = process.env.NATS_USER || '';
        this.natsPwd = process.env.NATS_PWD || '';
        this.natsTimeout = parseInt(process.env.NATS_TIMEOUT || '7500');
        this.natsConnected = false;
        this.natsClient = null;
        this.natsSubscriptions = [];
        process.on('exit', () => {
            this.shutdown();
        });
        this.on('debug', (correlation, eventInfo) => {
            this.log('debug', correlation, eventInfo);
        });
        this.on('info', (correlation, eventInfo) => {
            this.log('info', correlation, eventInfo);
        });
        this.on('error', (correlation, eventInfo) => {
            this.log('error', correlation, eventInfo);
        });
    }
    init() {
        return new Promise(async (resolve, reject) => {
            try {
                let natsConfig = {
                    servers: [],
                    user: this.natsUser,
                    pass: this.natsPwd
                };
                if (this.natsCluster.length > 0) {
                    let servers = this.natsCluster.split(',');
                    for (let server of servers) {
                        natsConfig.servers.push(`nats://${server}:${this.natsPort}`);
                    }
                }
                else {
                    natsConfig.servers.push(`nats://${this.natsServer}:${this.natsPort}`);
                }
                this.emit('info', 'NATSClient', `Attempting to Connect to NATS as User: ${this.natsUser}`);
                this.natsClient = NATS.connect(natsConfig);
                this.natsClient.once('connect', () => {
                    this.natsConnected = true;
                    this.emit('info', 'NATSClient', `NATS Connected: ${this.natsClient.currentServer.url.host}`);
                    return resolve();
                });
                this.natsClient.once('error', (err) => {
                    this.emit('error', 'NATSClient', `FATAL NATS Error:  ${err}`);
                    return reject();
                });
                this.natsClient.on('error', (err) => {
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
            }
            catch (err) {
                this.emit('error', 'NATSClient', `FATAL NATS Initialization Error:  ${err}`);
                return reject();
            }
        });
    }
    shutdown() {
        if (this.natsConnected) {
            try {
                this.emit('info', 'NATSClient', 'Shutdown - deRegistering Handlers and Closing NATS Connection');
                this.deRegisterTopicHandlers();
                this.natsClient.close();
                this.natsConnected = false;
            }
            catch (err) {
                this.emit('info', 'NATSClient', `Shutdown Error:  ${err}`);
            }
        }
        else {
            this.emit('info', 'NATSClient', 'Shutdown - NATS is not connected');
        }
    }
    log(level, correlation, entry) {
        try {
            if ((this.logLevel === level)
                || ((this.logLevel === 'info') && (level === 'error'))
                || ((this.logLevel === 'debug') && ((level === 'error') || (level === 'info')))) {
                console.log(`${this.serviceName} (${level}) | ${correlation} | ${entry}`);
            }
        }
        catch (err) { }
    }
    registerTopicHandler(topic, topicHandler, queue) {
        try {
            let subscription = {
                topic: topic,
                sid: null,
            };
            if (!queue)
                subscription.sid = this.natsClient.subscribe(topic, topicHandler);
            else
                subscription.sid = this.natsClient.subscribe(topic, { 'queue': queue }, topicHandler);
            this.natsSubscriptions.push(subscription);
            this.emit('info', 'NATSClient', `Registered Topic Handler (sid: ${subscription.sid}) for: ${topic}`);
        }
        catch (err) {
            this.emit('error', 'NATSClient', `registerTopicHandler Error: ${err}`);
        }
    }
    deRegisterTopicHandlers() {
        try {
            for (let subscription of this.natsSubscriptions) {
                this.natsClient.unsubscribe(subscription.sid);
                this.emit('info', 'NATSClient', `deRegistered Topic: ${subscription.topic}`);
            }
        }
        catch (err) {
            this.emit('error', 'NATSClient', `deRegisterTopicHandlers Error: ${err}`);
        }
    }
    publishTopic(topic, topicData) {
        try {
            this.natsClient.publish(topic, topicData);
        }
        catch (err) {
            this.emit('error', 'NATSClient', `publishTopic (${topic}) Error: ${err}`);
        }
    }
    queryTopic(topic, query, timeOutOverride) {
        return new Promise((resolve, reject) => {
            try {
                this.natsClient.requestOne(topic, query, {}, ((timeOutOverride) ? timeOutOverride : this.natsTimeout), (response) => {
                    if (response?.code === NATS.REQ_TIMEOUT) {
                        let error = `queryTopic (${topic}) TIMEOUT`;
                        return reject(error);
                    }
                    return resolve(response);
                });
            }
            catch (err) {
                let error = `queryTopic (${topic}') Error: ${err}`;
                this.emit('error', 'NATSClient', error);
                return reject(error);
            }
        });
    }
}
