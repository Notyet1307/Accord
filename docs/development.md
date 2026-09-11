# 开发、验证与运行

先从 [当前工作入口](work/current.md) 核对任务与基线。以下命令说明验证方式，不代表本次接管重新执行了测试，也不自动授权真实外部运行。

## OMP 与 Skills 入口

2026-09-11 静态核验：`/opt/homebrew/bin/omp` 指向 Homebrew OMP 18.1.17；用户级 `~/.agents/skills` 可被该版本默认发现。仓库没有 `.omp` 不代表 OMP 不可用。安装、静态发现条件与实际会话加载是不同证据：本轮未启动 OMP，未验证启动参数、同名覆盖或加载警告。精确路径、摘要和 Matt Skills 缺失条目见 [接管回执](handoff-receipt-2026-09-11.md)。

选择 Matt 方法或核对其授权边界时读 [Skill 使用衔接](agents/skill-usage.md)；涉及角色、绑定或 capset 词义时读 [词表](../CONTEXT.md)。当前 Codex 会话的工作只能按实际工具记录归档，不能记为 OMP 执行。OMP 启动发现验收需先固定无 prompt 命令及允许的本地状态写入，不自动安装或修改全局设置。

## 工具链与离线检查

版本以 [.node-version](../.node-version)、[package.json](../package.json) 和锁文件为准：Node 24.19.0，npm 11.17.0。本机系统 `node` 可能是不同版本；使用已经安装的项目 pinned Node，或由自己的版本管理器选择精确版本。

```sh
# 在 Accord 根目录；仅适用于已存在该可选依赖的 Apple Silicon 本机
export PATH="$PWD/node_modules/node-bin-darwin-arm64/bin:$PATH"
node --version
npm run typecheck
npm run build
npm run test:r004
```

| 操作 | 命令/入口 | 副作用与证明范围 |
| --- | --- | --- |
| 依赖安装 | `npm ci --ignore-scripts --no-audit --no-fund` | 更换 node_modules、可能联网；本次未运行 |
| 构建 | `npm run build` | 重建 dist，不启动服务 |
| R004 局部验收 | `npm run test:r004`（先构建） | 临时 SQLite、测试消息与 fake SAS；测试数量以受测版本记录为准 |
| 完整 CI | `./scripts/validate-ci.sh` | 需已安装依赖和 TMPDIR/RUNNER_TEMP；精确 Node 检查、重建 dist、临时 SQLite/文件/子进程，C4 对自有 worker 执行 SIGKILL；不提供 operator qualification |
| 受信本地资格 | operator-owned launcher → `./scripts/validate-delivery.sh` | 解释仓库 shell 前建立真实无网/文件隔离、私有 TMPDIR 与只读离线 cache；内部 npm ci --offline 会物化依赖并运行测试；需要精确版本、launcher/profile 哈希和 BOUNDARY 证据，不能仅设置 marker |
| SAS 合同样例 | 独立 SAS 树 `python3 scripts/verify_dialogue_fixtures.py` / `make verify` | schema/样例及 SAS 仓库检查；没有真实对话 API 或模型运行 |

2026-09-10 [接管报告](handoff-receipt.md)引用旧 manifest 的 314 项离线通过（含 11 项 R004），只证明该 manifest 绑定的版本；2026-09-11 调查及本次文档修补未重跑或重新核验原始日志。普通 GitHub CI 先安装锁定依赖，再运行 validate-ci.sh；它与可信本地资格、真实外部联调分别报告。文档整理后的说明文字与旧 manifest 的逐文件 hash 会不同；原日志只证明其实际测试版本，不应修改旧 manifest 来让它“重新匹配”。

## 实际运行入口

**R004 当前没有可运行的 live CLI 或 UI 装配。** 可在集成测试中验证 `R004Dialogue.receive / advance / flush`，其端口只能作为离线接缝使用。不要把 R003 CLI 接上 SAS URL，当作完成 R004 集成。

R003 受控真实运行入口是 `node scripts/run-r003.mjs --live --database <绝对路径> --config <绝对路径> --credentials <绝对路径>`。具体参数/校验以该脚本和 [真实执行 Spec](specs/r003-live-qualification.md) 为准。它会连接 MagicChat、消耗模型调用并可能发消息，需对应运行授权。凭据仅保留在私有文件，不贴进文档、命令记录或仓库。该入口写 SQLite/WAL；`--retry-unknown` 需要明确的重试授权。正常联调不替代真实故障窗口验收，见 [接管回执](handoff-receipt-2026-09-11.md)。

SAS 日常开发必须先确认工作树：主工作树可能包含输入阶段的个人改动，独立 dialogue 树则基于旧提交。开始集成前应比较最新 main 与目标补丁，选择隔离基线；不要直接 checkout、覆盖或复用旧分支来宣称当前能力。

## 恢复与接管

R003 schema 12 与 R004 独立 schema 1 不互换数据库。保留未知操作、待确认消息及证据；代码回退不能当作数据回滚，删除数据库也不是恢复。

新会话先核对 Git/Issue/Spec，再选择一个具体任务；完成后回填真实 PR 证据与导航指针。只因文档改变无需重跑产品测试；代码或行为合同变化时重跑受影响检查。发布、真实运行与生产权限按 [delivery gate](agents/delivery-gate.md) 处理。
