"""
CortexQ Telegram Bot
--------------------
When a user sends a PDF to the bot, it replies with a button that opens
the CortexQ Mini App.  A /start command also opens the Mini App directly.

Run:  python bot.py
Deps: pip install aiogram==3.*  python-dotenv
Env:  BOT_TOKEN, MINI_APP_URL (e.g. https://cortexq.net/upload)
"""

import asyncio
import logging
import os

from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
)
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.environ["BOT_TOKEN"]          # @BotFather token
MINI_APP_URL = os.environ.get(               # your Mini App URL
    "MINI_APP_URL", "https://cortexq.net/upload"
)

logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


def open_app_keyboard(label: str = "Open CortexQ", url: str = MINI_APP_URL) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]
        ]
    )


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Reply to /start with a button that opens the Mini App."""
    await message.answer(
        "👋 Welcome to *CortexQ*!\n\n"
        "Upload a PDF lecture and I'll generate MCQs for your exam revision.\n\n"
        "Tap the button below to open the app:",
        parse_mode="Markdown",
        reply_markup=open_app_keyboard("📚 Open CortexQ"),
    )


@dp.message(F.document)
async def handle_document(message: Message) -> None:
    """
    When a user forwards or sends a PDF, reply with a button that opens
    the Mini App.

    Deep-link note: Telegram doesn't let bots pass files to Mini Apps
    directly. The standard pattern is:
      1. Bot uploads the file to your backend → gets back a file_id / temp token
      2. Bot sends a Mini App button with ?startapp=<token>
      3. Mini App reads window.Telegram.WebApp.initDataUnsafe.start_param
         and fetches the pre-uploaded file from your backend.

    For MVP we just open the app and let the user pick the file themselves.
    Uncomment the upload block below when you're ready to wire up the backend.
    """
    doc = message.document
    if not doc or not doc.file_name:
        return

    is_pdf = doc.file_name.lower().endswith(".pdf") or doc.mime_type == "application/pdf"
    if not is_pdf:
        await message.reply("Please send a PDF file.")
        return

    # ── Optional: upload to backend + deep-link ────────────────────────────
    # import aiohttp, io
    # file = await bot.get_file(doc.file_id)
    # file_bytes = await bot.download_file(file.file_path)
    # async with aiohttp.ClientSession() as session:
    #     form = aiohttp.FormData()
    #     form.add_field("file", file_bytes.read(), filename=doc.file_name, content_type="application/pdf")
    #     async with session.post("https://cortexq.net/api/upload-temp", data=form) as r:
    #         resp = await r.json()
    #         temp_token = resp["token"]
    # deep_link_url = f"{MINI_APP_URL}?startapp={temp_token}"
    # ──────────────────────────────────────────────────────────────────────

    deep_link_url = MINI_APP_URL  # replace with deep_link_url when ready

    await message.reply(
        f"📄 *{doc.file_name}*\n\nOpen CortexQ to generate MCQs from this PDF:",
        parse_mode="Markdown",
        reply_markup=open_app_keyboard("⚡ Generate MCQs", deep_link_url),
    )


async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
