"use client";
import { useContext } from "react";
import { TelegramContext, TelegramContextValue } from "./TelegramProvider";

export function useTelegram(): TelegramContextValue {
  return useContext(TelegramContext);
}
