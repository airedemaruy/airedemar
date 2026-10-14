"""Publica un programa en YouTube: los 3 bloques + el programa completo (los 3 pegados sin recomprimir).

Corre en GitHub Actions (workflow programa.yml). Pasos:
1. Lee la tarjeta del programa en Supabase (títulos, descripciones, links ya subidos).
2. Busca la carpeta CANAL ONCE del programa en Drive y baja los 3 bloques.
3. Sube a YouTube los bloques que todavía no estén (reusa los ya subidos) y el programa completo.
4. Aplica títulos y descripciones, los deja privados con publicación programada (la app no está
   auditada por Google, así que no se puede pasar a público directo) y los suma a la lista de la temporada.
Repo público: no imprimir tokens, links ni IDs de Drive.
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

PROG_ID = os.environ["PROGRAMA_ID"]
CUANDO = datetime.fromisoformat(os.environ["CUANDO"].replace("Z", "+00:00"))
SECRETO = os.environ["PUB_SECRETO"]
LISTA = "PLBpp16n7GHdg"  # "Aire de Mar · Temporada 2026"
UY = timezone(timedelta(hours=-3))
CARPETA = "application/vnd.google-apps.folder"

app = open("equipo/app.js", encoding="utf-8").read()
SB_URL = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", app).group(1)
SB_KEY = re.search(r"SUPABASE_ANON\s*=\s*'([^']+)'", app).group(1)


def rpc(nombre, **args):
    r = requests.post(f"{SB_URL}/rest/v1/rpc/{nombre}", json={"p_secreto": SECRETO, **args},
                      headers={"apikey": SB_KEY, "Authorization": f"Bearer {SB_KEY}"}, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Supabase {nombre}: {r.status_code} {r.text[:200]}")
    return r.json() if r.text else None


def avisar(**campos):
    rpc("pub_programa_resultado", p_id=PROG_ID, p_campos=campos)


def log(msg):
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


def id_yt(link):
    m = re.search(r"(?:youtu\.be/|[?&]v=|/shorts/)([\w-]{11})", link or "")
    return m.group(1) if m else ""


def subir(yt, ruta, titulo):
    cuerpo = {"snippet": {"title": titulo, "description": "", "categoryId": "17", "defaultLanguage": "es", "defaultAudioLanguage": "es"},
              "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "embeddable": True}}
    req = yt.videos().insert(part="snippet,status", body=cuerpo,
                             media_body=MediaFileUpload(ruta, mimetype="video/mp4", resumable=True, chunksize=64 * 2**20))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    return resp["id"]


def orden(titulo):
    """Posición en la lista: programa más nuevo primero; dentro de cada uno, completo, B1, B2, B3."""
    m = re.match(r"Aire de Mar 2026 #(\d+)(?: B(\d)| - Programa completo)", titulo or "")
    return (-int(m.group(1)), int(m.group(2) or 0)) if m else None


def main():
    p = rpc("pub_programa", p_id=PROG_ID)
    n = p["numero"]
    log(f"Programa #{n}")
    avisar(pub_estado="publicando", pub_progreso=5, pub_detalle="Buscando los bloques en Drive…")
    creds = Credentials.from_authorized_user_info(json.loads(os.environ["GOOGLE_TOKEN"]))
    creds.refresh(Request())
    drive = build("drive", "v3", credentials=creds)
    yt = build("youtube", "v3", credentials=creds)

    # 1. Bloques finales en la carpeta CANAL ONCE
    del_prog = re.compile(rf"\bp\s*{n}\b", re.I)
    canal = [f for f in drive.files().list(q=f"mimeType='{CARPETA}' and name contains 'once' and trashed=false",
                                          fields="files(id,name)", pageSize=100).execute()["files"]
             if del_prog.search(f["name"]) and re.search(r"canal\s*once", f["name"], re.I)]
    if len(canal) != 1:
        raise RuntimeError(f"No encontré una única carpeta CANAL ONCE del programa {n} (hay {len(canal)})")
    bloques = {}
    for f in drive.files().list(q=f"'{canal[0]['id']}' in parents and trashed=false and mimeType contains 'video'",
                                fields="files(id,name)").execute()["files"]:
        m = re.search(r"bloque\s*#?\s*(\d)(?!\d)", f["name"], re.I)
        if m:
            bloques[int(m.group(1))] = f["id"]
    if sorted(bloques) != [1, 2, 3]:
        raise RuntimeError(f"En CANAL ONCE esperaba los bloques 1, 2 y 3 y encontré {sorted(bloques)}")
    avisar(**{f"link_b{b}": f"https://drive.google.com/file/d/{bloques[b]}/view" for b in bloques})

    rutas = {}
    for b in (1, 2, 3):
        rutas[b] = f"/tmp/b{b}.mp4"
        with open(rutas[b], "wb") as fh:
            baja = MediaIoBaseDownload(fh, drive.files().get_media(fileId=bloques[b]), chunksize=64 * 2**20)
            listo = False
            while not listo:
                _, listo = baja.next_chunk()
    log("Bloques bajados de Drive")
    avisar(pub_progreso=20, pub_detalle="Subiendo los bloques a YouTube…")

    # 2. Bloques en YouTube (reusa los ya subidos)
    ids = {b: id_yt(p[f"yt_b{b}"]) for b in (1, 2, 3)}
    for b in (1, 2, 3):
        if not ids[b]:
            ids[b] = subir(yt, rutas[b], f"Aire de Mar 2026 #{n} B{b}")
            avisar(**{f"yt_b{b}": f"https://youtu.be/{ids[b]}"})
            log(f"B{b} subido")
        else:
            log(f"B{b} ya estaba en YouTube")
    avisar(pub_progreso=40, pub_detalle="Armando el programa completo…")

    # 3. Programa completo: los 3 bloques pegados sin recomprimir (si no son compatibles, se recomprime)
    id_comp = id_yt(p["yt_completo"])
    if not id_comp:
        open("/tmp/lista.txt", "w").write("".join(f"file '{rutas[b]}'\n" for b in (1, 2, 3)))
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "/tmp/lista.txt",
                            "-c", "copy", "-movflags", "+faststart", "/tmp/completo.mp4"], capture_output=True, text=True)
        if r.returncode:
            log("Los bloques no se pueden pegar directo: se recomprime (tarda más)")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "/tmp/lista.txt",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
                            "-movflags", "+faststart", "/tmp/completo.mp4"], check=True)
        log("Programa completo armado")
        avisar(pub_progreso=60, pub_detalle="Subiendo el programa completo…")
        id_comp = subir(yt, "/tmp/completo.mp4", f"Aire de Mar 2026 #{n} - Programa completo")
        avisar(yt_completo=f"https://youtu.be/{id_comp}")
        log("Programa completo subido")
    avisar(pub_progreso=80, pub_detalle="Cargando títulos, descripciones y la lista de la temporada…")

    # 4. Títulos, descripciones y publicación programada
    publicar = max(CUANDO, datetime.now(timezone.utc) + timedelta(minutes=3))
    videos = [(ids[1], p["titulo_b1"], p["desc_b1"]), (ids[2], p["titulo_b2"], p["desc_b2"]),
              (ids[3], p["titulo_b3"], p["desc_b3"]), (id_comp, p["titulo_completo"], p["desc_completo"])]
    for vid, titulo, desc in videos:
        if not titulo:
            raise RuntimeError("Faltan títulos en la tarjeta del programa")
        actual = yt.videos().list(part="status", id=vid).execute()["items"][0]["status"]
        cuerpo = {"id": vid, "snippet": {"title": titulo[:100], "description": desc, "categoryId": "17",
                                         "defaultLanguage": "es", "defaultAudioLanguage": "es"}}
        partes = "snippet"
        if actual["privacyStatus"] != "public":
            cuerpo["status"] = {"privacyStatus": "private", "publishAt": publicar.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "selfDeclaredMadeForKids": False, "embeddable": True}
            partes = "snippet,status"
        yt.videos().update(part=partes, body=cuerpo).execute()
    log(f"Títulos y descripciones cargados; salen a las {publicar.astimezone(UY):%H:%M} del {publicar.astimezone(UY):%d/%m}")

    # 5. Lista de la temporada, cada uno en su lugar (sin duplicar)
    def items_lista():
        items, tok = [], None
        while True:
            r = yt.playlistItems().list(part="snippet,contentDetails", playlistId=LISTA, maxResults=50, pageToken=tok).execute()
            items += r["items"]
            tok = r.get("nextPageToken")
            if not tok:
                return items
    for vid, titulo, _ in sorted(videos, key=lambda v: orden(v[1]) or (0, 0)):
        actuales = items_lista()
        if vid in {i["contentDetails"]["videoId"] for i in actuales}:
            continue
        pos = sum(1 for a in actuales if orden(a["snippet"]["title"]) and orden(a["snippet"]["title"]) < orden(titulo))
        yt.playlistItems().insert(part="snippet", body={"snippet": {"playlistId": LISTA, "position": pos,
                                  "resourceId": {"kind": "youtube#video", "videoId": vid}}}).execute()
    log("Lista de la temporada actualizada")

    hora = f"{publicar.astimezone(UY):%H:%M} del {publicar.astimezone(UY):%d/%m}"
    avisar(pub_estado="publicada" if publicar <= datetime.now(timezone.utc) + timedelta(minutes=5) else "programada",
           pub_progreso=100, yt=True, etapa=4,
           pub_detalle=f"Los 3 bloques y el programa completo salen en YouTube a las {hora}. Falta asignar el programa completo como video relacionado de cada bloque (en Studio).")
    log("Listo")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log("Falló la publicación del programa")
        try:
            avisar(pub_estado="error", pub_progreso=-1, pub_detalle=f"Error: {str(e)[:300]}")
        finally:
            sys.exit(1)
