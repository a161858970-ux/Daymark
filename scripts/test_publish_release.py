# -*- coding: utf-8 -*-
"""Unit tests for the PR-006-hardened publish_release flow.

Run:  python scripts/test_publish_release.py
(Not part of `pnpm test`; pure stdlib unittest with a fake transport —
no network, no SSH, no git, no GitHub.)
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import publish_release as pr  # noqa: E402


class FakeTransport:
    """Records every side effect; simulates GitHub + SFTP + the server."""

    def __init__(self, assets=(), live=None, probe_results=None, fail_on=None):
        self.events = []
        self.assets = [{"id": i + 1, "name": n, "size": s,
                        "browser_download_url": f"https://github.com/x/{n}"}
                       for i, (n, s) in enumerate(assets)]
        self._next_id = len(self.assets) + 1
        self.live = live  # current live manifest on the server
        self.probe_results = probe_results or {}  # url -> (status, size)
        self.fail_on = fail_on  # event name to raise on

    def _record(self, ev):
        if self.fail_on and ev[0] == self.fail_on:
            raise RuntimeError(f"simulated failure at {ev}")
        self.events.append(ev)

    def get_release(self):
        self._record(("get_release",))
        return {"id": 1, "upload_url": "https://uploads.github.com/x{",
                "assets": [dict(a) for a in self.assets]}

    def upload_asset(self, name, path):
        self._record(("upload", name))
        self.assets = [a for a in self.assets if a["name"] != name]
        self.assets.append({"id": self._next_id, "name": name,
                            "size": os.path.getsize(path),
                            "browser_download_url": f"https://github.com/x/{name}"})
        self._next_id += 1
        return os.path.getsize(path)

    def delete_asset(self, asset_id):
        victim = next(a for a in self.assets if a["id"] == asset_id)
        self._record(("delete", victim["name"]))
        self.assets = [a for a in self.assets if a["id"] != asset_id]

    def server_put(self, local, remote):
        self._record(("server_put", remote))

    def server_atomic_put(self, local, remote):
        self._record(("FLIP", remote))
        self.live = json.load(open(local, encoding="utf-8"))  # the server now serves it

    def fetch_json(self, url):
        self._record(("fetch_json",))
        return self.live

    def probe(self, url):
        self._record(("probe", url))
        return self.probe_results.get(url, (200, -1))

    def move_tag(self):
        self._record(("move_tag",))

    def set_body(self, release_id, body):
        self._record(("set_body", body))


def make_cfg(tmp, version="0.1.16", exe_size=111, apk_size=222):
    exe = os.path.join(tmp, "setup.exe")
    apk = os.path.join(tmp, "app.apk")
    with open(exe, "wb") as f:
        f.write(b"x" * exe_size)
    with open(apk, "wb") as f:
        f.write(b"y" * apk_size)
    exe_name, apk_name = pr.asset_names(version)
    manifest = pr.build_manifest(version, "EXESIG", "APKSIG", "test notes")
    return types.SimpleNamespace(
        exe=exe, apk=apk, exe_name=exe_name, apk_name=apk_name,
        exe_size=exe_size, apk_size=apk_size,
        manifest=manifest,
        manifest_path=os.path.join(tmp, "latest.json"),
        body="白话正文", keep_versions=pr.KEEP_VERSIONS)


def old_live_manifest(version="0.1.15"):
    exe_name, _ = pr.asset_names(version)
    return {
        "version": version, "notes": "old", "pub_date": "2026-10-08T00:00:00Z",
        "platforms": {
            "windows-x86_64": {"signature": "S",
                               "url": f"{pr.BASE}/{exe_name}"},
            "android-aarch64": {"signature": "S",
                                "url": f"https://github.com/violetsnowl/Daymark/releases/download/v0.1.0/{pr.LEGACY_APK_NAME}"},
        },
    }


class PublishFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmp.cleanup()

    # -- manifest shape --------------------------------------------------
    def test_manifest_urls_are_versioned(self):
        cfg = make_cfg(self.tmp.name)
        urls = [u for u, _ in pr.manifest_targets(cfg.manifest, cfg.exe_size, cfg.apk_size)]
        self.assertTrue(any("app-universal-release-0.1.16.apk" in u for u in urls))
        self.assertTrue(any("daymark_0.1.16_x64-setup.exe" in u for u in urls))
        self.assertFalse(any(u.endswith("/app-universal-release.apk") for u in urls))

    # -- ordering --------------------------------------------------------
    def test_uploads_and_probes_all_precede_the_flip(self):
        cfg = make_cfg(self.tmp.name)
        t = FakeTransport(
            assets=[("daymark_0.1.15_x64-setup.exe", 10), (pr.LEGACY_APK_NAME, 10)],
            live=old_live_manifest())
        pr.publish(t, cfg)
        ev = [e[0] for e in t.events]
        flip = ev.index("FLIP")
        # every new-asset upload and every probe happened before the flip
        for i, e in enumerate(t.events):
            if e[0] == "upload" and e[1] in (cfg.exe_name, cfg.apk_name):
                self.assertLess(i, flip)
            if e[0] == "probe":
                self.assertLess(i, flip)
        # no deletion of OLD assets before the flip at all
        for i, e in enumerate(t.events):
            if e[0] == "delete" and e[1] in ("daymark_0.1.15_x64-setup.exe", pr.LEGACY_APK_NAME):
                self.assertGreater(i, flip, "旧资产在翻转前被删")
        # exactly one flip
        self.assertEqual(ev.count("FLIP"), 1)

    def test_alias_refresh_happens_after_the_flip(self):
        cfg = make_cfg(self.tmp.name)
        t = FakeTransport(
            assets=[("daymark_0.1.15_x64-setup.exe", 10), (pr.LEGACY_APK_NAME, 10)],
            live=old_live_manifest())
        pr.publish(t, cfg)
        flip = [e[0] for e in t.events].index("FLIP")
        alias_uploads = [i for i, e in enumerate(t.events)
                         if e[0] == "upload" and e[1] == pr.LEGACY_APK_NAME]
        self.assertTrue(alias_uploads, "固定名别名未刷新")
        self.assertTrue(all(i > flip for i in alias_uploads), "别名刷新先于翻转")

    # -- failure recovery -------------------------------------------------
    def test_upload_failure_before_flip_leaves_live_world_untouched(self):
        cfg = make_cfg(self.tmp.name)
        old_assets = [("daymark_0.1.15_x64-setup.exe", 10), (pr.LEGACY_APK_NAME, 10)]
        t = FakeTransport(assets=old_assets, live=old_live_manifest(),
                          fail_on="upload")
        with self.assertRaises(RuntimeError):
            pr.publish(t, cfg)
        self.assertNotIn("FLIP", [e[0] for e in t.events], "失败后不应翻转清单")
        names = {a["name"] for a in t.assets}
        self.assertIn("daymark_0.1.15_x64-setup.exe", names, "旧 exe 被删")
        self.assertIn(pr.LEGACY_APK_NAME, names, "旧别名被删")

    def test_probe_failure_on_new_target_aborts_before_flip(self):
        cfg = make_cfg(self.tmp.name)
        apk_url = cfg.manifest["platforms"]["android-aarch64"]["url"]
        t = FakeTransport(assets=[(pr.LEGACY_APK_NAME, 10)], live=old_live_manifest(),
                          probe_results={apk_url: (404, -1)})
        with self.assertRaises(SystemExit):
            pr.publish(t, cfg)
        self.assertNotIn("FLIP", [e[0] for e in t.events])

    def test_size_mismatch_aborts_before_flip(self):
        cfg = make_cfg(self.tmp.name)
        apk_url = cfg.manifest["platforms"]["android-aarch64"]["url"]
        t = FakeTransport(assets=[(pr.LEGACY_APK_NAME, 10)], live=old_live_manifest(),
                          probe_results={apk_url: (200, 999)})
        with self.assertRaises(SystemExit):
            pr.publish(t, cfg)
        self.assertNotIn("FLIP", [e[0] for e in t.events])

    def test_old_manifest_target_missing_aborts_before_flip(self):
        cfg = make_cfg(self.tmp.name)
        old_url = old_live_manifest()["platforms"]["android-aarch64"]["url"]
        t = FakeTransport(assets=[(pr.LEGACY_APK_NAME, 10)], live=old_live_manifest(),
                          probe_results={old_url: (404, -1)})
        with self.assertRaises(SystemExit):
            pr.publish(t, cfg)
        self.assertNotIn("FLIP", [e[0] for e in t.events])

    def test_rerun_replaces_only_stale_same_version_asset(self):
        cfg = make_cfg(self.tmp.name)
        # same-version asset exists but is NOT referenced by the live manifest
        t = FakeTransport(
            assets=[(cfg.exe_name, 50), (cfg.apk_name, 50), (pr.LEGACY_APK_NAME, 10)],
            live=old_live_manifest())
        pr.publish(t, cfg)
        deleted = [e[1] for e in t.events if e[0] == "delete"]
        self.assertIn(cfg.exe_name, deleted)
        self.assertIn(cfg.apk_name, deleted)
        # legacy alias is deleted only in the post-flip alias refresh, and old
        # versioned assets were not around to be deleted
        self.assertNotIn("daymark_0.1.15_x64-setup.exe", deleted)

    def test_never_deletes_live_referenced_same_name_asset(self):
        cfg = make_cfg(self.tmp.name)
        # Re-run AFTER a flip: the live manifest already references the new
        # asset names (same size) — must not delete or re-upload them.
        t = FakeTransport(
            assets=[(cfg.exe_name, cfg.exe_size), (cfg.apk_name, cfg.apk_size)],
            live=cfg.manifest)
        pr.publish(t, cfg)
        deleted = [e[1] for e in t.events if e[0] == "delete"]
        self.assertNotIn(cfg.exe_name, deleted)
        self.assertNotIn(cfg.apk_name, deleted)

    # -- cleanup policy ----------------------------------------------------
    def test_cleanup_keeps_recent_versions_live_urls_and_alias(self):
        assets = [
            {"id": 1, "name": "daymark_0.1.12_x64-setup.exe", "size": 1,
             "browser_download_url": "https://github.com/x/1"},
            {"id": 2, "name": "app-universal-release-0.1.12.apk", "size": 1,
             "browser_download_url": "https://github.com/x/2"},
            {"id": 3, "name": "daymark_0.1.15_x64-setup.exe", "size": 1,
             "browser_download_url": "https://github.com/x/3"},
            {"id": 4, "name": "app-universal-release-0.1.15.apk", "size": 1,
             "browser_download_url": "https://github.com/x/4"},
            {"id": 5, "name": pr.LEGACY_APK_NAME, "size": 1,
             "browser_download_url": "https://github.com/x/5"},
            {"id": 6, "name": "app-universal-release-0.1.13.apk", "size": 1,
             "browser_download_url": "https://github.com/x/LIVE"},
        ]
        # Versions present: 0.1.12 / 0.1.13 / 0.1.15 — keep the newest two
        # (0.1.13, 0.1.15), so only the 0.1.12 pair is stale.
        live_urls = {"https://github.com/x/LIVE"}  # even an old asset is protected
        doomed = pr.select_cleanup(assets, live_urls, keep_versions=2)
        names = {a["name"] for a in doomed}
        self.assertEqual(names, {"daymark_0.1.12_x64-setup.exe",
                                 "app-universal-release-0.1.12.apk"})
        self.assertNotIn(pr.LEGACY_APK_NAME, names, "固定名别名不许清理")
        self.assertNotIn("app-universal-release-0.1.13.apk", names, "线上引用资产不许清理")


if __name__ == "__main__":
    unittest.main(verbosity=2)
