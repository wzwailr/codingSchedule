# Floating Widget Redesign Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. Steps use checkbox syntax. User explicitly selected direct implementation; no further design approval is required.

**Goal:** 用 Ant Design 信息层级改进已有单悬浮窗，使任务、当前动作、进度与粗估时间更易扫读。

**Architecture:** 只调整原生 renderer 的 DOM、样式与快照映射；沿用 Electron 窗口和领域协议。

**Tech Stack:** 原有 TypeScript / HTML / CSS / Electron / Playwright，不增加依赖。

**Spec:** [设计与授权](../specs/2026-10-27-floating-widget-redesign.md)

## Global Constraints

- 保留收起 320×48、展开宽 360 / 高≤420 DIP，250ms 悬停、400ms 离开、不抢焦点。
- 未知进度不填充；AI 报告完成不是人工验收；粗估时间保持显式标注。
- 长内容安全 textContent，浅深主题，键盘可达，无持续动画。
- 阶段五继续；旧采样只作改版前基线，资源门槛不放宽。

## Review Focus

长中文标题/动作；未知进度切换时的可访问数值；等待与报告完成的语义；断连提示不遮挡操作；多任务更新不反复重建选定 DOM。

### UI01: 改进紧凑与展开视图

**Files:** Modify `src/renderer/index.html`, `styles.css`, `app.ts`; Test `tests/desktop/rendering.e2e.test.ts`; existing desktop tests cover geometry, focus, settings, isolation and recovery.

**Interfaces:** Consumes `RunSnapshot` and current preload commands. Produces the same public commands/IDs, adds compact task title and visual status attributes; no host/storage changes.

- [x] Extend the real Electron regression: selected title appears in compact view; waiting retains progress, task without a plan removes accessible percentage, reported completion remains unverified. Run against old UI and observe missing compact title failure.
- [x] Restructure HTML with scrollable detail body and reachable footer; add compact title/track. Map text/status/unknown progress from existing snapshots in `app.ts`.
- [x] Replace affected style rules with restrained blue/neutral tokens, readable type, semantic states and light/dark/reduced-motion rules. Preserve settings controls and health behavior.
- [x] After the ongoing baseline finishes, run build, desktop regression, typecheck, lint and real screenshot inspection. Correct observed clipping or interaction defects.
- [x] Refresh packaged candidate, MCP smoke/native hover and same-load performance evidence; update acceptance records and local checkpoint. Final native reference was covered before input; Private Bytes 428.62MiB fails 220MiB. Remaining resource/native/host gaps stay explicit; this checkbox records evidence refresh, not V1 acceptance.
