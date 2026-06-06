#!/usr/bin/env python3
import asyncio
import inspect
import json
import sys


def fail(code, message):
    print(json.dumps({"ok": False, "error": code, "message": message}))
    return 1


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        return fail("invalid_json", str(exc))

    texts = payload.get("texts")
    if not isinstance(texts, list):
        return fail("invalid_texts", "texts must be a list")

    normalized = [text.strip() if isinstance(text, str) else "" for text in texts]
    if not normalized:
        print(json.dumps({"ok": True, "translations": []}, ensure_ascii=False))
        return 0

    try:
        from googletrans import Translator
    except Exception as exc:
        return fail("googletrans_unavailable", str(exc))

    try:
        translator = Translator()
        result = translator.translate(
            normalized,
            src=payload.get("src") or "en",
            dest=payload.get("dest") or "ko",
        )
        if inspect.isawaitable(result):
            result = asyncio.run(result)
        if not isinstance(result, list):
            result = [result]
        translations = [
            getattr(item, "text", "") if item is not None else ""
            for item in result
        ]
    except Exception as exc:
        return fail("translate_failed", str(exc))

    print(
        json.dumps(
            {
                "ok": True,
                "provider": "py-googletrans",
                "translations": translations,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
