"""
CortexQ Group Joiner
--------------------
Userbot helper: joins a Telegram group/channel via invite link,
promotes the CortexQ bot to admin, then leaves.

First run will ask for your phone number + OTP — after that a
session file (owner.session) is saved and reused automatically.

Run standalone to test:
    python joiner.py <invite_link>

Deps: pip install telethon python-dotenv
Env:  TELEGRAM_API_ID, TELEGRAM_API_HASH, BOT_USERNAME
      (optional) TELEGRAM_PHONE  — skips the phone prompt
"""

import asyncio
import logging
import os
import re
import sys

from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.tl.functions.channels import (
    JoinChannelRequest,
    EditAdminRequest,
)
from telethon.tl.functions.messages import (
    ImportChatInviteRequest,
    EditChatAdminRequest,
)
from telethon.tl.types import Channel, Chat, ChatAdminRights

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

API_ID       = int(os.environ["TELEGRAM_API_ID"])
API_HASH     = os.environ["TELEGRAM_API_HASH"]
BOT_USERNAME = os.environ.get("BOT_USERNAME", "")   # e.g. "cortexq_bot" (no @)
PHONE        = os.environ.get("TELEGRAM_PHONE", "")  # e.g. "+1234567890"

SESSION_FILE = os.path.join(os.path.dirname(__file__), "owner")


def _extract_invite(link: str):
    """
    Returns either:
      ("hash",    "<invite_hash>")   for private links  t.me/+HASH or t.me/joinchat/HASH
      ("username","<username>")      for public links   t.me/username
    """
    link = link.strip()
    # Private invite link
    m = re.search(r"t\.me/\+([A-Za-z0-9_-]+)", link) or \
        re.search(r"t\.me/joinchat/([A-Za-z0-9_-]+)", link)
    if m:
        return ("hash", m.group(1))
    # Public username link
    m = re.search(r"t\.me/([A-Za-z0-9_]+)", link)
    if m:
        return ("username", m.group(1))
    return None


async def join_and_add_bot(link: str) -> str:
    """
    Joins the chat at `link` with the owner account,
    adds BOT_USERNAME as admin, then leaves.
    Returns a human-readable status string.
    """
    parsed = _extract_invite(link)
    if not parsed:
        return "❌ Could not parse that link. Send a valid t.me/... link."

    client = TelegramClient(SESSION_FILE, API_ID, API_HASH)
    await client.start(phone=PHONE or None)   # prompts if no session yet

    try:
        kind, value = parsed

        # --- Join the chat ---
        if kind == "hash":
            result = await client(ImportChatInviteRequest(value))
            chat = result.chats[0]
        else:
            await client(JoinChannelRequest(value))
            chat = await client.get_entity(value)

        chat_title = getattr(chat, "title", value)

        # --- Add bot as admin (if BOT_USERNAME is set) ---
        if BOT_USERNAME:
            bot_entity = await client.get_entity(BOT_USERNAME)

            if isinstance(chat, Channel):
                # Supergroup or channel — use channels.EditAdminRequest with granular rights
                admin_rights = ChatAdminRights(
                    post_messages=True,
                    edit_messages=True,
                    delete_messages=True,
                    invite_users=True,
                    pin_messages=True,
                    change_info=False,
                    add_admins=False,
                    ban_users=False,
                )
                await client(EditAdminRequest(chat, bot_entity, admin_rights, rank="CortexQ"))
            elif isinstance(chat, Chat):
                # Basic group — use messages.EditChatAdminRequest (simple is_admin flag)
                await client(EditChatAdminRequest(chat.id, bot_entity, is_admin=True))
            else:
                logging.warning("Unknown chat type: %s", type(chat))

            bot_note = f"✅ @{BOT_USERNAME} promoted to admin"
        else:
            bot_note = "⚠️ BOT_USERNAME not set — skipped adding bot"

        # --- Leave the chat ---
        await client.delete_dialog(chat)

        return f"✅ Joined *{chat_title}*\n{bot_note}\n👋 Owner account left the chat"

    except Exception as exc:
        logging.error("join_and_add_bot error for %s: %s", link, exc)
        return f"❌ Error: {exc}"
    finally:
        await client.disconnect()


# ── Standalone test ──────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python joiner.py <invite_link>")
        sys.exit(1)
    print(asyncio.run(join_and_add_bot(sys.argv[1])))
