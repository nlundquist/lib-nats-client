"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const EventEmitter = require("events");
const NATS = require("nats");
class NATSClient extends EventEmitter {
    constructor(serviceName) {
        super();
        this.serviceName = serviceName;
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.natsServer = process.env.NATS_SERVER || '127.0.0.1';
        this.natsPort = process.env.NATS_PORT || '4222';
        this.natsUser = process.env.NATS_USER || '';
        this.natsPwd = process.env.NATS_PWD || '';
        this.natsConnected = false;
        this.natsTimeout = 3000;
        this.natsClient = null;
        this.natsSubscriptions = [];
        //Register Global Cleanup Handler
        process.on('exit', () => {
            this.shutdown();
        });
        //Catch Microservices Events
        this.on('debug', (correlation, eventInfo) => {
            this.log('debug', correlation, eventInfo);
        });
        this.on('info', (correlation, eventInfo) => {
            this.log('info', correlation, eventInfo);
        });
        this.on('error', (correlation, eventInfo) => {
            this.log('error', correlation, eventInfo);
            //NOTE:  If Shutdown is desired on Error - define an on Error handler in derived class
        });
    }
    init() {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            try {
                let natsURL = "";
                if (this.natsUser.length > 0) {
                    natsURL = `nats://${this.natsUser}:${this.natsPwd}@${this.natsServer}:${this.natsPort}`;
                }
                else {
                    natsURL = `nats://${this.natsServer}:${this.natsPort}`;
                }
                this.emit('info', 'NATSClient', `Connecting to: ${natsURL} as User: ${this.natsUser}`);
                this.natsClient = NATS.connect({ 'url': natsURL });
                //One-time Listeners
                this.natsClient.once('connect', () => {
                    this.natsConnected = true;
                    this.emit('info', 'NATSClient', 'NATS Connected');
                    return resolve();
                });
                this.natsClient.once('error', (err) => {
                    this.emit('error', 'NATSClient', `FATAL NATS Error:  ${err}`);
                    return reject();
                });
                //Persistent Listeners
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
                    this.emit('info', 'NATSClient', 'NATS Reconnected');
                });
                this.natsClient.on('close', () => {
                    this.natsConnected = false;
                    this.emit('info', 'NATSClient', 'NATS Closed');
                });
            }
            catch (err) {
                this.emit('error', 'NATSClient', `FATAL NATS Initialization Error:  ${err}`);
                return reject();
            }
        }));
    }
    shutdown() {
        if (this.natsConnected) {
            try {
                this.emit('info', 'NATSClient', 'Shutdown - deRegistering Handlers and Closing NATS Connection');
                this.deRegisterTopicHandlers();
                this.natsClient.close();
                //This is to avoid this executing twice, if this function is called manually
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
            //Supported Levels (highest to lowest): debug, info, error
            // Higher levels inclusive of lower levels
            if ((this.logLevel === level)
                || ((this.logLevel === 'info') && (level === 'error'))
                || ((this.logLevel === 'debug') && ((level === 'error') || (level === 'info')))) {
                console.log(`${this.serviceName} (${level}) | ${correlation} | ${entry}`);
            }
        }
        catch (err) { }
    }
    registerTopicHandler(topic, topicHandler, queue = '') {
        try {
            let subscription = {
                topic: topic,
                sid: null,
            };
            if (queue !== '') {
                subscription.sid = this.natsClient.subscribe(topic, { 'queue': queue }, topicHandler);
            }
            else {
                subscription.sid = this.natsClient.subscribe(topic, topicHandler);
            }
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
                    if (response && response.code && response.code === NATS.REQ_TIMEOUT) {
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
exports.NATSClient = NATSClient;
