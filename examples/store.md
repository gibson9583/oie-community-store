# SQS Source Connector

Consume messages from **Amazon SQS** queues as a channel source. Each SQS message
becomes one engine message; delete-on-success and visibility-timeout handling are
built in.

## Features

- Standard and FIFO queues
- Long polling (configurable wait time)
- Batch receive up to 10 messages per poll
- Message attributes mapped to source map variables
- IAM role or static credential authentication

## Configuration

| Setting | Description |
|---------|-------------|
| Queue URL | Full SQS queue URL |
| Region | AWS region, e.g. `us-east-1` |
| Poll interval | Milliseconds between receive calls |
| Max messages | 1–10 messages per receive |

See the [full configuration guide](docs/configuration.md) for every field, and the
[architecture diagram](docs/arch.png) for how polling and acknowledgement work.

> **Note:** relative links above resolve to this repository at the installed
> release tag, so the docs you read always match the version you are installing.

## Support

Open an issue at
[github.com/acme-health/oie-sqs-connector](https://github.com/acme-health/oie-sqs-connector/issues).
