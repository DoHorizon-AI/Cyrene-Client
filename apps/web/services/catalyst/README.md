# Catalyst Web UI / Catalyst Web 界面

Reserved for an independently buildable Catalyst UI module. Dataset views remain integrated in the shared workbench; no standalone package or downloadable bundle exists yet.

此目录预留给可独立构建的 Catalyst UI 模块。数据集界面仍集成在共享工作台中；当前没有独立 package 或可下载 bundle。

## Training data curation / 训练数据整理

The shared Catalyst dataset page can upload JSON and JSONL training sources, select an automatic or manual format and field/role mapping, and start the versioned `curateTrainingData` run. Source training use requires an explicit consent checkbox. The review panel pages immutable record snapshots, shows source lineage and raw/normalized content, filters by disposition or issue code, and saves record approvals, corrections, and exclusions as child revisions. The existing full content approval remains required before building and publishing.

共享 Catalyst 数据集页面可以上传 JSON 和 JSONL 训练来源，选择自动或手动格式及字段/角色映射，并启动版本化的 `curateTrainingData` 任务。用于训练的来源必须经过显式用途确认。审核面板按页读取不可变记录快照，展示来源血缘及原始/规范化内容，按处理状态或问题代码筛选，并将样本批准、修正和排除保存为子修订。构建和发布前仍需批准整个内容修订。
