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
UY = timezone(timedelta(hours=-3))  # Uruguay, sin horario de verano


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

    PUB_IG, PUB_YT = nota.get("pub_ig", True), nota.get("pub_yt", True)
    creds = Credentials.from_authorized_user_info(json.loads(os.environ["GOOGLE_TOKEN"]))
    creds.refresh(Request())

    # 1. Conseguir el vertical: de Drive, o del Reel ya publicado en Instagram (si se subió a mano)
    origen_ig = "instagram.com" in nota["link_vertical"]
    if origen_ig:
        avisar(pub_progreso=10, pub_detalle="Bajando el video del Reel de Instagram…")
        codigo = re.search(r"/(?:reel|p)/([\w-]+)", nota["link_vertical"])
        if not codigo:
            raise RuntimeError("El link de Instagram no es de un Reel")
        url_video, siguiente = None, f"{IG_API}/me/media?fields=permalink,media_url,media_type&limit=50"
        for _ in range(6):  # hasta ~300 publicaciones hacia atrás
            r = requests.get(siguiente, headers={"Authorization": f"Bearer {ig_token}"}, timeout=60).json()
            m = next((x for x in r.get("data", []) if codigo.group(1) in (x.get("permalink") or "")), None)
            if m:
                url_video = m.get("media_url")
                break
            siguiente = r.get("paging", {}).get("next")
            if not siguiente:
                break
        if not url_video:
            raise RuntimeError("No encontré ese Reel en la cuenta de @airedemar.uy")
        with requests.get(url_video, stream=True, timeout=300) as r, open(VIDEO, "wb") as f:
            r.raise_for_status()
            for trozo in r.iter_content(8 * 2**20):
                f.write(trozo)
        log(f"Video bajado del Reel de Instagram ({os.path.getsize(VIDEO) // 2**20} MB)")
    else:
        avisar(pub_progreso=10, pub_detalle="Bajando el video de Drive…")
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
    publicar_yt = max(CUANDO, datetime.now(timezone.utc) + timedelta(minutes=3))
    if PUB_YT:
        yt = build("youtube", "v3", credentials=creds)
        estado = {"privacyStatus": "private", "selfDeclaredMadeForKids": False}
        if not ENSAYO:
            estado["publishAt"] = publicar_yt.strftime("%Y-%m-%dT%H:%M:%SZ")
        cuerpo = {"snippet": {"title": nota["yt_titulo"][:100], "description": nota["yt_descripcion"] or nota["copy_ig"],
                              "categoryId": "17", "defaultLanguage": "es"}, "status": estado}
        if ENSAYO:
            # El ensayo no sube: cada subida gasta 1600 de las 10.000 unidades diarias de la API, aunque después se borre
            yt.channels().list(part="id", mine=True).execute()
            log("YouTube OK (ensayo: acceso verificado, no se subió nada)")
            avisar(pub_progreso=50, pub_detalle="YouTube respondió bien. Subiendo a Instagram…")
        else:
            subida = yt.videos().insert(part="snippet,status", body=cuerpo,
                                        media_body=MediaFileUpload(VIDEO, mimetype="video/mp4", resumable=True, chunksize=16 * 2**20))
            resp = None
            while resp is None:
                _, resp = subida.next_chunk()
            vid = resp["id"]
            avisar(link_yt_short=f"https://youtu.be/{vid}", pub_progreso=50,
                   pub_detalle=f"YouTube listo (sale a las {publicar_yt.astimezone(UY):%H:%M}). Subiendo a Instagram…")
            log(f"YouTube OK: programado para {publicar_yt.isoformat()}")

    else:
        log("YouTube: no se publica (destildado)")

    # 3. Instagram: adjunto temporal en una release + Reel con video_url
    if PUB_IG:
        tag = f"tmp-pub-{NOTA_ID[:8]}-{os.environ.get('GITHUB_RUN_ID', int(time.time()))}"
        subprocess.run(["gh", "release", "create", tag, VIDEO, "--repo", REPO, "--prerelease",
                        "--title", "Temporal (se borra solo)", "--notes", "Archivo temporal para publicar en Instagram."],
                       check=True, capture_output=True)
        try:
            url = f"https://github.com/{REPO}/releases/download/{tag}/vertical.mp4"
            uid = ig("GET", "me", ig_token, params={"fields": "user_id"})["user_id"]
            datos_reel = {"media_type": "REELS", "video_url": url, "caption": nota["copy_ig"], "share_to_feed": "true"}
            collabs = [u.lstrip("@") for u in re.split(r"[,\s]+", nota.get("colaboradores") or "") if u.strip("@")][:3]
            sin_invitar = []
            try:
                cont = ig("POST", f"{uid}/media", ig_token, data={**datos_reel, **({"collaborators": json.dumps(collabs)} if collabs else {})})["id"]
            except RuntimeError as e:
                if not collabs or "not visible" not in str(e).lower():
                    raise
                # Algún collab es privado o no existe: se publica con los que sí se pueden invitar
                validos = []
                for u in collabs:
                    try:
                        ig("POST", f"{uid}/media", ig_token, data={**datos_reel, "collaborators": json.dumps([u])})
                        validos.append(u)
                    except RuntimeError:
                        sin_invitar.append(u)
                cont = ig("POST", f"{uid}/media", ig_token, data={**datos_reel, **({"collaborators": json.dumps(validos)} if validos else {})})["id"]
                log(f"{len(sin_invitar)} collab(s) no se pudieron invitar (cuenta privada o usuario inexistente)")
            avisar(pub_progreso=65, pub_detalle="Instagram está procesando el video…")
            aviso_collabs = f" No se pudo invitar como collab a: {', '.join('@' + u for u in sin_invitar)} (cuenta privada o usuario mal escrito)." if sin_invitar else ""
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
                avisar(pub_progreso=100, pub_detalle=f"Ensayo OK {datetime.now(UY):%d/%m %H:%M}: Drive, YouTube e Instagram respondieron bien. No se publicó nada.{aviso_collabs}")
                return
            espera = (CUANDO - datetime.now(timezone.utc)).total_seconds()
            avisar(pub_progreso=85, pub_detalle="Instagram procesó el video. Publicando…" if espera <= 0
                   else f"Todo listo. Sale a las {CUANDO.astimezone(UY):%H:%M}…")
            if espera > 0:
                log(f"Esperando {int(espera)}s hasta la hora de publicación")
                time.sleep(espera)
            media = ig("POST", f"{uid}/media_publish", ig_token, data={"creation_id": cont})["id"]
            link = ig("GET", media, ig_token, params={"fields": "permalink"}).get("permalink", "")
            avisar(link_ig=link, pub_estado="publicada", pub_progreso=100,
                   pub_detalle=f"Publicada el {datetime.now(UY):%d/%m %H:%M}." + (f" El Short sale en YouTube a las {publicar_yt.astimezone(UY):%H:%M}." if PUB_YT else "") + aviso_collabs)
            log("Instagram OK: publicado")
        finally:
            subprocess.run(["gh", "release", "delete", tag, "--repo", REPO, "--yes", "--cleanup-tag"], capture_output=True)
            log("Adjunto temporal borrado")
    else:
        log("Instagram: no se publica (destildado)")
        hecho = f"Ensayo OK {datetime.now(UY):%d/%m %H:%M}: el video y YouTube respondieron bien. No se publicó nada." if ENSAYO             else f"Short {'publicado' if publicar_yt <= datetime.now(timezone.utc) + timedelta(minutes=6) else 'programado'} en YouTube para las {publicar_yt.astimezone(UY):%H:%M} del {publicar_yt.astimezone(UY):%d/%m}."
        avisar(pub_progreso=100, pub_detalle=hecho, **({} if ENSAYO else {"pub_estado": "publicada"}),
               **({"link_ig": nota["link_vertical"]} if origen_ig and not nota.get("link_ig") and not ENSAYO else {}))
        return

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
            avisar(pub_estado="error" if not ENSAYO else None, pub_progreso=-1, pub_detalle=f"Error: {str(e)[:300]}")
        finally:
            sys.exit(1)
