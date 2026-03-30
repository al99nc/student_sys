"""
CortexQ Telegram Bot
--------------------
/start       → opens the CortexQ Mini App
PDF forward  → bot uploads the PDF to the backend, then sends a button
               that opens the Mini App with the file pre-loaded.

Run:  python bot.py
Deps: pip install aiogram==3.*  python-dotenv  aiohttp
Env:  BOT_TOKEN, MINI_APP_URL, BACKEND_URL, BOT_SECRET
"""

import asyncio
import logging
import os

import aiohttp
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

BOT_TOKEN    = os.environ["BOT_TOKEN"]
MINI_APP_URL = os.environ.get("MINI_APP_URL", "https://cortexq.net/upload")
BACKEND_URL  = os.environ.get("BACKEND_URL",  "https://cortexq.net/api")
BOT_SECRET   = os.environ.get("BOT_SECRET",   "cortexq-bot-secret-2026")

logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp  = Dispatcher()


def _open_app_button(label: str, url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]
    )


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    await message.answer(
        "👋 Welcome to *CortexQ*!\n\n"
        "Upload a PDF lecture and I'll generate MCQs for your exam revision.\n\n"
        "Tap the button below to open the app:",
        parse_mode="Markdown",
        reply_markup=_open_app_button("📚 Open CortexQ", MINI_APP_URL),
    )


@dp.message(F.document)
async def handle_document(message: Message) -> None:
    doc = message.document
    if not doc or not doc.file_name:
        return

    is_pdf = doc.file_name.lower().endswith(".pdf") or doc.mime_type == "application/pdf"
    if not is_pdf:
        await message.reply("Please send a PDF file.")
        return

    # Download from Telegram
    tg_file    = await bot.get_file(doc.file_id)
    file_bytes = await bot.download_file(tg_file.file_path)

    # Upload to backend → get a short-lived token
    temp_token = None
    try:
        async with aiohttp.ClientSession() as session:
            form = aiohttp.FormData()
            form.add_field(
                "file",
                file_bytes.read(),
                filename=doc.file_name,
                content_type="application/pdf",
            )
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

    if temp_token:
        deep_link = f"{MINI_APP_URL}?tg_file={temp_token}"
        caption   = f"📄 *{doc.file_name}*\n\nYour PDF is ready — tap to open CortexQ and generate MCQs:"
        btn_label = "⚡ Generate MCQs"
    else:
        # Fallback: open app without pre-loading the file
        deep_link = MINI_APP_URL
        caption   = f"📄 *{doc.file_name}*\n\nOpen CortexQ and upload this PDF to generate MCQs:"
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
