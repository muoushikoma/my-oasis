# Code signing policy / 代码签名政策

**English** · [中文](#中文)

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

> Status: the application to the SignPath Foundation open source program is pending. Until it is approved, Windows installers on the [Releases](https://github.com/muoushikoma/my-oasis/releases) page are **not** Authenticode-signed (Windows SmartScreen may show "unknown publisher"). Android APKs are signed with the project's own release key.

## What is signed

- Windows installers (`.msi` / `-setup.exe`) of the My Oasis client, built by the public [`windows-build`](../.github/workflows/windows-build.yml) GitHub Actions workflow directly from this repository's source code.
- Only binaries built from this repository are signed. Third-party upstream binaries are never signed with the project certificate.
- Signed binaries carry product name `My Oasis` and the version from `apps/desktop/src-tauri/tauri.conf.json`.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [muoushikoma](https://github.com/muoushikoma) (repository owner) |
| Approvers (approve each signing request) | [muoushikoma](https://github.com/muoushikoma) |

- Every change from a non-committer (pull request) is reviewed by a reviewer before merging, after the automated [security review](../.github/workflows/security-review.yml) runs.
- Every release is manually approved before it is signed.
- All team members use multi-factor authentication for GitHub and SignPath.

## Privacy

See the [privacy policy](privacy.md). In short: this program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it. The only network connections are to services the player configures or explicitly uses (their own AI provider, and GitHub for downloading or submitting stories).

## Uninstall

On Windows, uninstall from *Settings → Apps → Installed apps → My Oasis → Uninstall* (the installer registers a normal uninstaller). On Android, uninstall like any other app.

---

## 中文

免费代码签名由 [SignPath.io](https://about.signpath.io/) 提供，证书由 [SignPath Foundation](https://signpath.org/) 颁发。

> 现状：SignPath 基金会开源计划的申请还在等审核。批下来之前，[Releases](https://github.com/muoushikoma/my-oasis/releases) 里的 Windows 安装包**没有**签名（Windows 可能提示“未知发布者”）。安卓安装包已经用项目自己的正式证书签名。

### 签什么

- 「我的绿洲」客户端的 Windows 安装包（`.msi` / `-setup.exe`），由公开的 [`windows-build`](../.github/workflows/windows-build.yml) 自动流程直接从本仓库源码构建。
- 只签本仓库源码构建出来的文件，不用项目证书给第三方文件签名。
- 签名文件的产品名是 `My Oasis`，版本号取自 `apps/desktop/src-tauri/tauri.conf.json`。

### 团队分工

| 角色 | 成员 |
|---|---|
| 提交者和审核者 | [muoushikoma](https://github.com/muoushikoma)（仓库所有者） |
| 签名批准人（每次签名都要批准） | [muoushikoma](https://github.com/muoushikoma) |

- 非提交者的每个合并请求，都要先跑[自动安全审核](../.github/workflows/security-review.yml)，再由审核者看过才能合并。
- 每次发布都要人工批准后才签名。
- 所有成员的 GitHub 和 SignPath 账号都开启两步验证。

### 隐私

见[隐私政策](privacy.md)。简单说：除非用户本人要求，本程序不会把任何信息发送到其他网络系统。

### 卸载

Windows：*设置 → 应用 → 已安装的应用 → My Oasis → 卸载*。安卓：和普通应用一样卸载。
