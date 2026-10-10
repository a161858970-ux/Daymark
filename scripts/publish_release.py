"""Daymark one-shot release publisher (single-release phase: v0.1.0).

User's release policy (2026-10-08):
- While v0.1.0 is the CURRENT release, every update OVERWRITES that one
  release: assets are replaced and the tag is force-moved to HEAD so the
  auto-generated "Source code (zip/tar.gz)" archives refresh too.
- The app's internal semver climbs (0.1.1, 0.1.2, …) — that is what the
  updater compares; the GitHub release page stays v0.1.0.
- After 0.1.0 is final, later updates become NEW tagged releases.

PR-006 hardening (2026-10-11): the live update manifest must NEVER reference
an asset that is not already uploaded and downloadable. The old flow wrote
the manifest first and replaced the fixed-name GitHub APK afterwards, leaving
a window where clients pulled a manifest pointing at the wrong package. The
hardened flow:

  1. STAGE   upload new GitHub assets under VERSIONED immutable names
             (daymark_<v>_x64-setup.exe, app-universal-release-<v>.apk) and
             the same versioned files to the VPS. Nothing user-visible
             changes: the old manifest keeps referencing untouched old assets.
  2. VERIFY  every URL the NEW manifest references must answer 200 with the
             expected size BEFORE the flip; the OLD manifest's URLs must still
             answer 200 as well. Any failure aborts with nothing flipped.
  3. FLIP    atomically replace /opt/daymark/update/latest.json via SFTP
             posix_rename (put tmp + rename = one flip point).
  4. TAG/BODY force-move v0.1.0 and patch the release body (as before).
  5. ALIASES best-effort refresh of the legacy fixed names AFTER the flip:
             GitHub app-universal-release.apk (old links / README) and the
             VPS mirror app-universal-release.apk (client offline fallback,
             see apps/web/src/updateService.ts mirrorUrl()). Pre-flip these
             names still serve the OLD manifest's package, so they must only
             be overwritten once no live manifest references them.
  6. CLEANUP delete stale versioned assets, keeping the newest KEEP_VERSIONS
             versions. Never deletes anything referenced by the live manifest,
             never deletes legacy alias names.

Failure recovery: any failure before step 3 leaves the live manifest and every
asset it references fully intact — just re-run. Steps 1 and 5 are idempotent
(same-name same-size assets are left in place; only stale same-name assets of
the in-flight version are replaced).

Prerequisites: `tauri build` already ran with
TAURI_SIGNING_PRIVATE_KEY=E:\\devtools\\tauri-keys\\daymark.key (so .sig
files exist next to the bundles).
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Version in the filename climbs with every bump — glob instead of pinning.
EXE = (
    sorted(
        glob.glob(os.path.join(ROOT, "src-tauri/target/release/bundle/nsis/*_x64-setup.exe")),
        key=os.path.getmtime,
        reverse=True,
    )
    or [""]
)[0]
APK = os.path.join(ROOT, "src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk")
KEY = r"E:\devtools\tauri-keys\daymark.key"
BASE = "https://api.daymark.top/update"
MANIFEST_URL = f"{BASE}/latest.json"
TAG = "v0.1.0"
SSH_HOST, SSH_USER = "206.187.209.142", "root"
SSH_KEY = os.path.expanduser(r"~\.ssh\id_ed25519_daymark2")
SERVER_UPDATE_DIR = "/opt/daymark/update"
# Legacy fixed asset/mirror name kept alive for old links and the client's
# offline fallback (updateService.ts mirrorUrl()). Never versioned, never
# deleted by cleanup.
LEGACY_APK_NAME = "app-universal-release.apk"
KEEP_VERSIONS = 2


def die(msg: str) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def sign_file(path: str) -> str:
    """Return signature file contents, signing on demand if missing."""
    sig_path = path + ".sig"
    if not os.path.exists(sig_path):
        cli = r"E:\devtools\tauri-cli-src\tauri-cli-2.12.1\target\release\cargo-tauri.exe"
        # `-k` takes the key CONTENT; `-f` takes the file path.
        result = subprocess.run([cli, "signer", "sign", "-f", KEY, path],
                                capture_output=True, timeout=120)
        if result.returncode != 0:
            die(f"补签失败 {path}: {result.stderr.decode(errors='replace')[:300]}")
    if not os.path.exists(sig_path):
        die(f"签名缺失: {sig_path}")
    return open(sig_path, encoding="utf-8").read().strip()


def github_token() -> str:
    env = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if env:
        return env.strip()
    # Windows-friendly credential helper (no bash required).
    payload = "protocol=https\nhost=github.com\n\n"
    try:
        out = subprocess.run(
            ["git", "credential", "fill"],
            input=payload.encode(),
            cwd=ROOT,
            capture_output=True,
            timeout=60,
        ).stdout.decode(errors="replace")
    except OSError:
        out = ""
    for line in out.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1].strip()
    die("GitHub token 获取失败")
    return ""


# --------------------------------------------------------------------------
# Pure helpers (unit-tested in scripts/test_publish_release.py)
# --------------------------------------------------------------------------


def asset_names(version: str) -> tuple[str, str]:
    """Versioned immutable asset names (ASCII — GitHub strips non-ASCII)."""
    return (f"daymark_{version}_x64-setup.exe",
            f"app-universal-release-{version}.apk")


def build_manifest(version: str, exe_sig: str, apk_sig: str,
                   notes: str, pub_date: str | None = None) -> dict:
    exe_name, apk_name = asset_names(version)
    pub_date = pub_date or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # The android URL is the versioned GitHub asset — immutable, so the live
    # manifest can never point at a package that gets overwritten in place.
    apk_url = f"https://github.com/violetsnowl/Daymark/releases/download/{TAG}/{apk_name}"
    return {
        "version": version,
        "notes": notes,
        "pub_date": pub_date,
        "platforms": {
            "windows-x86_64": {
                "signature": exe_sig,
                "url": f"{BASE}/{exe_name}",
            },
            # Same universal APK; several keys so every arch matches our JS
            # lookup (aarch64 first) and any future native lookup. Android
            # downloads ride the GitHub release CDN (VPS uplink is ~0.3Mbps);
            # the server keeps a mirror copy for the client's fallback.
            "android-aarch64": {"signature": apk_sig, "url": apk_url},
            "android-armv7": {"signature": apk_sig, "url": apk_url},
            "android-x86_64": {"signature": apk_sig, "url": apk_url},
        },
    }


def manifest_targets(manifest: dict, exe_size: int, apk_size: int) -> list[tuple[str, int]]:
    """(url, expected_size) for every distinct URL the manifest references."""
    seen: dict[str, int] = {}
    for name, entry in manifest["platforms"].items():
        size = exe_size if name.startswith("windows") else apk_size
        seen.setdefault(entry["url"], size)
    return list(seen.items())


def parse_asset_version(name: str) -> str | None:
    """'daymark_0.1.16_x64-setup.exe' / 'app-universal-release-0.1.16.apk'
    → '0.1.16'; legacy alias names → None (never managed by cleanup)."""
    m = re.match(r"^daymark_(\d+\.\d+\.\d+)_x64-setup\.exe$", name)
    if m:
        return m.group(1)
    m = re.match(r"^app-universal-release-(\d+\.\d+\.\d+)\.apk$", name)
    return m.group(1) if m else None


def _version_key(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split("."))


def select_cleanup(assets: list[dict], live_urls: set[str],
                   keep_versions: int = KEEP_VERSIONS) -> list[dict]:
    """Assets safe to delete: versioned names only, older than the newest
    `keep_versions`, and never referenced by the live manifest."""
    versions = sorted({v for v in (parse_asset_version(a["name"]) for a in assets) if v},
                      key=_version_key)
    keep = set(versions[-keep_versions:])
    out = []
    for a in assets:
        v = parse_asset_version(a["name"])
        if v is None or v in keep:
            continue
        if a.get("browser_download_url") in live_urls:
            continue
        out.append(a)
    return out


# --------------------------------------------------------------------------
# Transport implementations
# --------------------------------------------------------------------------


class RealTransport:
    """Production transport: GitHub REST + SFTP + git tag + curl PATCH."""

    def __init__(self) -> None:
        self.token = github_token()
        import urllib.error  # noqa: F401  (kept for urlopen error paths)
        import urllib.parse
        import urllib.request
        self._urllib_request = urllib.request
        self._urllib_parse = urllib.parse
        import paramiko  # provided via `uv run --with paramiko`
        self._paramiko = paramiko

    # -- GitHub ---------------------------------------------------------
    def api(self, url: str, data: bytes | None = None, method: str | None = None,
            content_type: str | None = None):
        headers = {
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "User-Agent": "daymark-release"}
        if content_type:
            # urllib defaults to urlencoded when a body is present; GitHub
            # rejects that for release assets (422 content_type).
            headers["Content-Type"] = content_type
        req = self._urllib_request.Request(url, data=data, method=method, headers=headers)
        try:
            with self._urllib_request.urlopen(req, timeout=300) as resp:
                body = resp.read()
                return resp.status, json.loads(body) if body else None
        except Exception as exc:  # urllib.error.HTTPError and friends
            code = getattr(exc, "code", None)
            if code is not None:
                return code, exc.read().decode(errors="replace")[:200]
            raise

    def get_release(self) -> dict:
        status, rel = self.api(f"https://api.github.com/repos/violetsnowl/Daymark/releases/tags/{TAG}")
        if status != 200:
            die(f"读取 release 失败: {status} {rel}")
        return rel

    def upload_asset(self, name: str, path: str) -> int:
        rel = self.get_release()
        upload_url = rel["upload_url"].split("{")[0]
        # Chinese product names must be percent-encoded for the URL.
        status, resp = self.api(f"{upload_url}?name={self._urllib_parse.quote(name)}",
                                data=open(path, "rb").read(),
                                method="POST", content_type="application/octet-stream")
        if status not in (200, 201) or not isinstance(resp, dict):
            die(f"上传 {name} 失败: {status} {resp}")
        return int(resp.get("size") or 0)

    def delete_asset(self, asset_id: int) -> None:
        # NOTE: asset deletion answers 301 → urllib would not replay DELETE
        # through the redirect; curl -L does, and this is the proven path.
        subprocess.run(
            ["curl", "-sSL", "-o", os.devnull, "-X", "DELETE",
             "-H", f"Authorization: Bearer {self.token}",
             f"https://api.github.com/repos/violetsnowl/Daymark/releases/assets/{asset_id}"],
            check=False, capture_output=True, timeout=60)

    # -- Server (SFTP) --------------------------------------------------
    def _sftp(self):
        client = self._paramiko.SSHClient()
        client.set_missing_host_key_policy(self._paramiko.AutoAddPolicy())
        client.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY,
                       timeout=12, banner_timeout=12, auth_timeout=12,
                       look_for_keys=False, allow_agent=False)
        client.exec_command(f"mkdir -p {SERVER_UPDATE_DIR}")
        return client, client.open_sftp()

    def server_put(self, local: str, remote: str) -> None:
        client, sftp = self._sftp()
        try:
            sftp.put(local, remote)
        finally:
            sftp.close()
            client.close()

    def server_atomic_put(self, local: str, remote: str) -> None:
        """Upload to a tmp name, then ONE rename — the flip point."""
        client, sftp = self._sftp()
        try:
            tmp = remote + ".tmp"
            sftp.put(local, tmp)
            try:
                sftp.posix_rename(tmp, remote)  # OpenSSH: overwrites atomically
            except (IOError, OSError, self._paramiko.SFTPError):
                # Fallback (non-OpenSSH): brief remove+rename window.
                try:
                    sftp.remove(remote)
                except IOError:
                    pass
                sftp.rename(tmp, remote)
        finally:
            sftp.close()
            client.close()

    # -- Misc -----------------------------------------------------------
    def fetch_json(self, url: str) -> dict | None:
        status, body = self.api(url)
        return body if status == 200 and isinstance(body, dict) else None

    def probe(self, url: str) -> tuple[int, int]:
        """(status, Content-Length) without downloading the body."""
        req = self._urllib_request.Request(url, method="HEAD",
                                           headers={"User-Agent": "daymark-release"})
        try:
            with self._urllib_request.urlopen(req, timeout=60) as resp:
                return resp.status, int(resp.headers.get("Content-Length") or -1)
        except Exception as exc:
            code = getattr(exc, "code", None)
            return (code or 0), -1

    def move_tag(self) -> None:
        subprocess.run(["git", "tag", "-f", TAG, "HEAD"], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(["git", "push", "-f", "origin", TAG], cwd=ROOT, check=True,
                       capture_output=True, timeout=120, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})

    def set_body(self, release_id: int, body: str) -> None:
        # PATCH answers 307 here and urllib refuses to replay bodies through
        # redirects — curl -L follows and keeps the method.
        body_file = os.path.join(os.environ.get("TMPDIR", "."), "release_body.json")
        json.dump({"body": body}, open(body_file, "w", encoding="utf-8"), ensure_ascii=False)
        code = subprocess.run(
            ["curl", "-sSL", "-o", os.devnull, "-w", "%{http_code}",
             "-X", "PATCH",
             "-H", f"Authorization: Bearer {self.token}",
             "-H", "Accept: application/vnd.github+json",
             "--data-binary", f"@{body_file}",
             f"https://api.github.com/repos/violetsnowl/Daymark/releases/{release_id}"],
            capture_output=True, timeout=120,
        ).stdout.decode().strip()
        if code not in ("200", "201"):
            die(f"更新 Release 正文失败: {code}")


# --------------------------------------------------------------------------
# Orchestration (unit-tested against a fake transport)
# --------------------------------------------------------------------------


def publish(t, cfg) -> None:
    """cfg: namespace with exe, apk, exe_name, apk_name, exe_size, apk_size,
    manifest, manifest_path, body, keep_versions."""
    exe_name, apk_name = cfg.exe_name, cfg.apk_name

    # --- Phase 1: STAGE new assets (old manifest + old assets untouched) ---
    rel = t.get_release()
    live = t.fetch_json(MANIFEST_URL)
    if live is None:
        die("线上 latest.json 不可读——在任何变更前停止")
    live_urls = {e["url"] for e in live["platforms"].values()}

    for name, path, want in ((exe_name, cfg.exe, cfg.exe_size), (apk_name, cfg.apk, cfg.apk_size)):
        stale = [a for a in rel["assets"] if a["name"] == name]
        skip_upload = False
        for a in stale:
            if int(a.get("size") or -1) == want:
                # Same name AND same size — treat as already uploaded
                # (re-run case); never delete or re-upload (GitHub answers
                # 422 on duplicate names anyway).
                skip_upload = True
                continue
            if a.get("browser_download_url") in live_urls:
                die(f"同名资产 {name} 正被线上清单引用且大小不符——人工调查，拒绝覆盖")
            else:
                t.delete_asset(a["id"])
        if not skip_upload:
            uploaded = t.upload_asset(name, path)
            if uploaded and uploaded != want:
                die(f"上传大小不符 {name}: {uploaded} != {want}")

    # Versioned server copies (new names; old mirror files untouched).
    t.server_put(cfg.exe, f"{SERVER_UPDATE_DIR}/{exe_name}")
    t.server_put(cfg.apk, f"{SERVER_UPDATE_DIR}/{apk_name}")

    # --- Phase 2: VERIFY everything the (old AND new) manifests reference ---
    for url, want in manifest_targets(cfg.manifest, cfg.exe_size, cfg.apk_size):
        status, size = t.probe(url)
        if status != 200:
            die(f"翻转前校验失败（新清单目标不可下载）: {url} → HTTP {status}；未翻转，可直接重跑")
        if size not in (-1, want):
            die(f"翻转前校验失败（大小不符）: {url} {size} != {want}；未翻转，可直接重跑")
    for url in sorted(live_urls):
        status, _ = t.probe(url)
        if status != 200:
            die(f"翻转前校验失败（旧清单目标失效）: {url} → HTTP {status}；未翻转，先恢复旧资产")
    print(f"[1/6] 新资产已暂存并逐项校验（{exe_name} / {apk_name}）")

    # --- Phase 3: FLIP (single atomic point) ----------------------------
    with open(cfg.manifest_path, "w", encoding="utf-8") as fh:
        json.dump(cfg.manifest, fh, ensure_ascii=False, indent=2)
    t.server_atomic_put(cfg.manifest_path, f"{SERVER_UPDATE_DIR}/latest.json")
    print(f"[2/6] 线上清单已原子翻转 → {cfg.manifest['version']}")

    # --- Phase 4: tag + body -------------------------------------------
    t.move_tag()
    print(f"[3/6] tag {TAG} 已强推至 HEAD（Source code 压缩包随之刷新）")
    if cfg.body:
        t.set_body(rel["id"], cfg.body)
        print("[4/6] Release 正文已更新（白话版）")
    else:
        print("[4/6] Release 正文未变（--body 留空）")

    # --- Phase 5: legacy alias refresh (AFTER flip, best-effort) --------
    # GitHub fixed-name alias (old links/README) + VPS fixed-name mirror
    # (client fallback mirrorUrl()). Pre-flip these names serve the OLD
    # manifest's package, so only now is it safe to overwrite them.
    try:
        rel2 = t.get_release()
        legacy = [a for a in rel2["assets"] if a["name"] == LEGACY_APK_NAME]
        for a in legacy:
            t.delete_asset(a["id"])
        t.upload_asset(LEGACY_APK_NAME, cfg.apk)
        t.server_put(cfg.apk, f"{SERVER_UPDATE_DIR}/{LEGACY_APK_NAME}")
        print(f"[5/6] 固定名别名已刷新（GitHub+VPS {LEGACY_APK_NAME}）")
    except Exception as exc:  # noqa: BLE001 — 别名失败不阻断发布
        print(f"[5/6] WARN 固定名别名刷新失败（不影响清单一致性）: {exc}")

    # --- Phase 6: cleanup (never live-referenced, never aliases) --------
    rel3 = t.get_release()
    live3 = t.fetch_json(MANIFEST_URL) or live
    live3_urls = {e["url"] for e in live3["platforms"].values()}
    for a in select_cleanup(rel3["assets"], live3_urls, cfg.keep_versions):
        t.delete_asset(a["id"])
        print(f"[6/6] 已清理旧版本资产: {a['name']}")
    names = sorted(a["name"] for a in t.get_release()["assets"])
    print(f"[6/6] 回读资产: {names}")
    print(f"完成。清单: {MANIFEST_URL}  版本 {cfg.manifest['version']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--notes", default="")
    parser.add_argument("--body", default="", help="Release 正文（白话版，留空则不动）")
    args = parser.parse_args()

    for path in (EXE, APK):
        if not os.path.exists(path):
            die(f"产物缺失（先带签名环境构建）: {path}")
    conf = json.load(open(os.path.join(ROOT, "src-tauri/tauri.conf.json"), encoding="utf-8"))
    version = conf["version"]
    exe_sig, apk_sig = sign_file(EXE), sign_file(APK)
    exe_name, apk_name = asset_names(version)
    manifest = build_manifest(version, exe_sig, apk_sig,
                              args.notes or f"Daymark {version}")

    from types import SimpleNamespace
    cfg = SimpleNamespace(
        version=version, exe=EXE, apk=APK, exe_name=exe_name, apk_name=apk_name,
        exe_size=os.path.getsize(EXE), apk_size=os.path.getsize(APK),
        manifest=manifest,
        manifest_path=os.path.join(os.environ.get("TMPDIR", "."), "latest.json"),
        body=args.body, keep_versions=KEEP_VERSIONS,
    )
    publish(RealTransport(), cfg)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
