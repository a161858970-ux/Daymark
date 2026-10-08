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
    out = subprocess.run(
        ["bash", "-c",
         "printf 'protocol=https\\nhost=github.com\\n\\n' | git credential fill | grep '^password=' | sed 's/^password=//'"],
        cwd=ROOT, capture_output=True, timeout=60).stdout.decode().strip()
    if not out:
        die("GitHub token 获取失败")
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--notes", default="")
    args = parser.parse_args()

    for path in (EXE, APK):
        if not os.path.exists(path):
            die(f"产物缺失（先带签名环境构建）: {path}")
    conf = json.load(open(os.path.join(ROOT, "src-tauri/tauri.conf.json"), encoding="utf-8"))
    version = conf["version"]
    exe_sig, apk_sig = sign_file(EXE), sign_file(APK)
    pub_date = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    exe_name, apk_name = os.path.basename(EXE), os.path.basename(APK)

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
            "android-aarch64": {"signature": apk_sig, "url": f"{BASE}/{apk_name}"},
            "android-armv7": {"signature": apk_sig, "url": f"{BASE}/{apk_name}"},
            "android-x86_64": {"signature": apk_sig, "url": f"{BASE}/{apk_name}"},
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
    for path in (EXE, APK):
        sftp.put(path, f"/opt/daymark/update/{os.path.basename(path)}")
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

    status, rel = api(f"https://api.github.com/repos/a161858970-ux/daymark/releases/tags/{TAG}")
    if status != 200:
        die(f"读取 release 失败: {status} {rel}")
    # NOTE: asset deletion answers 301 → urllib would not replay DELETE
    # through the redirect; curl -L does, and this is the proven path.
    for asset in rel["assets"]:
        subprocess.run(
            ["curl", "-sSL", "-o", os.devnull, "-X", "DELETE",
             "-H", f"Authorization: Bearer {token}",
             f"https://api.github.com/repos/a161858970-ux/daymark/releases/assets/{asset['id']}"],
            check=False, capture_output=True, timeout=60)
    upload_url = rel["upload_url"].split("{")[0]
    for path in (EXE, APK):
        name = os.path.basename(path)
        status, resp = api(f"{upload_url}?name={name}", data=open(path, "rb").read(),
                           method="POST", content_type="application/octet-stream")
        size = resp.get("size") if isinstance(resp, dict) else None
        if status not in (200, 201):
            die(f"上传 {name} 失败: {status} {resp}")
        print(f"[3/4] Release 资产已替换: {name} ({size} B)")

    # --- 4) Verify ------------------------------------------------------
    status, final = api(f"https://api.github.com/repos/a161858970-ux/daymark/releases/tags/{TAG}")
    names = [a["name"] for a in final["assets"]] if isinstance(final, dict) else []
    print(f"[4/4] 回读资产: {names}")
    print(f"完成。清单: {BASE}/latest.json  版本 {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
