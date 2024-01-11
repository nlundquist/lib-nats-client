# Library: lib-nats-client
## NodeJS base class providing a NATS.io interface
The intention is to derive a class from this library, which provides specific message handling logic as part of a NATS.io microservices mesh.
This is the documentation for the support of NATS v2, which is a significant departure from the original v1.
This lists the changes from v1

**Logging** 
Logging is now a dependency of this library, which must be injected by the deriving module.
This keeps this client clean and single-purpose

**Configuration**
The following configuration item replacements have been made:
- NATS_SERVER & NATS_CLUSTER have been replaced by NATS_SERVERS (plural)
- NATS_SERVERS is a comma-separated list of <server1name>:<port1>,<server2name>:<port2>,<etc>
- NATS_PORT has been removed
- NATS_PASSWORD have been replaced by NATS_SEED
- NATS_SEED is an NKey Seed for the service/user account
- NATS_USER has been removed.  If NATS_JWT is not specified, then NATS_SEED is used to get the User NKey.
- NATS_JWT is for "hardcoded" clients (only used for STS services currently).
- STS_ENDPOINT is a NEW variable that provides the URI for the Security Token Service, used to exchange NKeys for JWTs
- NATS_NAMESPACE is a NEW variable, required by the STS to segment identities
- 