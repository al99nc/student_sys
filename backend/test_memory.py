#!/usr/bin/env python3
"""
test_memory.py — Memory behavior test suite for CortexQ AI Coach.

Tests:
  T1  Basic save        "My name is Ali"            → save_memory, type=identity, importance ≥ 0.85
  T2  No save           "lol that's funny"          → NO save_memory, DB stays empty
  T3  Update not dup    "I like math" + "hate math" → ONE memory with latest value
  T4  Pattern detect    3 procrastination messages  → behavior memory saved
  T5  Context memory    "I have an exam tomorrow"   → type=context, importance 0.45–0.79

Usage:
  python test_memory.py                          # runs against localhost:8000
  python test_memory.py --debug                  # shows AI reasoning inline
  python test_memory.py --base http://host:port  # custom backend URL
"""

import argparse
import json
import sys
import time

import requests

# ── Config ─────────────────────────────────────────────────────────────────────
DEFAULT_BASE  = "http://localhost:8000"
TEST_EMAIL    = "memtest@cortexq.local"
TEST_PASSWORD = "memtest_pass_1337"

# ── ANSI colours ───────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

# ── Tester ─────────────────────────────────────────────────────────────────────

class MemoryTester:
    def __init__(self, base: str, debug: bool = False):
        self.base    = base.rstrip("/")
        self.debug   = debug
        self.token   = None
        self.headers: dict = {}
        self.results: list[tuple[str, bool]] = []

    # ── Auth ──────────────────────────────────────────────────────────────────

    def login(self):
        r = requests.post(f"{self.base}/auth/login", json={
            "email": TEST_EMAIL, "password": TEST_PASSWORD,
        })
        if r.status_code == 200:
            self.token = r.json()["access_token"]
        elif r.status_code == 401:
            # Account doesn't exist yet — create it then login
            s = requests.post(f"{self.base}/auth/signup", json={
                "email": TEST_EMAIL, "password": TEST_PASSWORD,
            })
            if s.status_code not in (200, 201):
                raise RuntimeError(f"Signup failed ({s.status_code}): {s.text}")
            r2 = requests.post(f"{self.base}/auth/login", json={
                "email": TEST_EMAIL, "password": TEST_PASSWORD,
            })
            r2.raise_for_status()
            self.token = r2.json()["access_token"]

        self.headers = {"Authorization": f"Bearer {self.token}"}
        print(f"{CYAN}Authenticated as {TEST_EMAIL}{RESET}")

    # ── Conversation helpers ──────────────────────────────────────────────────

    def _new_conv(self) -> str:
        r = requests.post(
            f"{self.base}/api/v1/coach/conversations",
            headers=self.headers,
        )
        r.raise_for_status()
        return r.json()["id"]

    def _send(self, conv_id: str, message: str) -> dict:
        url = f"{self.base}/api/v1/coach/conversations/{conv_id}/messages"
        if self.debug:
            url += "?debug=1"
        r = requests.post(url, json={"message": message}, headers=self.headers)
        r.raise_for_status()
        data = r.json()
        if self.debug:
            am        = data.get("assistant_message", {})
            response  = am.get("response", "")
            debug_blk = am.get("debug")
            save_mem  = am.get("save_memory")
            print(f"  {YELLOW}USER:{RESET} {message}")
            print(f"  {CYAN}AI  :{RESET} {response[:140]}{'…' if len(response) > 140 else ''}")
            if debug_blk:
                print(f"  {YELLOW}DEBUG:{RESET} {json.dumps(debug_blk, indent=4)}")
            elif save_mem:
                print(f"  {YELLOW}save_memory:{RESET} {json.dumps(save_mem)}")
            else:
                print(f"  {YELLOW}save_memory:{RESET} (null / no save)")
            print()
        return data

    # ── Memory state ──────────────────────────────────────────────────────────

    def _get_memories(self) -> list[dict]:
        r = requests.get(f"{self.base}/api/v1/ai-tools/memory", headers=self.headers)
        r.raise_for_status()
        return r.json()

    def _clear_memories(self):
        for m in self._get_memories():
            requests.delete(
                f"{self.base}/api/v1/ai-tools/memory/{m['key']}",
                headers=self.headers,
            )

    # ── Assertion helpers ─────────────────────────────────────────────────────

    def _ok(self, label: str, condition: bool, detail: str = "") -> bool:
        mark = f"{GREEN}PASS{RESET}" if condition else f"{RED}FAIL{RESET}"
        line = f"    [{mark}] {label}"
        if detail:
            line += f"  ({detail})"
        print(line)
        return condition

    # ── Test wrapper ──────────────────────────────────────────────────────────

    def _run(self, name: str, fn):
        print(f"\n{BOLD}── {name} ──{RESET}")
        self._clear_memories()
        conv_id = self._new_conv()
        try:
            passed = fn(conv_id)
        except Exception as exc:
            print(f"    {RED}EXCEPTION: {exc}{RESET}")
            passed = False
        self.results.append((name, passed))

    # ── Test cases ────────────────────────────────────────────────────────────

    def t1_basic_save(self, conv_id: str) -> bool:
        """'My name is Ali' → save_memory, type=identity, importance ≥ 0.85, persisted in DB."""
        data  = self._send(conv_id, "My name is Ali")
        saved = data["assistant_message"].get("save_memory")

        ok1 = self._ok("save_memory triggered",       bool(saved))
        ok2 = self._ok("type == identity",            saved and saved.get("type") == "identity",
                       saved.get("type") if saved else "N/A")
        importance = float(saved.get("importance", 0) if saved else 0)
        ok3 = self._ok("importance ≥ 0.85",           importance >= 0.85,
                       str(importance))

        mems = self._get_memories()
        ok4 = self._ok("value 'ali' persisted in DB",
                       any("ali" in m.get("value", "").lower() for m in mems),
                       str([m["value"] for m in mems]))
        return all([ok1, ok2, ok3, ok4])

    def t2_no_save_small_talk(self, conv_id: str) -> bool:
        """'lol that's funny' → NO save_memory, DB stays empty."""
        data  = self._send(conv_id, "lol that's funny")
        saved = data["assistant_message"].get("save_memory")

        ok1 = self._ok("save_memory is null/absent",  not saved,          str(saved))
        mems = self._get_memories()
        ok2 = self._ok("DB has 0 memories",           len(mems) == 0,
                       f"{len(mems)} found")
        return all([ok1, ok2])

    def t3_update_not_duplicate(self, conv_id: str) -> bool:
        """'I like math' then 'Actually I hate math' → ONE memory with updated value."""
        self._send(conv_id, "I like math")
        time.sleep(0.8)
        self._send(conv_id, "Actually I hate math")

        mems = self._get_memories()
        math_mems = [
            m for m in mems
            if any(
                "math" in (m.get(field) or "").lower()
                for field in ("key", "label", "value")
            )
        ]

        ok1 = self._ok("exactly 1 math memory (no duplicate)",
                       len(math_mems) == 1,
                       f"{len(math_mems)} found: {[m['key'] for m in math_mems]}")
        if math_mems:
            val = math_mems[0]["value"].lower()
            neg_words = ("hate", "dislike", "doesn't like", "don't like", "dislikes", "not a fan")
            ok2 = self._ok("value reflects LATEST state (dislike)",
                           any(w in val for w in neg_words),
                           f"value='{math_mems[0]['value']}'")
        else:
            ok2 = self._ok("value reflects LATEST state (dislike)", False, "no memory found")
        return all([ok1, ok2])

    def t4_pattern_detection(self, conv_id: str) -> bool:
        """3 procrastination signals → behavior memory saved."""
        for msg in [
            "I'll study later today",
            "not now, maybe later",
            "I'll do it tomorrow I guess",
        ]:
            self._send(conv_id, msg)
            time.sleep(0.5)

        mems          = self._get_memories()
        behavior_mems = [m for m in mems if m.get("type") == "behavior"]

        ok1 = self._ok("at least 1 behavior memory saved",
                       len(behavior_mems) >= 1,
                       f"all keys: {[m['key'] for m in mems]}")
        if behavior_mems:
            combined  = " ".join(m["value"].lower() for m in behavior_mems)
            procr_words = ("procrastinat", "delay", "later", "postpone", "avoid", "put off")
            ok2 = self._ok("behavior hints at procrastination",
                           any(w in combined for w in procr_words),
                           combined[:100])
        else:
            ok2 = self._ok("behavior hints at procrastination", False, "no behavior memories")
        return all([ok1, ok2])

    def t5_context_memory(self, conv_id: str) -> bool:
        """'I have an exam tomorrow' → type=context, importance 0.45–0.79."""
        data  = self._send(conv_id, "I have an exam tomorrow")
        saved = data["assistant_message"].get("save_memory")

        ok1 = self._ok("save_memory triggered",       bool(saved))
        if not saved:
            self._ok("type == context",           False, "no save_memory")
            self._ok("importance in [0.45, 0.79]", False, "no save_memory")
            return False
        ok2 = self._ok("type == context",             saved.get("type") == "context",
                       saved.get("type", "N/A"))
        importance = float(saved.get("importance", 0))
        ok3 = self._ok("importance in [0.45, 0.79]",  0.45 <= importance <= 0.79,
                       str(importance))
        return all([ok1, ok2, ok3])

    # ── Main run ──────────────────────────────────────────────────────────────

    def run(self) -> bool:
        print(f"\n{BOLD}{CYAN}CortexQ Memory Test Suite{RESET}")
        print(f"Target : {self.base}")
        print(f"Debug  : {'on' if self.debug else 'off'}\n")

        self.login()
        self._run("T1 — Basic Identity Save",    self.t1_basic_save)
        self._run("T2 — No Save (Small Talk)",   self.t2_no_save_small_talk)
        self._run("T3 — Update Not Duplicate",   self.t3_update_not_duplicate)
        self._run("T4 — Pattern Detection",      self.t4_pattern_detection)
        self._run("T5 — Context Memory",         self.t5_context_memory)

        # ── Summary ───────────────────────────────────────────────────────────
        print(f"\n{BOLD}{'─' * 40}{RESET}")
        passed = sum(1 for _, ok in self.results if ok)
        total  = len(self.results)
        for name, ok in self.results:
            mark = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
            print(f"  [{mark}] {name}")
        color = GREEN if passed == total else RED
        print(f"\n{color}{BOLD}{passed}/{total} tests passed{RESET}\n")
        return passed == total


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CortexQ Memory Test Suite")
    parser.add_argument("--base",  default=DEFAULT_BASE, help="API base URL (default: %(default)s)")
    parser.add_argument("--debug", action="store_true",  help="Show AI reasoning and memory decisions inline")
    args = parser.parse_args()

    tester  = MemoryTester(base=args.base, debug=args.debug)
    success = tester.run()
    sys.exit(0 if success else 1)
