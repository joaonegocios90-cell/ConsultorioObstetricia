"""
Backup automático do banco de dados (obstetricia.db).

Cria uma cópia consistente do banco — segura mesmo com o sistema em uso,
graças ao mecanismo de backup nativo do SQLite (não é uma simples cópia de
arquivo, que poderia corromper dados se alguém estivesse gravando no banco
no mesmo instante) — compacta em .zip e envia por e-mail para os endereços
configurados.

Este script roda uma vez e termina (não fica em execução contínua). Ele foi
pensado para ser agendado 1x por dia:

  VPS (cron do Linux), todo dia às 3h da manhã:
      0 3 * * * cd /caminho/para/backend && /usr/bin/python3 backup.py >> backup.log 2>&1

  Render: criar um serviço do tipo "Cron Job" separado, apontando para este
  mesmo repositório, comando `python3 backend/backup.py`, agendado por
  exemplo com a expressão cron `0 3 * * *`. Use as mesmas variáveis de
  ambiente (GMAIL_USER, GMAIL_APP_PASSWORD) já configuradas no serviço web.

Executar manualmente a qualquer momento (por exemplo, antes de uma
atualização do sistema):
    python3 backup.py

Configuração (variáveis de ambiente — reaproveita as mesmas do server.py):
  GMAIL_USER, GMAIL_APP_PASSWORD  -> conta que envia o backup por e-mail
  BACKUP_DESTINATARIOS            -> e-mails que recebem o backup, separados
                                      por vírgula (padrão: o próprio GMAIL_USER)

Se o e-mail não estiver configurado, o backup ainda é gerado e guardado
localmente na pasta backend/backups/ — só não é enviado.

IMPORTANTE: este script só se aplica ao modo SQLite (sem DATABASE_URL). Se o
sistema estiver configurado para usar Postgres/Supabase (DATABASE_URL
definido), este script não roda — nesse caso, o backup é responsabilidade do
próprio Supabase (backup diário automático no plano Pro; no plano gratuito,
não há backup automático e o projeto pausa após 7 dias sem uso).
"""
import os
import smtplib
import sqlite3
import ssl
import zipfile
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from server import DB_PATH, GMAIL_USER, GMAIL_APP_PASSWORD, CLINICA_NOME, USE_POSTGRES

BACKUP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backups")
DESTINATARIOS = [e.strip() for e in os.environ.get("BACKUP_DESTINATARIOS", GMAIL_USER or "").split(",") if e.strip()]
MANTER_DIAS = int(os.environ.get("BACKUP_MANTER_DIAS", "14"))


def criar_backup():
    """Gera uma cópia .zip consistente do banco atual usando a API de backup
    nativa do SQLite (conn.backup) — segura para rodar com o servidor no ar."""
    if not os.path.exists(DB_PATH):
        raise FileNotFoundError(f"Banco não encontrado em {DB_PATH}. O sistema já foi executado ao menos uma vez?")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    carimbo = datetime.now().strftime("%Y-%m-%d_%H%M")
    destino_db = os.path.join(BACKUP_DIR, f"obstetricia_{carimbo}.db")

    origem = sqlite3.connect(DB_PATH)
    copia = sqlite3.connect(destino_db)
    with copia:
        origem.backup(copia)
    origem.close()
    copia.close()

    destino_zip = os.path.join(BACKUP_DIR, f"obstetricia_{carimbo}.zip")
    with zipfile.ZipFile(destino_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(destino_db, arcname=os.path.basename(destino_db))
    os.remove(destino_db)
    return destino_zip


def enviar_backup_por_email(caminho_zip):
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print(f"[backup] GMAIL_USER/GMAIL_APP_PASSWORD não configurados — backup salvo apenas localmente em: {caminho_zip}")
        return False
    if not DESTINATARIOS:
        print(f"[backup] Nenhum destinatário configurado (BACKUP_DESTINATARIOS) — backup salvo apenas localmente em: {caminho_zip}")
        return False

    hoje = datetime.now().strftime("%d/%m/%Y")
    tamanho_mb = os.path.getsize(caminho_zip) / (1024 * 1024)
    msg = MIMEMultipart()
    msg["Subject"] = f"Backup diário — {CLINICA_NOME} ({hoje})"
    msg["From"] = GMAIL_USER
    msg["To"] = ", ".join(DESTINATARIOS)
    msg.attach(MIMEText(
        f"Backup automático do banco de dados do sistema, gerado em {hoje} ({tamanho_mb:.2f} MB).\n\n"
        "Guarde este e-mail em um local seguro. Ele contém dados de pacientes "
        "(dado sensível pela LGPD) — não encaminhe para fora da equipe autorizada do consultório.",
        "plain", "utf-8",
    ))
    with open(caminho_zip, "rb") as f:
        parte = MIMEApplication(f.read(), Name=os.path.basename(caminho_zip))
    parte["Content-Disposition"] = f'attachment; filename="{os.path.basename(caminho_zip)}"'
    msg.attach(parte)

    context = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, DESTINATARIOS, msg.as_string())
    return True


def limpar_backups_antigos(dias=MANTER_DIAS):
    """Remove backups locais com mais de N dias, para não acumular disco
    indefinidamente (o histórico "de verdade" fica nos e-mails enviados)."""
    if not os.path.isdir(BACKUP_DIR):
        return
    agora = datetime.now().timestamp()
    for nome in os.listdir(BACKUP_DIR):
        caminho = os.path.join(BACKUP_DIR, nome)
        if os.path.isfile(caminho) and (agora - os.path.getmtime(caminho)) > dias * 86400:
            os.remove(caminho)


def main():
    if USE_POSTGRES:
        print(
            "[backup] DATABASE_URL está definido (modo Postgres/Supabase) — este "
            "script só sabe fazer backup de SQLite, então não há nada a fazer aqui. "
            "No Supabase, ative o plano Pro para ter backup diário automático, ou "
            "configure backups pelo próprio painel do Supabase."
        )
        return
    caminho_zip = criar_backup()
    print(f"[backup] Backup criado: {caminho_zip}")
    if enviar_backup_por_email(caminho_zip):
        print(f"[backup] Enviado por e-mail para: {', '.join(DESTINATARIOS)}")
    limpar_backups_antigos()
    print("[backup] Concluído.")


if __name__ == "__main__":
    main()
