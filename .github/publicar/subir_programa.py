"""Sube los 3 bloques de un programa (carpeta CANAL ONCE en Drive) a YouTube como PRIVADOS.

Corre en GitHub Actions (workflow subir-programa.yml). Busca en Drive la carpeta del programa
(nombre con "P<número>") y su subcarpeta "CANAL ONCE", baja "Bloque #1/#2/#3" y los sube con
título provisorio "Aire de Mar 2026 #N BX". Si un bloque ya está subido con ese título, lo saltea.
Los títulos, descripciones, la lista de la temporada y el paso a público se hacen después, con el OK de Juandi.
Repo público: no imprimir tokens, links ni IDs de Drive.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

NUM = int(os.environ["NUMERO"])
CARPETA = "application/vnd.google-apps.folder"


def log(msg):
    print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {msg}", flush=True)


creds = Credentials.from_authorized_user_info(json.loads(os.environ["GOOGLE_TOKEN"]))
creds.refresh(Request())
drive = build("drive", "v3", credentials=creds)
yt = build("youtube", "v3", credentials=creds)


def buscar(q):
    return drive.files().list(q=q + " and trashed=false", fields="files(id,name,size)", pageSize=100).execute()["files"]


# 1. Carpeta CANAL ONCE del programa
es_del_programa = re.compile(rf"\bp\s*{NUM}\b", re.I)
canal = [f for f in buscar(f"mimeType='{CARPETA}' and name contains 'once'")
         if es_del_programa.search(f["name"]) and re.search(r"canal\s*once", f["name"], re.I)]
if len(canal) != 1:
    sys.exit(f"Esperaba una carpeta CANAL ONCE del programa {NUM} y encontré {len(canal)}")
bloques = {}
for f in buscar(f"'{canal[0]['id']}' in parents and mimeType contains 'video'"):
    m = re.search(r"bloque\s*#?\s*(\d)(?!\d)", f["name"], re.I)
    if m:
        bloques[int(m.group(1))] = f
if sorted(bloques) != [1, 2, 3]:
    sys.exit(f"Esperaba los bloques 1, 2 y 3 y encontré {sorted(bloques)}")

# 2. Títulos ya subidos (para no duplicar)
subidos, tok = set(), None
up = yt.channels().list(part="contentDetails", mine=True).execute()["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]
for _ in range(2):
    r = yt.playlistItems().list(part="snippet", playlistId=up, maxResults=50, pageToken=tok).execute()
    subidos |= {it["snippet"]["title"] for it in r["items"]}
    tok = r.get("nextPageToken")
    if not tok:
        break

# 3. Bajar y subir cada bloque
for b in (1, 2, 3):
    titulo = f"Aire de Mar 2026 #{NUM} B{b}"
    if any(t == titulo or t.startswith(titulo + " ") for t in subidos):
        log(f"B{b}: ya estaba subido, lo salteo")
        continue
    ruta = f"/tmp/bloque{b}.mp4"
    with open(ruta, "wb") as fh:
        baja = MediaIoBaseDownload(fh, drive.files().get_media(fileId=bloques[b]["id"]), chunksize=64 * 2**20)
        listo = False
        while not listo:
            _, listo = baja.next_chunk()
    log(f"B{b}: bajado de Drive ({int(bloques[b]['size']) // 2**20} MB)")
    cuerpo = {"snippet": {"title": titulo, "description": "", "categoryId": "17",
                          "defaultLanguage": "es", "defaultAudioLanguage": "es"},
              "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "embeddable": True}}
    sube = yt.videos().insert(part="snippet,status", body=cuerpo,
                              media_body=MediaFileUpload(ruta, mimetype="video/mp4", resumable=True, chunksize=64 * 2**20))
    resp = None
    while resp is None:
        _, resp = sube.next_chunk()
    os.remove(ruta)
    log(f"B{b}: subido a YouTube como privado")
log("Listo")
