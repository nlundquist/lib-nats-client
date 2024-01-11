import axios from 'axios';
import { randomUUID } from "crypto";
import EventEmitter from 'events';
import { connect, Events, StringCodec, JSONCodec, jwtAuthenticator } from 'nats';
import nkeys from 'ts-nkeys';
const stringCodec = StringCodec();
const jsonCodec = JSONCodec();
export var LogLevel;
(function (LogLevel) {
    LogLevel["ERROR"] = "error";
    LogLevel["INFO"] = "info";
    LogLevel["DEBUG"] = "debug";
    LogLevel["TRACE"] = "trace";
})(LogLevel || (LogLevel = {}));
export class NATSClient extends EventEmitter {
    constructor(serviceName) {
        super();
        this.serviceName = serviceName;
        this.logLevel = (process.env.LOG_LEVEL ?? LogLevel.INFO);
        this.stsEndpoint = process.env.STS_ENDPOINT ?? null;
        this.natsServers = process.env.NATS_SERVERS ?? '127.0.0.1:4222';
        this.natsNamespace = process.env.NATS_NAMESPACE ?? 'Global';
        this.natsSeed = process.env.NATS_SEED ?? null;
        this.natsJWT = process.env.NATS_JWT ?? null;
        this.natsTimeout = parseInt(process.env.NATS_TIMEOUT ?? '7500');
        this.natsClient = null;
        this.natsClosed = null;
        this.natsSubscriptions = [];
        process.on('exit', () => {
            this.shutdown();
        });
        this.on(LogLevel.TRACE, (correlation, eventInfo) => {
            this.logEvent(LogLevel.TRACE, correlation, eventInfo);
        });
        this.on(LogLevel.DEBUG, (correlation, eventInfo) => {
            this.logEvent(LogLevel.DEBUG, correlation, eventInfo);
        });
        this.on(LogLevel.INFO, (correlation, eventInfo) => {
            this.logEvent(LogLevel.INFO, correlation, eventInfo);
        });
        this.on(LogLevel.ERROR, (correlation, eventInfo) => {
            this.logEvent(LogLevel.ERROR, correlation, eventInfo);
        });
    }
    async init() {
        try {
            if (!this.natsSeed)
                throw 'NATS_SEED must be defined in the environment';
            let natsConfig = {
                servers: this.natsServers,
                authenticator: await this.createAuthenticator()
            };
            this.emit(LogLevel.INFO, 'NATSClient', `Attempting to Connect ${this.serviceName} to NATS`);
            this.natsClient = await connect(natsConfig);
            this.emit(LogLevel.INFO, 'NATSClient', `${this.serviceName} Connected to: ${this.natsClient.getServer()}`);
            this.natsClosed = this.natsClient.closed();
            this.monitorNATSConnection();
            this.natsClient.on(Events.Error, (err) => {
                this.emit(LogLevel.ERROR, 'NATSClient', `NATS Error:  ${err}`);
            });
            this.natsClient.on(Events.Disconnect, () => {
                this.emit(LogLevel.INFO, 'NATSClient', 'NATS Disconnected');
            });
            this.natsClient.on(Events.Reconnect, () => {
                this.emit(LogLevel.INFO, 'NATSClient', `NATS Reconnected: ${this.natsClient.currentServer.url.host}`);
            });
        }
        catch (err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `FATAL NATS Initialization Error:  ${err}`);
            throw err;
        }
    }
    async monitorNATSConnection() {
        const closeErr = await this.natsClosed;
        if (closeErr) {
            this.emit(LogLevel.ERROR, 'NATSClient', `NATS Close Error: ${JSON.stringify(closeErr)}`);
            process.exit(1);
        }
        else {
            this.emit(LogLevel.INFO, 'NATSClient', `NATS Client Connection has Closed`);
            process.exit(0);
        }
    }
    async shutdown() {
        try {
            this.emit(LogLevel.INFO, 'NATSClient', 'Shutdown - deRegistering Handlers and Draining/Closing the NATS Connection');
            await this.natsClient.drain();
        }
        catch (err) {
            this.emit(LogLevel.INFO, 'NATSClient', `NATS Shutdown Error:  ${JSON.stringify(err)}`);
        }
    }
    logEvent(level, correlation, entry) {
        try {
            if ((this.logLevel === level)
                || ((this.logLevel === LogLevel.INFO) && (level === LogLevel.ERROR))
                || ((this.logLevel === LogLevel.DEBUG) && ((level === LogLevel.ERROR) || (level === LogLevel.INFO)))
                || ((this.logLevel === LogLevel.TRACE) && ((level === LogLevel.DEBUG) || (level === LogLevel.ERROR) || (level === LogLevel.INFO)))) {
                console.log(`${this.serviceName} (${level}) | ${correlation} | ${entry}`);
            }
        }
        catch (err) { }
    }
    async createAuthenticator() {
        if (this.natsJWT) {
            return jwtAuthenticator(this.natsJWT, stringCodec.encode(this.natsSeed));
        }
        else {
            const stsJWT = await this.requestJWTFromSTS();
            return jwtAuthenticator(stsJWT, stringCodec.encode(this.natsSeed));
        }
    }
    async requestJWTFromSTS() {
        const nKeyPair = nkeys.fromSeed(Buffer.from(this.natsSeed));
        const requestID = randomUUID();
        const initiateResult = await axios.get(`${this.stsEndpoint}/authorizationSession?requestID=${requestID}`);
        if (!initiateResult.sessionID)
            throw 'No STS Session established';
        const stsRequest = {
            requestID: requestID,
            sessionID: initiateResult.sessionID,
            namespace: this.natsNamespace,
            nKeyUser: nKeyPair.getPublicKey(),
        };
        const verificationRequest = {
            request: stsRequest,
            verification: nKeyPair.sign(Buffer.from(JSON.stringify(stsRequest)))
        };
        const verifyResult = await axios.post(`${this.stsEndpoint}/authorizationVerification`, verificationRequest);
        if (!verifyResult.token)
            throw 'STS Authorization Verification Failed';
        return verifyResult.token;
    }
    registerTopicHandler(topic, topicHandler, queue) {
        try {
            let natsSubscription = null;
            if (!queue)
                natsSubscription = this.natsClient.subscribe(topic);
            else
                natsSubscription = this.natsClient.subscribe(topic, { 'queue': queue });
            let subscriptionHandler = async (subscription) => {
                for await (const message of subscription) {
                    const correlation = `lib-nats-client: ${Date.now()}`;
                    const jsonMessage = jsonCodec.decode(message.data);
                    this.logEvent(LogLevel.TRACE, correlation, JSON.stringify(jsonMessage));
                    let topicResponse = topicHandler(jsonMessage);
                    if (typeof topicResponse != "object")
                        topicResponse = { result: topicResponse };
                    if (topicResponse === {})
                        topicResponse = { result: 'SUCCESS' };
                    this.logEvent(LogLevel.TRACE, correlation, JSON.stringify(topicResponse));
                    message.respond(jsonCodec.encode(topicResponse));
                }
            };
            this.natsSubscriptions.push(subscriptionHandler);
            subscriptionHandler(natsSubscription);
            this.emit(LogLevel.INFO, 'NATSClient', `Registered Topic Handler for: ${topic}`);
        }
        catch (err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `registerTopicHandler Error: ${err}`);
        }
    }
    publishTopic(topic, jsonData) {
        try {
            this.natsClient.publish(topic, jsonCodec.encode(jsonData));
        }
        catch (err) {
            this.emit(LogLevel.ERROR, 'NATSClient', `publishTopic (${topic}) Error: ${err}`);
        }
    }
    async queryTopic(topic, jsonQuery, timeOutOverride) {
        try {
            const requestOptions = { timeout: timeOutOverride ?? this.natsTimeout };
            const response = await this.natsClient.request(topic, jsonCodec.encode(jsonQuery), requestOptions);
            return jsonCodec.decode(response.data);
        }
        catch (err) {
            let error = `queryTopic (${topic}') Error: ${err}`;
            this.emit(LogLevel.ERROR, 'NATSClient', error);
            throw err;
        }
    }
}
