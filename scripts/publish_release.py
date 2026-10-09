"""Daymark one-shot release publisher (single-release phase: v0.1.0).

User's release policy (2026-10-08):
- While v0.1.0 is the CURRENT release, every update OVERWRITES that one
  release: assets are replaced and the tag is force-moved to HEAD so the
  auto-generated "Source code (zip/tar.gz)" archives refresh too.
- The app's internal semver climbs (0.1.1, 0.1.2, …) — that is what the
  updater compares; the GitHub release page stays v0.1.0.
- After 0.1.0 is final, later updates become NEW tagged releases.

Prerequisites: `tauri build` already ran with
TAURI_SIGNING_PRIVATE_KEY=E:\\devtools\\tauri-keys\\daymark.key (so .sig
files exist next to the bundles).

Steps: verify sigs → build latest.json → SFTP artifacts+manifest to
/opt/daymark/update → force-move tag v0.1.0 → replace GitHub assets.
"""

from __future__ import annotations

import argparse
import datetime
import glob
import json
import os
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
GITHUB_APK_URL = (
    "https://github.com/violetsnowl/Daymark/releases/download/v0.1.0/app-universal-release.apk"
)
TAG = "v0.1.0"
SSH_HOST, SSH_USER = "206.187.209.142", "root"
SSH_KEY = os.path.expanduser(r"~\.ssh\id_ed25519_daymark2")


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
    pub_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # File-side naming is always ASCII (user rule: 拾序 for product UI,
    # daymark for files) — GitHub strips non-ASCII asset names, and the
    # manifest URL must match the stored asset exactly.
    exe_name, apk_name = f"daymark_{version}_x64-setup.exe", os.path.basename(APK)

    manifest = {
        "version": version,
        "notes": args.notes or f"Daymark {version}",
        "pub_date": pub_date,
        "platforms": {
            "windows-x86_64": {
                "signature": exe_sig,
                "url": f"{BASE}/{exe_name}",
            },
            # Same universal APK; several keys so every arch matches our JS
            # lookup (aarch64 first) and any future native lookup.
            # Android downloads ride the GitHub release CDN: the VPS uplink
            # is a few hundred KB/s (measured 39 KB/s once) while GitHub
            # assets served the phone fine for manual installs. The server
            # copy above stays as a mirror.
            "android-aarch64": {"signature": apk_sig, "url": GITHUB_APK_URL},
            "android-armv7": {"signature": apk_sig, "url": GITHUB_APK_URL},
            "android-x86_64": {"signature": apk_sig, "url": GITHUB_APK_URL},
        },
    }
    manifest_path = os.path.join(os.environ.get("TMPDIR", "."), "latest.json")
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # --- 1) Server: artifacts + manifest -------------------------------
    import paramiko  # imported late; provided via `uv run --with paramiko`

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(SSH_HOST, username=SSH_USER, key_filename=SSH_KEY,
                   timeout=12, banner_timeout=12, auth_timeout=12,
                   look_for_keys=False, allow_agent=False)
    client.exec_command("mkdir -p /opt/daymark/update")
    sftp = client.open_sftp()
    sftp.put(EXE, f"/opt/daymark/update/{exe_name}")
    sftp.put(APK, f"/opt/daymark/update/{apk_name}")
    sftp.put(manifest_path, "/opt/daymark/update/latest.json")
    sftp.close()
    client.close()
    print(f"[1/4] 服务器已更新 /opt/daymark/update/ （{version}）")

    # --- 2) Move the tag so GitHub regenerates source archives ---------
    subprocess.run(["git", "tag", "-f", TAG, "HEAD"], cwd=ROOT, check=True, capture_output=True)
    subprocess.run(["git", "push", "-f", "origin", TAG], cwd=ROOT, check=True,
                   capture_output=True, timeout=120, env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    print("[2/4] tag v0.1.0 已强推至 HEAD（Source code 压缩包随之刷新）")

    # --- 3) Replace release assets ------------------------------------
    token = github_token()
    import urllib.parse
    import urllib.request

    def api(url: str, data: bytes | None = None, method: str | None = None,
            content_type: str | None = None) -> tuple[int, object]:
        headers = {
            "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
            "User-Agent": "daymark-release"}
        if content_type:
            # urllib defaults to urlencoded when a body is present; GitHub
            # rejects that for release assets (422 content_type).
            headers["Content-Type"] = content_type
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                body = resp.read()
                return resp.status, json.loads(body) if body else None
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode(errors="replace")[:200]

    status, rel = api(f"https://api.github.com/repos/violetsnowl/Daymark/releases/tags/{TAG}")
    if status != 200:
        die(f"读取 release 失败: {status} {rel}")
    # NOTE: asset deletion answers 301 → urllib would not replay DELETE
    # through the redirect; curl -L does, and this is the proven path.
    for asset in rel["assets"]:
        subprocess.run(
            ["curl", "-sSL", "-o", os.devnull, "-X", "DELETE",
             "-H", f"Authorization: Bearer {token}",
             f"https://api.github.com/repos/violetsnowl/Daymark/releases/assets/{asset['id']}"],
            check=False, capture_output=True, timeout=60)
    upload_url = rel["upload_url"].split("{")[0]
    for path, name in ((EXE, exe_name), (APK, apk_name)):
        # Chinese product names (拾序_…) must be percent-encoded for the URL.
        status, resp = api(f"{upload_url}?name={urllib.parse.quote(name)}",
                           data=open(path, "rb").read(),
                           method="POST", content_type="application/octet-stream")
        size = resp.get("size") if isinstance(resp, dict) else None
        if status not in (200, 201):
            die(f"上传 {name} 失败: {status} {resp}")
        print(f"[3/4] Release 资产已替换: {name} ({size} B)")

    # --- 4) Verify ------------------------------------------------------
    status, final = api(f"https://api.github.com/repos/violetsnowl/Daymark/releases/tags/{TAG}")
    names = [a["name"] for a in final["assets"]] if isinstance(final, dict) else []
    if args.body:
        # PATCH answers 307 here and urllib refuses to replay bodies
        # through redirects — curl -L follows and keeps the method.
        body_file = os.path.join(os.environ.get("TMPDIR", "."), "release_body.json")
        json.dump({"body": args.body}, open(body_file, "w", encoding="utf-8"), ensure_ascii=False)
        code = subprocess.run(
            ["curl", "-sSL", "-o", os.devnull, "-w", "%{http_code}",
             "-X", "PATCH",
             "-H", f"Authorization: Bearer {token}",
             "-H", "Accept: application/vnd.github+json",
             "--data-binary", f"@{body_file}",
             f"https://api.github.com/repos/violetsnowl/Daymark/releases/{rel['id']}"],
            capture_output=True, timeout=120,
        ).stdout.decode().strip()
        if code not in ("200", "201"):
            die(f"更新 Release 正文失败: {code}")
        print("[4/4] Release 正文已更新（白话版）")
    print(f"[4/4] 回读资产: {names}")
    print(f"完成。清单: {BASE}/latest.json  版本 {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
