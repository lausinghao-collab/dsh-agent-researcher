# 给 DeepSeek Harness 里的 Agent：安装「资料搜集员」

不会手动安装？把下面整段复制，发给你 DeepSeek Harness 里的 Agent（新建任务即可），并把本仓库放在当前工作区可见的位置（或告诉它仓库路径）。

---

我克隆/下载了一个 DeepSeek Harness 的 Agent 组合包仓库 `dsh-agent-researcher`（「资料搜集员」），请帮我安装到 Harness 里，装完告诉我怎么验证、怎么卸载。

请按下面的规则做：

1. **先读** 仓库根目录的 `README.md`、`package.json` 和 `cordis.patch.yml`，确认这是一个 bundle（`dsh.bundle.patch` 指向 `cordis.patch.yml`），里面只声明 agent preset，没有可执行代码。
2. **优先推荐我用插件页安装**：告诉我具体步骤——插件 → 添加插件 → 填这个仓库的 Git 地址（`github:<owner>/<repo>`）或本地绝对路径 → 安装 → 启用。
3. **如果插件页装不上，手动兜底**：
   - Windows：运行 `install/install.ps1`（用 `powershell -NoProfile -ExecutionPolicy Bypass -File` 方式），它会先备份 profile 配置；
   - 其他系统：把 `install/preset.patch.yml` 追加到 profile 的 `cordis.patch.yml` 末尾，例如 `~/.dsh/profiles/desktop/cordis.patch.yml`。
4. **安全要求**：
   - 安装前必须备份 profile 配置文件；
   - 不要删除、覆盖或重排我原有的配置；
   - 如果文件里已经有 `preset-researcher`，说明已装过，不要再追加；
   - 不要同时用插件页和手动方式安装（会重复声明）。
5. **验证**：用 `dsh --profile <profile> --dump-config`（如果可用）确认组合里出现 `preset-researcher`；或让我刷新页面后打开 设置 → 通用 → Agent 预设，看有没有「资料搜集员」卡片。
6. 完成后用几句话告诉我：装到了哪个 profile、怎么用（新建任务选「资料搜集员」）、怎么回滚。

如果你判断当前环境权限不足或操作不了，直接告诉我原因和替代方案（例如让我自己在插件页点安装），不要冒险改坏配置。
