"""
CortexQ Telegram Bot
--------------------
/start       → opens the CortexQ Mini App
PDF forward  → asks MCQ/Essay → (pro only) Smart Context → uploads to backend
PDF direct   → uploads immediately, opens Mini App with file pre-loaded
t.me link    → (owner only) joins the group, adds bot as admin, leaves.

Run:  python bot.py
Deps: pip install aiogram==3.*  python-dotenv  aiohttp  telethon
Env:  BOT_TOKEN, MINI_APP_URL, BACKEND_URL, BOT_SECRET
      OWNER_ID           — your Telegram numeric user ID (get from @userinfobot)
      TELEGRAM_API_ID    — from my.telegram.org
      TELEGRAM_API_HASH  — from my.telegram.org
      BOT_USERNAME       — your bot's username without @
      TELEGRAM_PHONE     — your phone number e.g. +1234567890
"""

import asyncio
import logging
import os
import re

# load_dotenv MUST come before joiner import — joiner reads env vars at module level
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

import aiohttp
from aiogram import Bot, Dispatcher, F
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.filters import CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    WebAppInfo,
)
from joiner import join_and_add_bot

BOT_TOKEN    = os.environ["BOT_TOKEN"]
MINI_APP_URL = os.environ.get("MINI_APP_URL", "https://cortexq.net/upload")
BACKEND_URL  = os.environ.get("BACKEND_URL",  "https://cortexq.net/api").rstrip("/")
BOT_SECRET   = os.environ.get("BOT_SECRET",   "cortexq-bot-secret-2026")
OWNER_ID     = int(os.environ.get("OWNER_ID", "0"))
PROXY_URL    = os.environ.get("PROXY_URL")   # e.g. socks5://user:pass@host:port

_TG_LINK_RE = re.compile(r"https?://t\.me/\S+")

# Pending forwarded-file state: user_id → {bytes, name, q_type}
_pending: dict[int, dict] = {}

logging.basicConfig(level=logging.INFO)
_session = AiohttpSession(proxy=PROXY_URL) if PROXY_URL else AiohttpSession()
bot = Bot(token=BOT_TOKEN, session=_session)
dp  = Dispatcher()


async def _is_pro(user_id: int) -> bool:
    """Check the backend DB for the user's plan via their Telegram ID."""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{BACKEND_URL}/bot/user-plan",
                params={"telegram_user_id": user_id},
                headers={"X-Bot-Secret": BOT_SECRET},
                timeout=aiohttp.ClientTimeout(total=5),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("premium", False)
    except Exception as exc:
        logging.warning("Pro check failed for user %s: %s", user_id, exc)
    return False


def _open_app_button(label: str, url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]
    )


def _qtype_buttons() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="📝 MCQ",    callback_data="qtype:mcq"),
        InlineKeyboardButton(text="✍️ Essay",  callback_data="qtype:essay"),
    ]])


def _smart_context_buttons() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Yes — Smart Context", callback_data="smart:yes"),
        InlineKeyboardButton(text="❌ No",                  callback_data="smart:no"),
    ]])


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    await message.answer(
        "👋 Welcome to *CortexQ*!\n\n"
        "Upload a PDF lecture and I'll generate MCQs for your exam revision.\n\n"
        "Tap the button below to open the app:",
        parse_mode="Markdown",
        reply_markup=_open_app_button("📚 Open CortexQ", MINI_APP_URL),
    )


@dp.message(F.text)
async def handle_text(message: Message) -> None:
    if not message.text or message.from_user.id != OWNER_ID:
        return
    match = _TG_LINK_RE.search(message.text)
    if not match:
        return
    status_msg = await message.reply("⏳ Working on it...")
    result = await join_and_add_bot(match.group(0))
    await status_msg.edit_text(result, parse_mode="Markdown")


@dp.message(F.document)
async def handle_document(message: Message) -> None:
    doc = message.document
    if not doc or not doc.file_name:
        return

    is_pdf = doc.file_name.lower().endswith(".pdf") or doc.mime_type == "application/pdf"
    if not is_pdf:
        await message.reply("Please send a PDF file.")
        return

    tg_file    = await bot.get_file(doc.file_id)
    file_bytes = (await bot.download_file(tg_file.file_path)).read()
    user_id    = message.from_user.id

    if message.forward_origin is not None:
        # Forwarded PDF: ask question type before uploading
        _pending[user_id] = {"bytes": file_bytes, "name": doc.file_name}
        await message.reply(
            f"📄 *{doc.file_name}*\n\nWhat type of questions do you want to generate?",
            parse_mode="Markdown",
            reply_markup=_qtype_buttons(),
        )
        return

    # Direct (non-forwarded) upload: existing instant behaviour
    await _upload_and_reply(message, file_bytes, doc.file_name, q_type=None, smart_context=False)


@dp.callback_query(F.data.startswith("qtype:"))
async def cb_qtype(query: CallbackQuery) -> None:
    user_id = query.from_user.id
    q_type  = query.data.split(":")[1]  # "mcq" or "essay"

    if user_id not in _pending:
        await query.answer("Session expired — please resend the file.", show_alert=True)
        return

    _pending[user_id]["q_type"] = q_type
    await query.message.edit_reply_markup(reply_markup=None)

    if await _is_pro(user_id):
        await query.answer()
        await query.message.reply(
            "🧠 Enable *Smart Context*? (improves accuracy, takes a bit longer)",
            parse_mode="Markdown",
            reply_markup=_smart_context_buttons(),
        )
    else:
        state = _pending.pop(user_id)
        await query.answer()
        await _upload_and_reply(
            query.message, state["bytes"], state["name"],
            q_type=q_type, smart_context=False,
        )


@dp.callback_query(F.data.startswith("smart:"))
async def cb_smart(query: CallbackQuery) -> None:
    user_id       = query.from_user.id
    smart_context = query.data.split(":")[1] == "yes"

    if user_id not in _pending:
        await query.answer("Session expired — please resend the file.", show_alert=True)
        return

    state = _pending.pop(user_id)
    await query.message.edit_reply_markup(reply_markup=None)
    await query.answer()
    await _upload_and_reply(
        query.message, state["bytes"], state["name"],
        q_type=state.get("q_type"), smart_context=smart_context,
    )


async def _upload_and_reply(
    message: Message,
    file_bytes: bytes,
    file_name: str,
    q_type: str | None,
    smart_context: bool,
) -> None:
    temp_token = None
    try:
        async with aiohttp.ClientSession() as session:
            form = aiohttp.FormData()
            form.add_field("file", file_bytes, filename=file_name, content_type="application/pdf")
            if q_type:
                form.add_field("q_type", q_type)
            if smart_context:
                form.add_field("smart_context", "1")
            async with session.post(
                f"{BACKEND_URL}/bot/upload-temp",
                data=form,
                headers={"X-Bot-Secret": BOT_SECRET},
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    temp_token = data.get("token")
    except Exception as exc:
        logging.warning("Bot upload-temp failed: %s", exc)

    q_label = {"mcq": "MCQs", "essay": "Essay Questions"}.get(q_type or "", "MCQs")

    if temp_token:
        deep_link = f"{MINI_APP_URL}?tg_file={temp_token}"
        caption   = f"📄 *{file_name}*\n\nYour PDF is ready — tap to generate {q_label}:"
        btn_label = f"⚡ Generate {q_label}"
    else:
        deep_link = MINI_APP_URL
        caption   = f"📄 *{file_name}*\n\nOpen CortexQ and upload this PDF to generate {q_label}:"
        btn_label = "⚡ Open CortexQ"

    await message.reply(
        caption,
        parse_mode="Markdown",
        reply_markup=_open_app_button(btn_label, deep_link),
    )


async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
