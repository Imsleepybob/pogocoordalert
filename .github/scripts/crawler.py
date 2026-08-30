import json
import os
import smtplib
import time
from datetime import datetime, timezone
from email.mime.text import MIMEText
from pathlib import Path

import requests

API_BASE = "https://coordinates-api.pokemongopro.com"
REPO_ROOT = Path(__file__).resolve().parents[2]
FILTERS_PATH = REPO_ROOT / "filters.json"
NOTIFIED_PATH = REPO_ROOT / "notified.json"

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


def reveal(reveal_code):
    headers = {
        "Authorization": f"Bearer {JWT_TOKEN}",
    }
    response = requests.get(f"{API_BASE}/reveal/{reveal_code}", headers=headers, timeout=20)
    if response.status_code == 401:
        raise PermissionError("JWT 토큰이 만료되었거나 유효하지 않습니다.")
    response.raise_for_status()
    return response.json()


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


def build_email_body(spawns):
    lines = []
    for spawn in spawns:
        despawn_remaining = format_despawn_remaining(spawn["despawn_at"])
        coords = spawn.get("coords")
        maps_link = f"https://www.google.com/maps?q={coords}" if coords else "좌표 획득 실패"
        lines.append(
            f"{spawn['pokemon_name']}이(가) {spawn['distance_km']}km 거리에 출현했습니다! "
            f"디스폰까지: {despawn_remaining}\n"
            f"CP {spawn['cp']} / 레벨 {spawn['level']} / IV {spawn['iv_percent']}%\n"
            f"좌표: {coords}\n"
            f"지도에서 보기: {maps_link}\n"
        )
    return "\n".join(lines)


def send_email(to_address, subject, body):
    message = MIMEText(body)
    message["Subject"] = subject
    message["From"] = GMAIL_ADDRESS
    message["To"] = to_address

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_ADDRESS, GMAIL_APP_PASSWORD)
        server.send_message(message)


def send_failure_email(to_address, error_message):
    send_email(to_address, "[포고 크롤러] 인증 실패", f"JWT 토큰 문제로 크롤러가 중단되었습니다.\n\n{error_message}")


# 메인 로직
def main():
    filters = load_json(FILTERS_PATH, [])
    notified = clean_notified(load_json(NOTIFIED_PATH, {}))

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

            try:
                coords_data = reveal(spawn["reveal_code"])
                spawn["coords"] = coords_data["coords"]
            except PermissionError as e:
                if notify_email:
                    send_failure_email(notify_email, str(e))
                save_json(NOTIFIED_PATH, notified)
                return
            except requests.exceptions.RequestException:
                spawn["coords"] = None

            mark_notified(notified, spawn["encounter_id"], spawn["despawn_at"])
            new_spawns.append(spawn)

    if new_spawns and notify_email:
        subject = f"[포켓몬 알림] {len(new_spawns)}마리 감지됨"
        body = build_email_body(new_spawns)
        send_email(notify_email, subject, body)

    save_json(NOTIFIED_PATH, notified)


if __name__ == "__main__":
    main()
