"""Publica un programa en YouTube: el programa completo (los 3 bloques pegados) + los 3 bloques.

Corre en GitHub Actions (workflow programa.yml). Modos:
- sabado: (sábado 14:00) busca los bloques finales en CANAL ONCE, sube lo que falte, arma el completo,
  lo programa todo para el domingo 19:00 y le manda un mail a Floppy para que cargue títulos y descripciones.
- aplicar: (domingo 18:30, o botón de la app) aplica títulos y descripciones de la tarjeta y suma capítulos
  automáticos (sacados de los subtítulos de YouTube) a las descripciones que no los tengan.
- ahora: (botón de la app) hace todo y publica ya.
Semana (19:00): completo el domingo, B1 el lunes, B2 el miércoles, B3 el viernes; los recaps de cada bloque
(Reel + Short, desde Informes) salen martes, jueves y sábado. Así cada pieza sale después de la que tiene como
video relacionado: bloques → completo, Shorts → su bloque. Los videos quedan privados con publicación programada (la app no está
auditada por Google, así que no se puede pasar a público directo).
Repo público: no imprimir tokens, links ni IDs de Drive.
"""
import base64
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload, MediaIoBaseDownload

PROG_ID = os.environ["PROGRAMA_ID"]
CUANDO = datetime.fromisoformat(os.environ["CUANDO"].replace("Z", "+00:00"))
MODO = os.environ.get("MODO") or "ahora"
SECRETO = os.environ["PUB_SECRETO"]
LISTA = "PLBpp16n7GHdg"  # "Aire de Mar · Temporada 2026"
APP = "https://airedemaruy.github.io/airedemar/equipo/#programas"
FLOPPY = "florsagasti@gmail.com"
UY = timezone(timedelta(hours=-3))
CARPETA = "application/vnd.google-apps.folder"
PIE = "Domingos 17:30 por Canal Once Punta del Este. Desde las 19:00, en YouTube."

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


def mmss(s):
    s = int(s)
    return f"{s // 3600}:{s % 3600 // 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def a_seg(t):
    partes = [int(x) for x in t.split(":")]
    return sum(v * 60 ** i for i, v in enumerate(reversed(partes)))


def orden(titulo):
    """Posición en la lista: programa más nuevo primero; dentro de cada uno, completo, B1, B2, B3."""
    m = re.match(r"Aire de Mar 2026 #(\d+)(?: B(\d)| - Programa completo)", titulo or "")
    return (-int(m.group(1)), int(m.group(2) or 0)) if m else None


def seg_iso(d):
    h, m, s = (int(x or 0) for x in re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d).groups())
    return h * 3600 + m * 60 + s


# ---------- capítulos ----------
def subtitulos(yt, vid):
    """Subtítulos automáticos de YouTube como [(segundo, texto)]. Vacío si todavía no están."""
    pistas = yt.captions().list(part="snippet", videoId=vid).execute().get("items", [])
    if not pistas:
        return []
    srt = yt.captions().download(id=pistas[0]["id"], tfmt="srt").execute().decode("utf-8")
    filas = []
    for b in re.split(r"\n\s*\n", srt.strip()):
        l = b.splitlines()
        if len(l) >= 3 and "-->" in l[1]:
            filas.append((a_seg(l[1].split(",")[0]), " ".join(l[2:]).lower()))
    return filas


def primera(filas, patron, desde=0):
    """Primer subtítulo donde arranca la frase. Lee de a dos líneas: los subtítulos cortan frases al medio."""
    for i, (t, x) in enumerate(filas):
        junto = x + " " + (filas[i + 1][1] if i + 1 < len(filas) else "")
        if t >= desde and re.search(patron, junto):
            return t
    return None


def tema(titulo, quitar):
    """Lo que viene después del prefijo "Aire de Mar 2026 #N BX" en el título, sin el invitado."""
    partes = [x.strip() for x in (titulo or "").split(" - ")[1:] if x.strip()]
    partes = [x for x in partes if x.lower() != (quitar or "").lower()]
    return partes[-1] if partes else ""


def capitulos_auto(b, filas, p):
    inv = p["invitado"]
    if b == 1:
        pp = primera(filas, r"ping\s*-?\s*pong|pimp[oó]n")
        nota = primera(filas, r"m[aá]s aire del? mar para compartir")
        caps = [(0, "Apertura")]
        if pp:
            caps.append((pp, f"Ping pong con {inv}" if inv else "Ping pong"))
        if nota:
            caps.append((nota + 3, tema(p["titulo_b1"], inv) or "Nota"))
        return caps
    if b == 3:
        olas = primera(filas, r"olas del mundo|mejores olas")
        mitad = filas[-1][0] / 2 if filas else 0  # el cierre está en la segunda mitad del bloque
        cierre = primera(filas, r"hasta aqu[ií] llegamos|nos pueden encontrar|nuestro canal de youtube|nos vemos la pr[oó]xima", mitad)
        caps = [(0, "Informe especial" + (f": {tema(p['titulo_b3'], inv)}" if tema(p["titulo_b3"], inv) else ""))]
        if olas:
            caps.append((olas, "Olas del mundo"))
        if cierre:
            caps.append((cierre, "Cierre"))
        return caps
    return [(0, f"Entrevista a {inv}" if inv else "Entrevista")]


def capitulos_de_texto(desc):
    return [(a_seg(m.group(1)), m.group(2).strip()) for m in re.finditer(r"^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$", desc or "", re.M)]


def con_capitulos(desc, caps):
    """Suma capítulos a una descripción que no los tenga. YouTube pide al menos 3, el primero en 0:00."""
    if re.search(r"^0:00\s", desc or "", re.M) or len(caps) < 3:
        return desc
    lista = "\n".join(f"{mmss(t)} {n}" for t, n in caps)
    cuerpo = (desc or "").replace(PIE, "").strip()  # el pie del programa va siempre al final
    return "\n\n".join(x for x in [cuerpo, "Capítulos:\n" + lista, PIE] if x)


# ---------- mail ----------
def mail_floppy(gmail, p, agenda):
    cuerpo = f"""Hola Flor!

Ya están en YouTube el programa completo y los 3 bloques del #{p['numero']} ({p['invitado'] or 'sin invitado cargado'}), programados así:
{agenda}

Cargá los títulos y las descripciones en la app antes del domingo a las 18:30:
{APP}
(abrí la tarjeta del #{p['numero']}, sección YouTube)

Los capítulos se agregan solos. Si no llegás, salen con títulos provisorios y se corrigen después.

Aire de Mar"""
    msg = MIMEText(cuerpo, "plain", "utf-8")
    msg["To"] = FLOPPY
    msg["Subject"] = f"Aire de Mar #{p['numero']}: títulos y descripciones para YouTube"
    gmail.users().messages().send(userId="me", body={"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode()}).execute()


# ---------- principal ----------
def subir(yt, ruta, titulo):
    cuerpo = {"snippet": {"title": titulo, "description": "", "categoryId": "17", "defaultLanguage": "es", "defaultAudioLanguage": "es"},
              "status": {"privacyStatus": "private", "selfDeclaredMadeForKids": False, "embeddable": True}}
    req = yt.videos().insert(part="snippet,status", body=cuerpo,
                             media_body=MediaFileUpload(ruta, mimetype="video/mp4", resumable=True, chunksize=64 * 2**20))
    resp = None
    while resp is None:
        _, resp = req.next_chunk()
    return resp["id"]


def dur(ruta):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", ruta], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def main():
    p = rpc("pub_programa", p_id=PROG_ID)
    n = p["numero"]
    log(f"Programa #{n} | modo {MODO}")
    creds = Credentials.from_authorized_user_info(json.loads(os.environ["GOOGLE_TOKEN"]))
    creds.refresh(Request())
    yt = build("youtube", "v3", credentials=creds)
    ids = {b: id_yt(p[f"yt_b{b}"]) for b in (1, 2, 3)}
    id_comp = id_yt(p["yt_completo"])

    # 1. Subidas que falten (bloques desde CANAL ONCE y el completo)
    if not all(ids.values()) or not id_comp:
        avisar(pub_progreso=10, pub_detalle="Buscando los bloques en la carpeta CANAL ONCE…")
        drive = build("drive", "v3", credentials=creds)
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
            raise RuntimeError(f"En CANAL ONCE del #{n} esperaba los bloques 1, 2 y 3 y encontré {sorted(bloques) or 'ninguno'}")
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
        for b in (1, 2, 3):
            if not ids[b]:
                ids[b] = subir(yt, rutas[b], f"Aire de Mar 2026 #{n} B{b}")
                avisar(**{f"yt_b{b}": f"https://youtu.be/{ids[b]}"})
                log(f"B{b} subido")
        if not id_comp:
            avisar(pub_progreso=40, pub_detalle="Armando el programa completo…")
            esperado = sum(dur(rutas[b]) for b in (1, 2, 3))
            open("/tmp/lista.txt", "w").write("".join(f"file '{rutas[b]}'\n" for b in (1, 2, 3)))
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "/tmp/lista.txt",
                                "-c", "copy", "-movflags", "+faststart", "/tmp/completo.mp4"], capture_output=True, text=True)
            # Pegar sin recomprimir solo sirve si las marcas de tiempo encajan: se verifica la duración
            if r.returncode or abs(dur("/tmp/completo.mp4") - esperado) > 2:
                log(f"Pegado directo no sirvió (duración {dur('/tmp/completo.mp4'):.0f}s, esperada {esperado:.0f}s): se recomprime")
                avisar(pub_progreso=45, pub_detalle="Armando el programa completo (recomprimiendo en alta calidad, tarda unos minutos)…")
                subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", rutas[1], "-i", rutas[2], "-i", rutas[3],
                                "-filter_complex", "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]",
                                "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
                                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "/tmp/completo.mp4"], check=True)
            final = dur("/tmp/completo.mp4")
            if abs(final - esperado) > 2:
                raise RuntimeError(f"El programa completo dura {final:.0f}s y debería durar {esperado:.0f}s")
            avisar(pub_progreso=60, pub_detalle="Subiendo el programa completo…")
            id_comp = subir(yt, "/tmp/completo.mp4", f"Aire de Mar 2026 #{n} - Programa completo")
            avisar(yt_completo=f"https://youtu.be/{id_comp}")
            log(f"Programa completo subido ({mmss(final)})")
    avisar(pub_progreso=75, pub_detalle="Cargando títulos, descripciones y capítulos…")

    # 2. Capítulos: los que escribió Floppy (o Claude) se respetan; si faltan, salen de los subtítulos de YouTube
    durs = {v["id"]: seg_iso(v["contentDetails"]["duration"])
            for v in yt.videos().list(part="contentDetails", id=",".join([ids[1], ids[2], ids[3]])).execute()["items"]}
    descs, caps_bloque = {}, {}
    for b in (1, 2, 3):
        desc = p[f"desc_b{b}"]
        caps = capitulos_de_texto(desc)
        if not caps:
            filas = subtitulos(yt, ids[b])
            caps = capitulos_auto(b, filas, p) if filas else [(0, "")]
            desc = con_capitulos(desc, caps)
        caps_bloque[b] = caps
        descs[b] = desc or PIE
    desc_comp = p["desc_completo"]
    if not capitulos_de_texto(desc_comp):
        caps, offset = [], 0
        for b in (1, 2, 3):
            caps += [(t + offset, nombre or f"Bloque {b}") for t, nombre in caps_bloque[b]]
            offset += durs.get(ids[b], 0)
        desc_comp = con_capitulos(desc_comp, caps)
    descs["completo"] = desc_comp or PIE

    # 3. Títulos, descripciones y publicación programada.
    #    Semana: completo el domingo, B1 el lunes, B2 el miércoles y B3 el viernes (los recaps de cada bloque salen
    #    martes, jueves y sábado desde Informes). "ahora": todo ya, completo primero y un minuto entre cada uno.
    #    Siempre el completo antes que los bloques, para que cada bloque lo pueda tener como video relacionado.
    minimo = datetime.now(timezone.utc) + timedelta(minutes=3)
    dias = {"completo": 0, 1: 1, 2: 3, 3: 5} if MODO != "ahora" else {"completo": 0, 1: 0, 2: 0, 3: 0}
    cuando = {}
    for k, clave in enumerate(["completo", 1, 2, 3]):
        cuando[clave] = max(CUANDO + timedelta(days=dias[clave]), minimo) + timedelta(minutes=k if MODO == "ahora" else 0)
    programados = 0
    videos = [(id_comp, p["titulo_completo"], descs["completo"], "completo"), (ids[1], p["titulo_b1"], descs[1], 1),
              (ids[2], p["titulo_b2"], descs[2], 2), (ids[3], p["titulo_b3"], descs[3], 3)]
    for vid, titulo, desc, clave in videos:
        if not titulo:
            raise RuntimeError("Faltan títulos en la tarjeta del programa")
        actual = yt.videos().list(part="status", id=vid).execute()["items"][0]["status"]
        cuerpo = {"id": vid, "snippet": {"title": titulo[:100], "description": desc, "categoryId": "17",
                                         "defaultLanguage": "es", "defaultAudioLanguage": "es"}}
        partes = "snippet"
        if actual["privacyStatus"] != "public":
            cuerpo["status"] = {"privacyStatus": "private", "publishAt": cuando[clave].strftime("%Y-%m-%dT%H:%M:%SZ"),
                                "selfDeclaredMadeForKids": False, "embeddable": True}
            partes = "snippet,status"
            programados += 1
        yt.videos().update(part=partes, body=cuerpo).execute()
    DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]
    agenda = ", ".join(f"{'completo' if c == 'completo' else 'B' + str(c)} {DIAS[t.astimezone(UY).weekday()]} {t.astimezone(UY):%d/%m %H:%M}"
                       for c, t in cuando.items())
    log(f"Títulos y descripciones cargados. Agenda: {agenda}")
    vinculadas = rpc("pub_vincular_notas", p_programa=PROG_ID)
    if vinculadas:
        log(f"{vinculadas} nota(s) recibieron el link de su bloque")

    # 4. Lista de la temporada, cada uno en su lugar (una sola lectura: YouTube tarda en reflejar cada inserción)
    items, tok = [], None
    while True:
        r = yt.playlistItems().list(part="snippet,contentDetails", playlistId=LISTA, maxResults=50, pageToken=tok).execute()
        items += r["items"]
        tok = r.get("nextPageToken")
        if not tok:
            break
    en_lista = [(i["contentDetails"]["videoId"], orden(i["snippet"]["title"])) for i in items]
    for vid, titulo, _, _ in sorted(videos, key=lambda v: orden(v[1]) or (0, 0)):
        if vid in {v for v, _ in en_lista}:
            continue
        pos = sum(1 for _, o in en_lista if o and o < orden(titulo))
        yt.playlistItems().insert(part="snippet", body={"snippet": {"playlistId": LISTA, "position": pos,
                                  "resourceId": {"kind": "youtube#video", "videoId": vid}}}).execute()
        en_lista.insert(pos, (vid, orden(titulo)))
    log("Lista de la temporada actualizada")

    # 5. Aviso a Floppy (solo la revisión del sábado)
    if MODO == "sabado":
        gmail = build("gmail", "v1", credentials=Credentials.from_authorized_user_info(json.loads(os.environ["GMAIL_TOKEN"])))
        mail_floppy(gmail, p, agenda)
        log("Mail a Floppy enviado")

    ya = max(cuando.values()) <= datetime.now(timezone.utc) + timedelta(minutes=6)
    if not programados:
        estado, detalle = "publicada", f"Textos y capítulos actualizados en YouTube ({datetime.now(UY):%d/%m %H:%M})."
    elif ya:
        estado, detalle = "publicada", f"Publicado: {agenda}."
    else:
        estado, detalle = "programada", f"Programado en YouTube: {agenda}."
    avisar(pub_estado=estado, pub_progreso=100, yt=True, etapa=4 if estado == "publicada" else p["etapa"],
           pub_detalle=detalle + (" Mail enviado a Floppy." if MODO == "sabado" else "")
           + " Falta asignar el completo como video relacionado de cada bloque (en Studio).")
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
