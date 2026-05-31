"""
CortexQ Telegram Bot — v2
--------------------------
Flow:
  /start           -> check for saved session; if valid -> "forward PDFs"; else ask for email
  email entered    -> send OTP to that email via backend
  code entered     -> verify, link chat_id, save JWT (persistent, 2-week expiry)
  PDF sent         -> upload to backend as authenticated user, reply with Mini App link
  t.me link (owner only) -> join group, add bot as admin, leave
"""

import asyncio
import logging
import os
import re

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
from joiner import join_and_add_bot

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

BOT_TOKEN    = os.environ["BOT_TOKEN"]
MINI_APP_URL = os.environ.get("MINI_APP_URL", "https://themcq.xyz/upload").rstrip("/")
BACKEND_URL  = os.environ.get("BACKEND_URL", "http://84.235.244.210:8000").rstrip("/")
BOT_SECRET   = os.environ.get("BOT_SECRET", "themcq-bot-secret-2026")
OWNER_ID     = int(os.environ.get("OWNER_ID", "0"))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

bot = Bot(token=BOT_TOKEN)
dp  = Dispatcher()

_TG_LINK_RE = re.compile(r"https?://t\.me/\S+")
_EMAIL_RE   = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_CODE_RE    = re.compile(r"^\d{6}$")

# -- Persistent session store (DB-backed via API) ---------------------------


async def _get_session(chat_id: int) -> dict | None:
    try:
        async with aiohttp.ClientSession() as http:
            async with http.get(
                f"{BACKEND_URL}/bot/session/{chat_id}",
                headers=_headers(),
            ) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                return data.get("session")
    except Exception:
        return None


async def _set_session(chat_id: int, data: dict) -> None:
    try:
        async with aiohttp.ClientSession() as http:
            await http.post(
                f"{BACKEND_URL}/bot/session/save",
                json={"chat_id": str(chat_id), **data},
                headers=_headers(),
            )
    except Exception as exc:
        log.error("session save failed: %s", exc)


async def _del_session(chat_id: int) -> None:
    try:
        async with aiohttp.ClientSession() as http:
            await http.delete(
                f"{BACKEND_URL}/bot/session/{chat_id}",
                headers=_headers(),
            )
    except Exception as exc:
        log.error("session delete failed: %s", exc)


def _headers() -> dict:
    return {"X-Bot-Secret": BOT_SECRET}


def _open_app_button(label: str, url: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]
    )


# -- /start -----------------------------------------------------------------

@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    chat_id = message.chat.id

    saved = await _get_session(chat_id)
    if saved and saved.get("state") == "verified":
        await message.answer(
            "تمام 👌 هسه بس دز الـ PDF وراح نرفعه عل حسابك"
        )
        return

    await _set_session(chat_id, {"state": "waiting_email"})
    await message.answer(
        "يا اهلا وسهلا 👋 بس محتاجين ايميلك الي سويت بيه الحساب، وراح نرفع الك الفايلات"
    )


# -- Text messages ----------------------------------------------------------

@dp.message(F.text)
async def handle_text(message: Message) -> None:
    chat_id  = message.chat.id
    text     = (message.text or "").strip()
    session  = await _get_session(chat_id)

    # -- Owner t.me link handler (unchanged from original) ------------------
    if message.from_user and message.from_user.id == OWNER_ID:
        match = _TG_LINK_RE.search(text)
        if match:
            status_msg = await message.reply("دا نشتغل عليه...")
            result = await join_and_add_bot(match.group(0))
            await status_msg.edit_text(result, parse_mode="Markdown")
            return

    # -- No active session -> prompt to start -------------------------------
    if not session:
        await message.answer("دز /start حتى نبدي")
        return

    state = session.get("state")

    # -- Step 1: waiting for email ------------------------------------------
    if state == "waiting_email":
        email = text.lower().strip()

        if not _EMAIL_RE.match(email):
            await message.answer(
                "هذا الايميل مو صحيح عيني، تأكد منه ودزه مرة ثانية"
            )
            return

        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(
                    f"{BACKEND_URL}/bot/send-code",
                    json={"email": email},
                    headers=_headers(),
                ) as resp:
                    if resp.status != 200:
                        body = await resp.json()
                        await message.answer(
                            f"صارت مشكلة: {body.get('detail', 'جرب مرة ثانية عيني')}."
                        )
                        return
        except Exception as exc:
            log.error("send-code request failed: %s", exc)
            await message.answer(
                "ما كدرنا نوصل للسيرفر، جرب مرة ثانية ورا شوية"
            )
            return

        session["email"] = email
        session["state"] = "waiting_code"
        await _set_session(chat_id, session)

        await message.answer(
            "تمام 👌 هسه دز الرمز ابو الـ٦ أرقام الي دزيناه عل ايميلك"
        )
        return

    # -- Step 2: waiting for the 6-digit code -------------------------------
    if state == "waiting_code":
        code = text.strip()

        if not _CODE_RE.match(code):
            await message.answer(
                "لا اخويه الرمز لازم يكون ٦ أرقام، تأكد منه"
            )
            return

        email = session.get("email", "")

        try:
            async with aiohttp.ClientSession() as http:
                async with http.post(
                    f"{BACKEND_URL}/bot/verify-code",
                    json={
                        "email": email,
                        "code": code,
                        "chat_id": str(chat_id),
                    },
                    headers=_headers(),
                ) as resp:
                    if resp.status == 401:
                        await message.answer(
                            "اخ، الرمز هذا لو غلط لو انتهت مدته 😅 جرب مرة ثانية او دز /start حتى نبدي من جديد"
                        )
                        return
                    if resp.status != 200:
                        body = await resp.json()
                        await message.answer(
                            f"صارت مشكلة: {body.get('detail', 'جرب مرة ثانية عيني')}."
                        )
                        return

                    data = await resp.json()
                    jwt = data.get("access_token")
        except Exception as exc:
            log.error("verify-code request failed: %s", exc)
            await message.answer(
                "ما كدرنا نوصل للسيرفر، جرب مرة ثانية ورا شوية"
            )
            return

        session["jwt"]   = jwt
        session["state"] = "verified"
        await _set_session(chat_id, session)

        await message.answer(
            "عاشت ايدك، هسه كلشي تمام ✅ بس دز الـ PDFs وخل نبلش"
        )
        return

    # -- Verified but sent text, not a PDF ----------------------------------
    if state == "verified":
        await message.answer(
            "دزلي ملف PDF وراح ارفعه عل حسابك"
        )
        return


# -- PDF handler ------------------------------------------------------------

@dp.message(F.document)
async def handle_document(message: Message) -> None:
    chat_id = message.chat.id
    session = await _get_session(chat_id)
    doc     = message.document

    if not doc or not doc.file_name:
        return

    is_pdf = doc.file_name.lower().endswith(".pdf") or doc.mime_type == "application/pdf"
    if not is_pdf:
        await message.reply("بس نقبل ملفات PDF اخويه، مو هذا النوع")
        return

    if not session or session.get("state") != "verified":
        await message.reply(
            "محتاج تربط حسابك اول، دز /start"
        )
        return

    jwt = session.get("jwt")
    if not jwt:
        await message.reply(
            "انتهت مدة الجلسة مالتك، دز /start حتى ترجع تربط الحساب"
        )
        await _del_session(chat_id)
        return

    loading_msg = await message.reply("صبرك شوية، الذكاء الاصطناعي يشتغل 🧠")

    try:
        tg_file    = await bot.get_file(doc.file_id)
        file_bytes = await bot.download_file(tg_file.file_path)
        pdf_data   = file_bytes.read()
    except Exception as exc:
        log.error("Telegram download failed: %s", exc)
        await loading_msg.edit_text("ما كدرنا ننزل الملف من تليجرام، جرب مرة ثانية")
        return

    lecture_id = None
    try:
        async with aiohttp.ClientSession() as http:
            form = aiohttp.FormData()
            form.add_field(
                "file",
                pdf_data,
                filename=doc.file_name,
                content_type="application/pdf",
            )
            async with http.post(
                f"{BACKEND_URL}/bot/upload-pdf",
                data=form,
                headers={
                    **_headers(),
                    "Authorization": f"Bearer {jwt}",
                },
            ) as resp:
                if resp.status == 401:
                    await loading_msg.edit_text(
                        "انتهت مدة الجلسة مالتك، دز /start حتى ترجع تربط الحساب"
                    )
                    await _del_session(chat_id)
                    return
                if resp.status == 413:
                    await loading_msg.edit_text("هذا الفايل كبير وياه شوية، حاول ترسل شي أصغر (ماكس ٥٠ ميجا)")
                    return
                if resp.status == 400:
                    body = await resp.json()
                    await loading_msg.edit_text(
                        f"ما كدرنا نعالج الملف: {body.get('detail', 'مشكلة ما نعرفها')}."
                    )
                    return
                if resp.status != 200:
                    await loading_msg.edit_text("فشل الرفع، جرب مرة ثانية ورا شوية")
                    return

                data       = await resp.json()
                lecture_id = data.get("lecture_id")
    except Exception as exc:
        log.error("Bot upload-pdf failed: %s", exc)
        await loading_msg.edit_text("صارت مشكلة بالسيرفر اثناء الرفع، جرب ثاني")
        return

    if not lecture_id:
        await loading_msg.edit_text("فشل الرفع، ما رجعلنا رقم للمحاضرة، جرب ثاني")
        return

    deep_link = f"{MINI_APP_URL}?lecture={lecture_id}"

    await loading_msg.edit_text(
        "خلصنا ✅ روح عل الموقع، الملف راح يكون جاهز هناك",
        reply_markup=_open_app_button("افتح بـ CortexQ", deep_link),
    )


# -- Entry point ------------------------------------------------------------

async def main() -> None:
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
