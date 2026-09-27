# Workspace Azure consumer deployment assets

These review-only deployment assets are owned by Cyrene-Client as the
consuming repository. They were received from Cyrene-Platform `develop` at
[`35e18cfd127d12ee7be7b88f93725a53e4f43a39`](https://github.com/DoHorizon-AI/Cyrene-Platform/tree/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure).
Each source file is linked below at that immutable commit. Existing review-only
status and deployment gates remain in force; this transfer does not authorize
or perform an Azure deployment, grant service permissions, or move service
implementation and authorization ownership into Client.

| Client path | Original Platform source |
| --- | --- |
| [`container-apps/workspace-connector.internal.review.yaml`](container-apps/workspace-connector.internal.review.yaml) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/container-apps/workspace-connector.internal.review.yaml) |
| [`container-apps/workspace-connector.md`](container-apps/workspace-connector.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/container-apps/workspace-connector.md) |
| [`container-apps/workspace-relay.md`](container-apps/workspace-relay.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/container-apps/workspace-relay.md) |
| [`container-apps/workspace-relay.yaml`](container-apps/workspace-relay.yaml) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/container-apps/workspace-relay.yaml) |
| [`workspace-data/README.md`](workspace-data/README.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-data/README.md) |
| [`workspace-data/main.bicep`](workspace-data/main.bicep) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-data/main.bicep) |
| [`workspace-data/migration-runbook.md`](workspace-data/migration-runbook.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-data/migration-runbook.md) |
| [`workspace-web-bff/README.md`](workspace-web-bff/README.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-bff/README.md) |
| [`workspace-web-bff/workspace-web-bff.yaml`](workspace-web-bff/workspace-web-bff.yaml) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-bff/workspace-web-bff.yaml) |
| [`workspace-web-identity/README.md`](workspace-web-identity/README.md) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-identity/README.md) |
| [`workspace-web-identity/authsettings.properties.managed-identity.example.json`](workspace-web-identity/authsettings.properties.managed-identity.example.json) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-identity/authsettings.properties.managed-identity.example.json) |
| [`workspace-web-identity/authsettings.properties.sas.example.json`](workspace-web-identity/authsettings.properties.sas.example.json) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-identity/authsettings.properties.sas.example.json) |
| [`workspace-web-identity/validate_examples.py`](workspace-web-identity/validate_examples.py) | [Platform source](https://github.com/DoHorizon-AI/Cyrene-Platform/blob/35e18cfd127d12ee7be7b88f93725a53e4f43a39/infrastructure/azure/workspace-web-identity/validate_examples.py) |

The six migration links in `workspace-data/README.md` point to the Platform
SQL migration source files at the same commit, because those implementation
files remain outside this consumer deployment transfer.

<!-- 中文说明：这些 review-only 部署资料由 Cyrene-Client 作为消费仓库接收，来源是上方固定的 Platform develop commit。逐文件来源链接保留了原仓库归属证据。原有 review 状态和部署门槛仍有效；本次迁移不授权或执行 Azure 部署，也不转移服务实现及授权职责。数据文档中的六个迁移链接固定指向 Platform SQL 源文件；这些实现文件不属于本次迁移。 -->
