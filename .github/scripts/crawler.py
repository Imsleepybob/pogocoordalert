import json
import os
import smtplib
import time
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import requests

API_BASE = "https://coordinates-api.pokemongopro.com"
SITE_BASE = "https://Imsleepybob.github.io/pogocoordalert"
REPO_ROOT = Path(__file__).resolve().parents[2]
FILTERS_PATH = REPO_ROOT / "filters.json"
NOTIFIED_PATH = REPO_ROOT / "notified.json"
POKEMON_KO_NAMES_PATH = REPO_ROOT / "pokemon_ko_names.json"

JWT_TOKEN = os.environ["PGP_JWT_TOKEN"]
GMAIL_ADDRESS = os.environ["GMAIL_ADDRESS"]
GMAIL_APP_PASSWORD = os.environ["GMAIL_APP_PASSWORD"]
NOTIFY_EMAIL = os.environ["NOTIFY_EMAIL"]


# 데이터 로드/저장
def load_json(path, default):
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# API 호출
def strip_internal_fields(filter_condition):
    return {k: v for k, v in filter_condition.items() if not k.startswith("_")}


def search(filter_condition):
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {JWT_TOKEN}",
    }
    payload = strip_internal_fields(filter_condition)
    response = requests.post(f"{API_BASE}/search", headers=headers, json=payload, timeout=20)
    if response.status_code == 401:
        raise PermissionError("JWT 토큰이 만료되었거나 유효하지 않습니다.")
    response.raise_for_status()
    return response.json()


# 포켓몬 이름 한국어화
def load_pokemon_ko_names():
    ko_names_by_id = {}
    for info in load_json(POKEMON_KO_NAMES_PATH, {}).values():
        ko_names_by_id[info["id"]] = info["ko"]
    return ko_names_by_id


def get_pokemon_display_name(ko_names_by_id, spawn):
    ko_name = ko_names_by_id.get(spawn["pokemon_id"])
    if not ko_name:
        return spawn["pokemon_name"]
    if spawn.get("form"):
        return f"{ko_name} ({spawn['form']})"
    return ko_name


# 중복 방지
def clean_notified(notified):
    now = datetime.now(timezone.utc).timestamp()
    return {k: v for k, v in notified.items() if v > now}


def is_new_spawn(notified, encounter_id):
    return encounter_id not in notified


def mark_notified(notified, encounter_id, despawn_at):
    despawn_ts = datetime.fromisoformat(despawn_at.replace("Z", "+00:00")).timestamp()
    notified[encounter_id] = despawn_ts


# 알림 메시지 구성
def format_despawn_remaining(despawn_at):
    despawn_dt = datetime.fromisoformat(despawn_at.replace("Z", "+00:00"))
    remaining = despawn_dt - datetime.now(timezone.utc)
    total_seconds = max(0, int(remaining.total_seconds()))
    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes}분 {seconds}초"


def build_email_body(spawns, ko_names_by_id):
    cards = []
    for spawn in spawns:
        despawn_remaining = format_despawn_remaining(spawn["despawn_at"])
        display_name = get_pokemon_display_name(ko_names_by_id, spawn)
        reveal_link = f"{SITE_BASE}/reveal.html?code={spawn['reveal_code']}"
        cards.append(f"""
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border:1px solid #e0e0e0; border-radius:8px; margin-bottom:12px;">
          <tr>
            <td style="padding:16px;">
              <div style="font-size:16px; font-weight:bold; color:#222;">{display_name}</div>
              <div style="font-size:13px; color:#888; margin-top:2px;">{spawn['distance_km']}km 거리 · 디스폰까지 {despawn_remaining}</div>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
                <tr>
                  <td style="font-size:13px; color:#555; padding-right:12px;">CP <b>{spawn['cp']}</b></td>
                  <td style="font-size:13px; color:#555; padding-right:12px;">레벨 <b>{spawn['level']}</b></td>
                  <td style="font-size:13px; color:#555;">IV <b>{spawn['iv_percent']}%</b> ({spawn['raw_iv']})</td>
                </tr>
              </table>
              <a href="{reveal_link}" style="display:inline-block; margin-top:12px; padding:8px 16px; background:#333333; color:#ffffff; text-decoration:none; border-radius:6px; font-size:13px;">좌표 보기</a>
            </td>
          </tr>
        </table>
        """)

    return f"""
    <html>
      <body style="font-family:-apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif; background:#f5f5f5; padding:16px;">
        <div style="max-width:480px; margin:0 auto;">
          {"".join(cards)}
        </div>
      </body>
    </html>
    """


def send_email(to_address, subject, html_body):
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = GMAIL_ADDRESS
    message["To"] = to_address
    message.attach(MIMEText(html_body, "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        server.send_message(message)


def send_failure_email(to_address, error_message):
    send_email(to_address, "[포고 크롤러] 인증 실패", f"<p>JWT 토큰 문제로 크롤러가 중단되었습니다.</p><p>{error_message}</p>")


# 메인 로직
def main():
    filters = load_json(FILTERS_PATH, [])
    notified = clean_notified(load_json(NOTIFIED_PATH, {}))
    ko_names_by_id = load_pokemon_ko_names()

    notify_email = NOTIFY_EMAIL
    new_spawns = []

    for filter_condition in filters:
        try:
            result = search(filter_condition)
        except PermissionError as e:
            if notify_email:
                send_failure_email(notify_email, str(e))
            save_json(NOTIFIED_PATH, notified)
            return

        for spawn in result.get("results", []):
            if not is_new_spawn(notified, spawn["encounter_id"]):
                continue

            mark_notified(notified, spawn["encounter_id"], spawn["despawn_at"])
            new_spawns.append(spawn)

    if new_spawns and notify_email:
        subject = f"[포고 알림] {len(new_spawns)}마리 감지됨"
        body = build_email_body(new_spawns, ko_names_by_id)
        send_email(notify_email, subject, body)

    save_json(NOTIFIED_PATH, notified)


if __name__ == "__main__":
    main()
