---
name: onlyne
description: Use when an agent needs to send, receive, subscribe to, or inspect workspace-local IM channel messages through Onlyne.
---

# Onlyne

## Overview

Onlyne is a workspace-local IM channel broker. Use it only as a local messaging bridge: send messages, receive subscribed events, and inspect local history through the workspace `.onlyne/` daemon state.

## Rules

- Run commands inside the project tree, or pass `--workspace <dir>`.
- Do not write credentials into global home directories. Secrets belong in the selected workspace `.onlyne/.env`.
- Do not commit `.onlyne/`, logs, runtime databases, sockets, or channel tokens.
- Do not treat Onlyne as an agent runtime, model runner, scheduler, or prompt system.
- Use `onlyne run --debug` only while discovering channel/conversation/thread metadata; debug replies are for setup, not normal operation.

## Quick Reference

| Need | Command |
| --- | --- |
| Initialize workspace | `onlyne init` |
| Run daemon | `onlyne run` |
| Run with metadata replies | `onlyne run --debug` |
| Health check | `onlyne client '{"id":"ping","op":"ping"}'` |
| Status/channels | `onlyne client '{"id":"status","op":"status"}'` |
| Send Markdown | `onlyne client '{"id":"send","op":"send_message","channel_id":"qqbot","conversation_id":"ID","text":"# Report\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |"}'` |
| Send literal text | `onlyne client '{"id":"send","op":"send_message","channel_id":"telegram","conversation_id":"CHAT_ID","text":"# not a heading","raw_text":true}'` |
| Reply text | `onlyne client '{"id":"reply","op":"reply_message","channel_id":"telegram","conversation_id":"CHAT_ID","text":"hello","raw_text":true}'` |
| Read channel history | `onlyne client '{"id":"hist","op":"fetch_channel_history","channel_id":"telegram","limit":20}'` |
| Read merged history | `onlyne client '{"id":"all","op":"fetch_all_history","limit":50}'` |

## Subscribe to Events

`onlyne client` prints one response and exits, so long-lived subscriptions should keep the Unix socket open. The socket path is always workspace-local: `.onlyne/run/onlyne.sock`.

```bash
python3 - <<'PY'
import json, socket
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.connect('.onlyne/run/onlyne.sock')
sock.sendall(b'{"id":"sub","op":"subscribe_events"}\n')
while True:
    print(sock.recv(65536).decode(), end='')
PY
```

Subscribed event lines have `event:true`; request responses have `ok:true` or `ok:false`.

## Markdown Semantics

External callers send one whole Markdown document in `text`; Markdown is the default. Do not split tables, formulas, or code blocks before sending. Set `raw_text:true` only for literal plain text.

- QQ Bot receives the whole document as QQ extended Markdown (`msg_type=2`, `markdown.content`), including tables and formulas.
- Telegram and Weixin may internally split Markdown tables into rendered image parts.
- Feishu sends Markdown as an interactive card and keeps supported table content in-card.
- The response/history may contain `platform_metadata.delivery_parts` when one logical send becomes multiple platform messages.

If the host agent has Onlyne tools, prefer:

```text
onlyne_send({ channelId, conversationId, text })
onlyne_broadcast({ targets, text })
// raw literal text only:
onlyne_send({ channelId, conversationId, text, rawText: true })
```

Otherwise use the CLI/socket request shown above.

## Discover Conversation IDs

1. Start `onlyne run --debug` in the workspace.
2. Send a normal message to the target platform bot/account.
3. Read the platform reply; it contains redacted channel/conversation/thread metadata.
4. Use the returned `channel_id` and `conversation_id` in `send_message` or `reply_message`.

## Common Mistakes

- If `connect onlyne socket` fails, start `onlyne run` in the same workspace or pass the same `--workspace <dir>` to both commands.
- If history is empty, first verify the adapter is enabled and `status` shows the expected channel.
- If sends go to the wrong place, rediscover the conversation with `--debug`; platform IDs are not interchangeable across Telegram, Feishu, QQ Bot, and WeChat.
- If multiple examples should share config, initialize the parent directory once and run child commands under it so upward workspace discovery finds the same `.onlyne/`.
