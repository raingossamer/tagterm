# Project Skills

本项目定义了以下开发流程 Skills，位于 ProjectModel/Skills/ 目录。
当用户提到对应的关键词或进入对应的开发阶段时，必须读取对应的 SKILL.md 并严格遵循其流程。

## 开发流水线

grill-me-with-design → write-a-spec → spec-to-plan → tdd →(自动) design-doc-sync

旁路工具（按需显式触发）：to-design、read-design-before-code、improve-codebase-architecture（只产出 RFC、不改代码，其 RFC 经用户显式输入 "rfc to plan" 走快车道实施）

## Skill 触发规则

| Trigger keywords | Skill | File path |
|------------------|-------|-----------|
| "grill me", "grill me simple"（中型改动路径）, "stress-test design", "validate my design" | grill-me-with-design | ProjectModel/Skills/grill-me-with-design/SKILL.md |
| "write spec", "create spec", "draft spec" | write-a-spec | ProjectModel/Skills/write-a-spec/SKILL.md |
| "spec to plan", "rfc to plan"（RFC 快车道）, "convert spec to plan", "break down spec" | spec-to-plan | ProjectModel/Skills/spec-to-plan/SKILL.md |
| "tdd", "tdd auto"（连续执行切片模式）, "red green refactor", "test-driven development" | tdd | ProjectModel/Skills/tdd/SKILL.md |
| "sync design docs", "update design docs" | design-doc-sync | ProjectModel/Skills/design-doc-sync/SKILL.md |
| "improve architecture", "review architecture", "deepen modules" | improve-codebase-architecture | ProjectModel/Skills/improve-codebase-architecture/SKILL.md |
| "edit code" / "modify code" (outside TDD flow) | read-design-before-code | ProjectModel/Skills/read-design-before-code/SKILL.md |
| "to design" | to-design | ProjectModel/Skills/to-design/SKILL.md |

## 工作规则

1. 当触发任何 Skill 时，先读取对应的 SKILL.md 全文，再严格按照其中的流程执行
2. 每个 Skill 完成后，按照 Pipeline Position 中的下游指引进入下一步。以下衔接**自动执行**（无需用户再次触发）：grill-me-with-design → write-a-spec（主流水线）；grill-me-with-design → tdd（"grill me simple" 中型路径）；tdd → design-doc-sync（全部路径）；read-design-before-code 改码完成 → design-doc-sync。improve-codebase-architecture 不在流水线内，由 design-doc-sync 收尾提示后用户按需**显式触发**；其 RFC 由用户显式输入 "rfc to plan" 走快车道实施；其余衔接均需用户确认
3. 所有 Skill 产出的文档存放在 ProjectModel/Todo/ 目录下对应的子目录中
4. 设计文档位于 ProjectModel/Design/ 目录
5. ProjectModel 范式框架与目录结构说明见 `ProjectModel/README.md`（框架权威总入口）。项目级代码规范位于各 Design 文档的规范章节（`frontend.md` / `backend.md`「设计模式与约定」、`database/sql.md`「约定」），不设独立规范文件 —— 由 `to-design` 首次建立（逆向：每条附本项目代码 / 配置证据，无证据写待确认；正向：按选定技术栈的社区基线草拟、汇总确认一次），也可由用户手工维护；to-design 遇已填规范章节默认建议合并，**不得静默覆盖**。改码中产生的规范候选由 `tdd`（单切片模式每片完成时、auto 模式全部完成时）与 `read-design-before-code`（改码完成时）列出，**经用户显式判定后才写入**；`design-doc-sync` 只同步架构章节，不改动规范章节；`tdd` 与 `read-design-before-code` 在改码前**必读**相关 Design 文档（含规范章节）。
6. 本触发规则文件（`CLAUDE.md`、`AGENTS.md`、`.github/copilot-instructions.md`）三份内容必须保持完全一致；修改任意一份时，必须同步另外两份。
