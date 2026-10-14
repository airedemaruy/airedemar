"""Publica el recorte vertical de una nota como Short en YouTube y como Reel en Instagram.

Corre en GitHub Actions (workflow publicar.yml), disparado por la app del equipo vía Supabase.
1. Lee la nota de Supabase (con el secreto compartido PUB_SECRETO).
2. Baja el vertical de Google Drive.
3. YouTube: lo sube como privado con publicación programada (la app no está auditada por Google).
4. Instagram: la API pide un link público, así que lo sube como adjunto temporal de una release
   de este repo, crea el Reel con ese link, publica a la hora y borra la release.
5. Guarda los links en la nota.

Este repo es público: los registros de Actions también. Nunca imprimir tokens ni links de Drive.
"""
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

NOTA_ID = os.environ["NOTA_ID"]
CUANDO = datetime.fromisoformat(os.environ["CUANDO"].replace("Z", "+00:00"))
ENSAYO = os.environ.get("ENSAYO") == "true"
SECRETO = os.environ["PUB_SECRETO"]
REPO = os.environ["GITHUB_REPOSITORY"]
IG_API = "https://graph.instagram.com/v23.0"
VIDEO = "/tmp/vertical.mp4"


def supabase():
    app = open("equipo/app.js", encoding="utf-8").read()
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", app).group(1)
    key = re.search(r"SUPABASE_ANON\s*=\s*'([^']+)'", app).group(1)
    return url, key


SB_URL, SB_KEY = supabase()


def rpc(nombre, **args):
    r = requests.post(f"{SB_URL}/rest/v1/rpc/{nombre}", json={"p_secreto": SECRETO, **args},
                      headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Supabase {nombre}: {r.status_code} {r.text[:200]}")
    return r.json() if r.text else None


def avisar(**campos):
    rpc("pub_resultado", p_id=NOTA_ID, p_campos=campos)


def log(msg):
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


def ig(metodo, ruta, token, **kw):
    r = requests.request(metodo, f"{IG_API}/{ruta}", headers={"Authorization": f"Bearer {token}"}, timeout=120, **kw)
    data = r.json() if r.text else {}
    if not r.ok or "error" in data:
        raise RuntimeError(f"Instagram: {data.get('error', {}).get('message', r.status_code)}")
    return data


def id_drive(link):
    m = re.search(r"/d/([\w-]{20,})", link) or re.search(r"[?&]id=([\w-]{20,})", link)
    if not m:
        raise RuntimeError("El link vertical no es un link de Google Drive")
    return m.group(1)


def main():
    datos = rpc("pub_nota", p_id=NOTA_ID)
    nota, ig_token = datos["nota"], datos["ig_token"]
    log(f"Nota: {nota['titulo']} | {'ENSAYO (no se publica)' if ENSAYO else 'publicar a las ' + CUANDO.isoformat()}")

    creds = Credentials.from_authorized_user_info(json.loads(os.environ["GOOGLE_TOKEN"]))
    creds.refresh(Request())

    # 1. Bajar el vertical de Drive
    drive = build("drive", "v3", credentials=creds)
    fid = id_drive(nota["link_vertical"])
    meta = drive.files().get(fileId=fid, fields="size,mimeType", supportsAllDrives=True).execute()
    with open(VIDEO, "wb") as f:
        bajada = MediaIoBaseDownload(f, drive.files().get_media(fileId=fid, supportsAllDrives=True), chunksize=32 * 2**20)
        listo = False
        while not listo:
            _, listo = bajada.next_chunk()
    log(f"Video bajado de Drive ({int(meta['size']) // 2**20} MB)")

    # 2. YouTube: privado + publishAt (o privado y se borra, si es ensayo)
    yt = build("youtube", "v3", credentials=creds)
    publicar_yt = max(CUANDO, datetime.now(timezone.utc) + timedelta(minutes=3))
    estado = {"privacyStatus": "private", "selfDeclaredMadeForKids": False}
    if not ENSAYO:
        estado["publishAt"] = publicar_yt.strftime("%Y-%m-%dT%H:%M:%SZ")
    cuerpo = {"snippet": {"title": nota["yt_titulo"][:100], "description": nota["yt_descripcion"] or nota["copy_ig"],
                          "categoryId": "17", "defaultLanguage": "es"}, "status": estado}
    subida = yt.videos().insert(part="snippet,status", body=cuerpo,
                                media_body=MediaFileUpload(VIDEO, mimetype="video/mp4", resumable=True, chunksize=16 * 2**20))
    resp = None
    while resp is None:
        _, resp = subida.next_chunk()
    vid = resp["id"]
    if ENSAYO:
        yt.videos().delete(id=vid).execute()
        log("YouTube OK (ensayo: se subió privado y se borró)")
    else:
        avisar(link_yt_short=f"https://youtu.be/{vid}", pub_detalle="YouTube listo. Subiendo a Instagram…")
        log(f"YouTube OK: programado para {publicar_yt.isoformat()}")

    # 3. Instagram: adjunto temporal en una release + Reel con video_url
    tag = f"tmp-pub-{NOTA_ID[:8]}-{os.environ.get('GITHUB_RUN_ID', int(time.time()))}"
    subprocess.run(["gh", "release", "create", tag, VIDEO, "--repo", REPO, "--prerelease",
                    "--title", "Temporal (se borra solo)", "--notes", "Archivo temporal para publicar en Instagram."],
                   check=True, capture_output=True)
    try:
        url = f"https://github.com/{REPO}/releases/download/{tag}/vertical.mp4"
        uid = ig("GET", "me", ig_token, params={"fields": "user_id"})["user_id"]
        cont = ig("POST", f"{uid}/media", ig_token, data={"media_type": "REELS", "video_url": url,
                                                      "caption": nota["copy_ig"], "share_to_feed": "true"})["id"]
        for _ in range(90):
            st = ig("GET", cont, ig_token, params={"fields": "status_code,status"})
            if st["status_code"] in ("FINISHED", "ERROR", "EXPIRED"):
                break
            time.sleep(10)
        if st["status_code"] != "FINISHED":
            raise RuntimeError(f"Instagram no pudo procesar el video: {st.get('status')}")
        log("Instagram procesó el video")
        if ENSAYO:
            log("Ensayo: no se publica en Instagram")
            avisar(pub_detalle=f"Ensayo OK {datetime.now(timezone.utc):%d/%m %H:%M} UTC: Drive, YouTube e Instagram respondieron bien. No se publicó nada.")
            return
        espera = (CUANDO - datetime.now(timezone.utc)).total_seconds()
        if espera > 0:
            log(f"Esperando {int(espera)}s hasta la hora de publicación")
            time.sleep(espera)
        media = ig("POST", f"{uid}/media_publish", ig_token, data={"creation_id": cont})["id"]
        link = ig("GET", media, ig_token, params={"fields": "permalink"}).get("permalink", "")
        avisar(link_ig=link, pub_estado="publicada", pub_detalle=f"Publicada el {datetime.now(timezone.utc):%d/%m %H:%M} UTC")
        log("Instagram OK: publicado")
    finally:
        subprocess.run(["gh", "release", "delete", tag, "--repo", REPO, "--yes", "--cleanup-tag"], capture_output=True)
        log("Adjunto temporal borrado")

    # 4. Renovar el token de IG si tiene más de 30 días (vence a los 60)
    act = datos.get("ig_token_actualizado")
    if act and datetime.fromisoformat(act) < datetime.now(timezone.utc) - timedelta(days=30):
        nuevo = ig("GET", "refresh_access_token", ig_token, params={"grant_type": "ig_refresh_token"}).get("access_token")
        if nuevo:
            rpc("pub_guardar_credenciales", p_ig_token=nuevo)
            log("Token de Instagram renovado")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # el detalle va a la app; el registro público solo dice que falló
        log("Falló la publicación")
        try:
            avisar(pub_estado="error" if not ENSAYO else None, pub_detalle=f"Error: {str(e)[:300]}")
        finally:
            sys.exit(1)
