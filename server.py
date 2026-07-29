"""
Sistema de Consultorio Obstetrico - Backend
Protótipo navegável - API REST em Python puro.

Por padrão usa SQLite (zero dependências externas). Se a variável de
ambiente DATABASE_URL estiver definida (ex: connection string do Supabase),
usa Postgres em vez disso — nesse caso é necessário `pip install
psycopg2-binary`. Ver README.md, seção "Onde hospedar".

Executar:
    python3 server.py
Servidor sobe em http://localhost:8000
"""

import calendar
import json
import re
import secrets
import smtplib
import ssl
import sqlite3
import urllib.request
import urllib.error
from email.mime.text import MIMEText
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import os

# Por padrão o banco é um arquivo SQLite na pasta do projeto — funciona sem
# nenhuma dependência externa, ótimo para rodar localmente ou numa VPS com
# disco persistente (defina DB_PATH para apontar pro disco montado, ex:
# DB_PATH=/var/data/obstetricia.db).
#
# Se a variável de ambiente DATABASE_URL estiver definida (connection string
# de um banco Postgres — por exemplo, do Supabase), o sistema usa Postgres em
# vez de SQLite automaticamente. Nesse caso é necessário ter o pacote
# psycopg2-binary instalado (pip install psycopg2-binary).
DB_PATH = os.environ.get("DB_PATH") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "obstetricia.db")
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_POSTGRES = bool(DATABASE_URL)

if USE_POSTGRES:
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as e:
        raise SystemExit(
            "DATABASE_URL foi definido (modo Postgres/Supabase), mas o pacote "
            "'psycopg2-binary' não está instalado nesse ambiente. Rode:\n"
            "    pip install psycopg2-binary\n"
            "e tente novamente. Sem DATABASE_URL definido, o sistema usa SQLite "
            "normalmente (sem precisar dessa biblioteca)."
        ) from e

# Painel padrao de exames laboratoriais de pre-natal usado na "Solicitacao de
# Exames" imprimivel, no mesmo formato/itens do impresso que a clinica ja usa.
PAINEL_EXAMES_PRENATAL = [
    "ABO-RH", "Glicemia de jejum", "Sífilis", "VDRL", "HIV", "Hepatite B - HBsAg",
    "Toxoplasmose", "Hemograma completo", "Ferretina", "Urina - Cultura",
    "Urina - EAS", "Coombs indireto", "Hemoglobina/Hematócrito",
    "Anti-HCV (Hepatite C)", "Rubéola IgG e IgM", "TSH",
]

# --------------------------------------------------------------------------
# Configuracao (variaveis de ambiente - preencha para ativar envio real)
# --------------------------------------------------------------------------
# E-mail via Gmail SMTP:
#   1. Ative a verificacao em duas etapas na sua conta Google.
#   2. Gere uma "senha de app" em https://myaccount.google.com/apppasswords
#   3. Defina as variaveis abaixo antes de rodar o servidor, por exemplo:
#      set GMAIL_USER=seuemail@gmail.com          (Windows cmd)
#      set GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
# Sem essas variaveis configuradas, os e-mails NAO sao enviados de verdade -
# ficam apenas registrados na tabela emails_log (visivel pela API) para voce
# ver o conteudo que seria enviado.
GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")

# Mercado Pago (pagamento de consultas/exames):
#   1. Crie uma conta em https://www.mercadopago.com.br
#   2. Va em Seu negocio > Configuracoes > Credenciais
#   3. Copie o "Access Token" (use o de TESTE primeiro, depois o de producao)
#      set MERCADOPAGO_ACCESS_TOKEN=TEST-xxxxxxxx...
MERCADOPAGO_ACCESS_TOKEN = os.environ.get("MERCADOPAGO_ACCESS_TOKEN", "")

# URL publica do backend/frontend, usada nos links dos e-mails e no retorno do
# checkout do Mercado Pago. Em producao, troque para o dominio real.
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5500")

# Dados do consultorio, usados nos e-mails de confirmacao e nos documentos
# imprimiveis (ficha, solicitacao de exames, orientacoes). Dados reais do
# consultorio da cliente (Enfermeira Obstetra Graziela Freitas).
CLINICA_NOME = os.environ.get("CLINICA_NOME", "Consultório Obstétrico")
CLINICA_PROFISSIONAL = os.environ.get("CLINICA_PROFISSIONAL", "Graziela Freitas Silva de Oliveira")
CLINICA_CARGO = os.environ.get("CLINICA_CARGO", "Enfermeira Obstetra")
CLINICA_COREN = os.environ.get("CLINICA_COREN", "COREN 99202")
CLINICA_ENDERECO = os.environ.get("CLINICA_ENDERECO", "Av. Nossa Senhora Aparecida, 34 - Juquitiba/SP - CEP 06950-000")
CLINICA_TELEFONE = os.environ.get("CLINICA_TELEFONE", "(11) 93201-7000")
CLINICA_INSTAGRAM = os.environ.get("CLINICA_INSTAGRAM", "@grazielafreitas.enfobstetra")

# --------------------------------------------------------------------------
# Banco de dados
# --------------------------------------------------------------------------

SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS gestantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    data_nascimento TEXT,
    cpf TEXT,
    telefone TEXT,
    endereco TEXT,
    convenio TEXT,
    tipo_sanguineo TEXT,
    num_gestacoes INTEGER DEFAULT 0,
    num_partos_normais INTEGER DEFAULT 0,
    num_cesareas INTEGER DEFAULT 0,
    num_abortos INTEGER DEFAULT 0,
    alergias TEXT,
    doencas_preexistentes TEXT,
    medicamentos_uso TEXT,
    dum TEXT,
    condicoes_risco TEXT DEFAULT '[]',
    status TEXT DEFAULT 'gestante',
    criado_em TEXT,
    antecedentes_clinicos TEXT,
    antecedentes_cirurgicos TEXT,
    antecedentes_familiares TEXT,
    habitos TEXT,
    anamnese TEXT,
    email TEXT,
    email_verificado INTEGER DEFAULT 0,
    email_verify_token TEXT,
    estado_civil TEXT,
    profissao TEXT,
    pessoa_referencia TEXT,
    telefone_referencia TEXT,
    altura REAL,
    filhos_vivos INTEGER DEFAULT 0,
    avaliacao_inicial TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS prenatal_consultas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    data TEXT,
    peso REAL,
    altura_uterina REAL,
    pressao_arterial TEXT,
    imc REAL,
    bcf INTEGER,
    fc REAL,
    fr REAL,
    temperatura REAL,
    movimentos_fetais TEXT,
    edema TEXT,
    queixas TEXT,
    exame_fisico TEXT,
    hma TEXT,
    evolucao_clinica TEXT,
    hipotese_diagnostica TEXT,
    conduta TEXT,
    prescricao TEXT,
    exames_solicitados TEXT,
    orientacoes TEXT,
    retorno TEXT,
    profissional TEXT,
    tipo_atendimento TEXT DEFAULT 'Atendimento',
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS exames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    tipo TEXT,
    data TEXT,
    horario TEXT,
    resultado TEXT,
    status TEXT DEFAULT 'pendente',
    arquivo TEXT,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS solicitacoes_exames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    data TEXT,
    itens TEXT DEFAULT '[]',
    observacoes TEXT,
    profissional TEXT,
    criado_em TEXT,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS ultrassons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    data TEXT,
    idade_gestacional TEXT,
    peso_fetal REAL,
    sexo TEXT,
    placenta TEXT,
    liquido_amniotico TEXT,
    bcf INTEGER,
    comprimento REAL,
    circunferencia_cefalica REAL,
    percentil TEXT,
    observacoes TEXT,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS vacinas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    tipo TEXT,
    dose TEXT,
    data_aplicacao TEXT,
    status TEXT DEFAULT 'pendente',
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS agenda_eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER,
    tipo TEXT,
    data_hora TEXT,
    status TEXT DEFAULT 'agendado',
    observacoes TEXT,
    valor REAL,
    status_pagamento TEXT DEFAULT 'nao_aplicavel',
    payment_id TEXT,
    checkout_url TEXT,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS emails_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destinatario TEXT,
    assunto TEXT,
    tipo TEXT,
    corpo TEXT,
    enviado_de_verdade INTEGER DEFAULT 0,
    criado_em TEXT
);

CREATE TABLE IF NOT EXISTS partos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    tipo TEXT,
    data TEXT,
    hora TEXT,
    medico TEXT,
    equipe TEXT,
    complicacoes TEXT,
    idade_gestacional_semanas INTEGER,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);

CREATE TABLE IF NOT EXISTS recem_nascidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parto_id INTEGER NOT NULL,
    nome TEXT,
    sexo TEXT,
    peso REAL,
    altura REAL,
    perimetro_cefalico REAL,
    apgar1 INTEGER,
    apgar5 INTEGER,
    vitamina_k TEXT,
    teste_pezinho TEXT,
    teste_orelhinha TEXT,
    teste_coracaozinho TEXT,
    FOREIGN KEY (parto_id) REFERENCES partos(id)
);

CREATE TABLE IF NOT EXISTS puerperios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gestante_id INTEGER NOT NULL,
    data TEXT,
    amamentacao TEXT,
    cicatrizacao TEXT,
    pressao TEXT,
    sangramento TEXT,
    humor TEXT,
    consulta_retorno TEXT,
    FOREIGN KEY (gestante_id) REFERENCES gestantes(id)
);
"""

# Postgres não entende "INTEGER PRIMARY KEY AUTOINCREMENT" (é sintaxe do
# SQLite) — o equivalente é "SERIAL PRIMARY KEY". Fora essa troca, o resto do
# schema (TEXT, REAL, DEFAULT, FOREIGN KEY) é SQL padrão e funciona igual nos
# dois bancos, então geramos a versão Postgres a partir da mesma fonte em vez
# de manter dois schemas duplicados.
SCHEMA_POSTGRES = SCHEMA_SQLITE.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")

SCHEMA = SCHEMA_POSTGRES if USE_POSTGRES else SCHEMA_SQLITE


class _PGConn:
    """Camada fina sobre a conexão do psycopg2 para que o resto do código
    (que usa conn.execute(...) direto, no estilo sqlite3) funcione sem
    precisar saber se está falando com SQLite ou Postgres. Também traduz o
    placeholder "?" (estilo SQLite) para "%s" (estilo psycopg2)."""

    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        cur = self._raw.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            cur.execute(sql.replace("?", "%s"), params)
        except Exception:
            self._raw.rollback()
            raise
        return cur

    def executescript(self, sql):
        cur = self._raw.cursor()
        cur.execute(sql)
        return cur

    def commit(self):
        self._raw.commit()

    def rollback(self):
        self._raw.rollback()

    def close(self):
        self._raw.close()

    def cursor(self):
        """Suporte ao padrão `cur = conn.cursor(); cur.execute(...)` (usado
        pelo seed.py), além do `conn.execute(...)` direto usado no resto do
        código."""
        return _PGCursor(self._raw.cursor(cursor_factory=psycopg2.extras.RealDictCursor))


class _PGCursor:
    def __init__(self, raw):
        self._raw = raw

    def execute(self, sql, params=()):
        self._raw.execute(sql.replace("?", "%s"), params)
        return self

    def fetchone(self):
        return self._raw.fetchone()

    def fetchall(self):
        return self._raw.fetchall()


def get_db():
    if USE_POSTGRES:
        raw = psycopg2.connect(DATABASE_URL)
        return _PGConn(raw)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# Colunas adicionadas depois da criacao inicial do banco. "CREATE TABLE IF NOT
# EXISTS" nao altera tabelas ja existentes, entao qualquer coluna nova
# precisa entrar aqui tambem para bancos criados com uma versao anterior do
# schema continuarem funcionando sem precisar apagar o banco. A sintaxe do
# ALTER TABLE ADD COLUMN abaixo funciona igual em SQLite e Postgres.
MIGRACOES = [
    ("gestantes", "estado_civil", "TEXT"),
    ("gestantes", "profissao", "TEXT"),
    ("gestantes", "pessoa_referencia", "TEXT"),
    ("gestantes", "telefone_referencia", "TEXT"),
    ("gestantes", "altura", "REAL"),
    ("gestantes", "filhos_vivos", "INTEGER DEFAULT 0"),
    ("gestantes", "avaliacao_inicial", "TEXT DEFAULT '{}'"),
    ("prenatal_consultas", "fc", "REAL"),
    ("prenatal_consultas", "fr", "REAL"),
    ("prenatal_consultas", "temperatura", "REAL"),
    ("exames", "horario", "TEXT"),
]


def init_db():
    conn = get_db()
    conn.executescript(SCHEMA)
    conn.commit()
    for tabela, coluna, tipo in MIGRACOES:
        try:
            conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
            conn.commit()
        except Exception:
            # coluna ja existe — no Postgres a transacao fica "abortada" ate
            # o rollback, entao precisa disso antes de tentar a proxima.
            conn.rollback()
    conn.close()


# --------------------------------------------------------------------------
# Regras obstétricas (Naegele) e utilitários
# --------------------------------------------------------------------------

def calc_dpp(dum_str):
    if not dum_str:
        return None
    try:
        dum = datetime.strptime(dum_str, "%Y-%m-%d")
    except ValueError:
        return None
    dpp = dum + timedelta(days=280)
    return dpp.strftime("%Y-%m-%d")


def calc_idade_gestacional(dum_str, ref_date=None):
    if not dum_str:
        return None
    try:
        dum = datetime.strptime(dum_str, "%Y-%m-%d")
    except ValueError:
        return None
    ref = ref_date or datetime.now()
    dias = (ref - dum).days
    if dias < 0:
        return None
    semanas = dias // 7
    resto = dias % 7
    return {"semanas": semanas, "dias": resto, "texto": f"{semanas}s{resto}d", "dias_totais": dias}


def calc_idade(data_nascimento_str, ref_date=None):
    if not data_nascimento_str:
        return None
    try:
        nasc = datetime.strptime(data_nascimento_str, "%Y-%m-%d")
    except ValueError:
        return None
    ref = ref_date or datetime.now()
    if nasc > ref:
        return None
    anos = ref.year - nasc.year
    meses = ref.month - nasc.month
    dias = ref.day - nasc.day
    if dias < 0:
        meses -= 1
        prev_month = ref.month - 1 or 12
        prev_year = ref.year if ref.month > 1 else ref.year - 1
        dias += calendar.monthrange(prev_year, prev_month)[1]
    if meses < 0:
        anos -= 1
        meses += 12
    texto = f"{anos} anos, {meses} meses, {dias} dias"
    return {"anos": anos, "meses": meses, "dias": dias, "texto": texto}


def calc_imc(peso, altura_m):
    try:
        if peso and altura_m:
            return round(float(peso) / (float(altura_m) ** 2), 1)
    except (ValueError, ZeroDivisionError):
        pass
    return None


def enrich_gestante(g):
    g = dict(g)
    g["dpp"] = calc_dpp(g.get("dum"))
    ig = calc_idade_gestacional(g.get("dum"))
    g["idade_gestacional"] = ig
    g["idade"] = calc_idade(g.get("data_nascimento"))
    try:
        g["condicoes_risco"] = json.loads(g.get("condicoes_risco") or "[]")
    except (json.JSONDecodeError, TypeError):
        g["condicoes_risco"] = []
    g["alto_risco"] = len(g["condicoes_risco"]) > 0
    try:
        g["avaliacao_inicial"] = json.loads(g.get("avaliacao_inicial") or "{}")
    except (json.JSONDecodeError, TypeError):
        g["avaliacao_inicial"] = {}
    return g


# --------------------------------------------------------------------------
# E-mail (Gmail SMTP, com log de fallback quando nao configurado)
# --------------------------------------------------------------------------

def _log_email(destinatario, assunto, tipo, corpo, enviado):
    conn = get_db()
    conn.execute(
        "INSERT INTO emails_log (destinatario, assunto, tipo, corpo, enviado_de_verdade, criado_em) VALUES (?,?,?,?,?,?)",
        (destinatario, assunto, tipo, corpo, 1 if enviado else 0, datetime.now().isoformat()),
    )
    conn.commit()
    conn.close()


def send_email(destinatario, assunto, corpo_html, tipo="geral"):
    """Envia um e-mail via Gmail SMTP se GMAIL_USER/GMAIL_APP_PASSWORD estiverem
    configurados. Caso contrario, apenas registra o e-mail em emails_log para
    que o conteudo fique visivel no sistema (modo demonstracao)."""
    if not destinatario:
        return False
    enviado = False
    if GMAIL_USER and GMAIL_APP_PASSWORD:
        try:
            msg = MIMEText(corpo_html, "html", "utf-8")
            msg["Subject"] = assunto
            msg["From"] = GMAIL_USER
            msg["To"] = destinatario
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=context) as server:
                server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
                server.sendmail(GMAIL_USER, [destinatario], msg.as_string())
            enviado = True
        except Exception as e:  # noqa
            print(f"[email] Falha ao enviar para {destinatario}: {e}")
            enviado = False
    else:
        print(f"[email] (modo demo, sem GMAIL_USER/GMAIL_APP_PASSWORD configurados) "
              f"Seria enviado para {destinatario}: {assunto}")
    _log_email(destinatario, assunto, tipo, corpo_html, enviado)
    return enviado


def _tpl_rodape():
    return f"""
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0 12px;">
    <p style="font-size:12px;color:#888;margin:2px 0;"><b>{CLINICA_NOME}</b></p>
    <p style="font-size:12px;color:#888;margin:2px 0;">{CLINICA_ENDERECO}</p>
    <p style="font-size:12px;color:#888;margin:2px 0;">Telefone/WhatsApp: {CLINICA_TELEFONE}</p>
    """


def tpl_verificacao(nome, token):
    link = f"{BASE_URL}/api/verificar-email?token={token}"
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#c2185b;">Bem-vinda, {nome}!</h2>
      <p>Seu cadastro no consultório <b>{CLINICA_NOME}</b> foi realizado com sucesso. Para confirmar seu e-mail, clique no botão abaixo:</p>
      <p><a href="{link}" style="background:#c2185b;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar meu e-mail</a></p>
      <p style="font-size:12px;color:#888;">Se o botão não funcionar, copie e cole este link no navegador:<br>{link}</p>
      <p style="font-size:12px;color:#888;">Se você não reconhece este cadastro, ignore este e-mail.</p>
      {_tpl_rodape()}
    </div>
    """


def tpl_evento_marcado(nome, tipo_evento, data_hora, observacoes, valor=None, status_pagamento=None, endereco=None):
    endereco_fmt = endereco or CLINICA_ENDERECO
    valor_fmt = f"R$ {valor:.2f}".replace(".", ",") if valor else None
    if valor_fmt:
        if status_pagamento == "pago":
            pagamento_html = f'<p><b>Pagamento:</b> <span style="color:#2e7d32;">✅ Pagamento confirmado ({valor_fmt})</span></p>'
        else:
            pagamento_html = f'<p><b>Valor:</b> {valor_fmt} &mdash; <span style="color:#e65100;">pagamento pendente</span></p>'
    else:
        pagamento_html = ""
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#00796b;">{tipo_evento.capitalize()} agendado(a) ✓</h2>
      <p>Olá, {nome}. Seu(sua) {tipo_evento} foi agendado(a) com sucesso. Confira os dados abaixo:</p>
      <p><b>Data:</b> {fmtar_data_hora(data_hora)}</p>
      <p><b>Local:</b> {endereco_fmt}</p>
      {pagamento_html}
      {f"<p><b>Observações:</b> {observacoes}</p>" if observacoes else ""}
      <p>Qualquer dúvida ou necessidade de remarcação, entre em contato com o consultório.</p>
      {_tpl_rodape()}
    </div>
    """


def tpl_pagamento_confirmado(nome, tipo_evento, valor, data_hora, endereco=None):
    endereco_fmt = endereco or CLINICA_ENDERECO
    valor_fmt = f"R$ {valor:.2f}".replace(".", ",") if valor else "—"
    return f"""
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#2e7d32;">Pagamento confirmado ✅</h2>
      <p>Olá, {nome}. Recebemos o pagamento referente ao(à) seu(sua) {tipo_evento}:</p>
      <p><b>Data:</b> {fmtar_data_hora(data_hora)}</p>
      <p><b>Local:</b> {endereco_fmt}</p>
      <p><b>Valor pago:</b> {valor_fmt}</p>
      <p>Obrigado(a) pela confiança!</p>
      {_tpl_rodape()}
    </div>
    """


def fmtar_data_hora(data_hora):
    if not data_hora:
        return "—"
    try:
        dt = datetime.fromisoformat(data_hora)
        return dt.strftime("%d/%m/%Y às %H:%M")
    except ValueError:
        return data_hora


# --------------------------------------------------------------------------
# Mercado Pago (checkout de pagamento de consultas/exames)
# --------------------------------------------------------------------------

def mp_criar_preferencia(titulo, valor, evento_id, email_pagador=None):
    """Cria uma preferencia de pagamento no Mercado Pago e retorna o link de
    checkout (init_point). Requer MERCADOPAGO_ACCESS_TOKEN configurado."""
    if not MERCADOPAGO_ACCESS_TOKEN:
        raise RuntimeError(
            "MERCADOPAGO_ACCESS_TOKEN nao configurado. Defina essa variavel de "
            "ambiente com o Access Token da sua conta Mercado Pago para ativar pagamentos."
        )
    payload = {
        "items": [{
            "title": titulo,
            "quantity": 1,
            "currency_id": "BRL",
            "unit_price": float(valor),
        }],
        "back_urls": {
            "success": f"{FRONTEND_URL}/?pagamento=sucesso",
            "failure": f"{FRONTEND_URL}/?pagamento=falha",
            "pending": f"{FRONTEND_URL}/?pagamento=pendente",
        },
        "auto_return": "approved",
        "external_reference": str(evento_id),
        "notification_url": f"{BASE_URL}/api/pagamentos/webhook",
    }
    if email_pagador:
        payload["payer"] = {"email": email_pagador}

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.mercadopago.com/checkout/preferences",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MERCADOPAGO_ACCESS_TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detalhe = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Mercado Pago recusou a requisicao: {detalhe}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Nao foi possivel conectar ao Mercado Pago: {e}")
    return data.get("init_point"), data.get("id")


def mp_consultar_pagamento(payment_id):
    req = urllib.request.Request(
        f"https://api.mercadopago.com/v1/payments/{payment_id}",
        method="GET",
        headers={"Authorization": f"Bearer {MERCADOPAGO_ACCESS_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


# --------------------------------------------------------------------------
# Roteador HTTP
# --------------------------------------------------------------------------

ROUTES = []
HTML_ROUTES = []


def route(method, pattern):
    regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")

    def decorator(fn):
        ROUTES.append((method, regex, fn))
        return fn

    return decorator


def route_html(method, pattern):
    """Rotas que retornam uma pagina HTML pronta para impressao (em vez de
    JSON) - usadas para a Ficha da gestante, Solicitacao de exames e
    Orientacoes de Papanicolau."""
    regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")

    def decorator(fn):
        HTML_ROUTES.append((method, regex, fn))
        return fn

    return decorator


# ---- Gestantes -------------------------------------------------------------

@route("GET", "/api/gestantes")
def list_gestantes(handler, params, body, query):
    conn = get_db()
    rows = conn.execute("SELECT * FROM gestantes ORDER BY criado_em DESC").fetchall()
    conn.close()
    return 200, [enrich_gestante(r) for r in rows]


def _criar_gestante(conn, body, enviar_verificacao=True):
    """Insere uma nova gestante usando uma conexao ja aberta e, se tiver
    e-mail, dispara o e-mail de verificacao de cadastro. Retorna a linha
    recem-criada (como um dict). Nao fecha a conexao (quem chamou decide)."""
    email = body.get("email")
    verify_token = secrets.token_urlsafe(24) if email else None
    cur = conn.execute(
        """INSERT INTO gestantes
        (nome, data_nascimento, cpf, telefone, endereco, convenio, tipo_sanguineo,
         num_gestacoes, num_partos_normais, num_cesareas, num_abortos,
         alergias, doencas_preexistentes, medicamentos_uso, dum, condicoes_risco,
         status, criado_em, email, email_verificado, email_verify_token,
         estado_civil, profissao, pessoa_referencia, telefone_referencia, altura,
         filhos_vivos, avaliacao_inicial)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id""",
        (
            body.get("nome"),
            body.get("data_nascimento"),
            body.get("cpf"),
            body.get("telefone"),
            body.get("endereco"),
            body.get("convenio"),
            body.get("tipo_sanguineo"),
            body.get("num_gestacoes", 0),
            body.get("num_partos_normais", 0),
            body.get("num_cesareas", 0),
            body.get("num_abortos", 0),
            body.get("alergias"),
            body.get("doencas_preexistentes"),
            body.get("medicamentos_uso"),
            body.get("dum"),
            json.dumps(body.get("condicoes_risco", [])),
            body.get("status", "gestante"),
            datetime.now().isoformat(),
            email,
            0,
            verify_token,
            body.get("estado_civil"),
            body.get("profissao"),
            body.get("pessoa_referencia"),
            body.get("telefone_referencia"),
            body.get("altura"),
            body.get("filhos_vivos", 0),
            json.dumps(body.get("avaliacao_inicial", {})),
        ),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    row = conn.execute("SELECT * FROM gestantes WHERE id=?", (new_id,)).fetchone()
    if email and enviar_verificacao:
        send_email(email, "Confirme seu cadastro", tpl_verificacao(body.get("nome", ""), verify_token), tipo="verificacao")
    return row


@route("POST", "/api/gestantes")
def create_gestante(handler, params, body, query):
    conn = get_db()
    row = _criar_gestante(conn, body)
    conn.close()
    return 201, enrich_gestante(row)


@route("GET", "/api/verificar-email")
def verificar_email(handler, params, body, query):
    token = (query.get("token") or [None])[0]
    if not token:
        return 400, {"erro": "Token ausente"}
    conn = get_db()
    row = conn.execute("SELECT * FROM gestantes WHERE email_verify_token=?", (token,)).fetchone()
    if not row:
        conn.close()
        return 404, {"erro": "Token invalido ou ja utilizado"}
    conn.execute("UPDATE gestantes SET email_verificado=1 WHERE id=?", (row["id"],))
    conn.commit()
    conn.close()
    return 200, {"ok": True, "mensagem": "E-mail confirmado com sucesso!"}


@route("GET", "/api/emails-log")
def list_emails_log(handler, params, body, query):
    conn = get_db()
    rows = conn.execute("SELECT * FROM emails_log ORDER BY criado_em DESC LIMIT 100").fetchall()
    conn.close()
    return 200, [dict(r) for r in rows]


@route("GET", "/api/gestantes/{id}")
def get_gestante(handler, params, body, query):
    conn = get_db()
    gid = params["id"]
    g = conn.execute("SELECT * FROM gestantes WHERE id=?", (gid,)).fetchone()
    if not g:
        conn.close()
        return 404, {"erro": "Gestante não encontrada"}
    data = enrich_gestante(g)
    data["prenatal"] = [dict(r) for r in conn.execute(
        "SELECT * FROM prenatal_consultas WHERE gestante_id=? ORDER BY data DESC", (gid,))]
    data["exames"] = [dict(r) for r in conn.execute(
        "SELECT * FROM exames WHERE gestante_id=? ORDER BY data DESC", (gid,))]
    data["ultrassons"] = [dict(r) for r in conn.execute(
        "SELECT * FROM ultrassons WHERE gestante_id=? ORDER BY data DESC", (gid,))]
    data["vacinas"] = [dict(r) for r in conn.execute(
        "SELECT * FROM vacinas WHERE gestante_id=? ORDER BY data_aplicacao DESC", (gid,))]
    partos = [dict(r) for r in conn.execute(
        "SELECT * FROM partos WHERE gestante_id=? ORDER BY data DESC", (gid,))]
    for p in partos:
        p["recem_nascidos"] = [dict(r) for r in conn.execute(
            "SELECT * FROM recem_nascidos WHERE parto_id=?", (p["id"],))]
    data["partos"] = partos
    data["puerperios"] = [dict(r) for r in conn.execute(
        "SELECT * FROM puerperios WHERE gestante_id=? ORDER BY data DESC", (gid,))]
    data["agenda"] = [dict(r) for r in conn.execute(
        "SELECT * FROM agenda_eventos WHERE gestante_id=? ORDER BY data_hora", (gid,))]
    data["solicitacoes_exames"] = [dict(r) for r in conn.execute(
        "SELECT * FROM solicitacoes_exames WHERE gestante_id=? ORDER BY criado_em DESC", (gid,))]
    for s in data["solicitacoes_exames"]:
        try:
            s["itens"] = json.loads(s.get("itens") or "[]")
        except (json.JSONDecodeError, TypeError):
            s["itens"] = []
    conn.close()
    return 200, data


@route("PUT", "/api/gestantes/{id}")
def update_gestante(handler, params, body, query):
    conn = get_db()
    gid = params["id"]
    existing = conn.execute("SELECT * FROM gestantes WHERE id=?", (gid,)).fetchone()
    if not existing:
        conn.close()
        return 404, {"erro": "Gestante não encontrada"}
    fields = ["nome", "data_nascimento", "cpf", "telefone", "endereco", "convenio",
              "tipo_sanguineo", "num_gestacoes", "num_partos_normais", "num_cesareas",
              "num_abortos", "alergias", "doencas_preexistentes", "medicamentos_uso",
              "dum", "status", "antecedentes_clinicos", "antecedentes_cirurgicos",
              "antecedentes_familiares", "habitos", "anamnese", "email",
              "estado_civil", "profissao", "pessoa_referencia", "telefone_referencia",
              "altura", "filhos_vivos"]
    updates = {f: body[f] for f in fields if f in body}
    if "condicoes_risco" in body:
        updates["condicoes_risco"] = json.dumps(body["condicoes_risco"])
    if "avaliacao_inicial" in body:
        updates["avaliacao_inicial"] = json.dumps(body["avaliacao_inicial"])
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE gestantes SET {set_clause} WHERE id=?", (*updates.values(), gid))
        conn.commit()
    row = conn.execute("SELECT * FROM gestantes WHERE id=?", (gid,)).fetchone()
    conn.close()
    return 200, enrich_gestante(row)


@route("DELETE", "/api/gestantes/{id}")
def delete_gestante(handler, params, body, query):
    """Exclui a gestante e todo o histórico vinculado (não há ON DELETE
    CASCADE no schema, então apagamos manualmente na ordem certa)."""
    conn = get_db()
    gid = params["id"]
    cur = conn.execute("SELECT id FROM partos WHERE gestante_id=?", (gid,))
    parto_ids = [r["id"] for r in cur.fetchall()]
    for pid in parto_ids:
        conn.execute("DELETE FROM recem_nascidos WHERE parto_id=?", (pid,))
    conn.execute("DELETE FROM partos WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM prenatal_consultas WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM exames WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM solicitacoes_exames WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM ultrassons WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM vacinas WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM agenda_eventos WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM puerperios WHERE gestante_id=?", (gid,))
    conn.execute("DELETE FROM gestantes WHERE id=?", (gid,))
    conn.commit()
    conn.close()
    return 200, {"ok": True}


# ---- Sub-recursos genéricos -------------------------------------------------

def _insert_sub(table, gestante_id, fields, body):
    conn = get_db()
    cols = ["gestante_id"] + fields
    vals = [gestante_id] + [body.get(f) for f in fields]
    placeholders = ",".join("?" * len(cols))
    cur = conn.execute(
        f"INSERT INTO {table} ({','.join(cols)}) VALUES ({placeholders}) RETURNING id", vals)
    new_id = cur.fetchone()["id"]
    conn.commit()
    row = conn.execute(f"SELECT * FROM {table} WHERE id=?", (new_id,)).fetchone()
    conn.close()
    return dict(row)


@route("POST", "/api/gestantes/{id}/prenatal")
def add_prenatal(handler, params, body, query):
    peso = body.get("peso")
    altura_m = body.get("altura_m")
    if peso and altura_m and not body.get("imc"):
        body["imc"] = calc_imc(peso, altura_m)
    data = _insert_sub("prenatal_consultas", params["id"],
                        ["data", "profissional", "tipo_atendimento", "peso", "altura_uterina",
                         "pressao_arterial", "imc", "bcf", "fc", "fr", "temperatura",
                         "movimentos_fetais", "edema", "queixas", "exame_fisico", "hma",
                         "evolucao_clinica", "hipotese_diagnostica", "conduta", "prescricao",
                         "exames_solicitados", "orientacoes", "retorno"], body)
    return 201, data


@route("POST", "/api/gestantes/{id}/exames")
def add_exame(handler, params, body, query):
    data = _insert_sub("exames", params["id"], ["tipo", "data", "horario", "resultado", "status", "arquivo"], body)
    return 201, data


@route("PUT", "/api/exames/{id}")
def update_exame(handler, params, body, query):
    conn = get_db()
    fields = ["tipo", "data", "horario", "resultado", "status", "arquivo"]
    updates = {f: body[f] for f in fields if f in body}
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE exames SET {set_clause} WHERE id=?", (*updates.values(), params["id"]))
        conn.commit()
    row = conn.execute("SELECT * FROM exames WHERE id=?", (params["id"],)).fetchone()
    conn.close()
    if not row:
        return 404, {"erro": "Exame não encontrado"}
    return 200, dict(row)


@route("POST", "/api/gestantes/{id}/ultrassons")
def add_ultrassom(handler, params, body, query):
    data = _insert_sub("ultrassons", params["id"],
                        ["data", "idade_gestacional", "peso_fetal", "sexo", "placenta",
                         "liquido_amniotico", "bcf", "comprimento", "circunferencia_cefalica",
                         "percentil", "observacoes"], body)
    return 201, data


@route("POST", "/api/gestantes/{id}/vacinas")
def add_vacina(handler, params, body, query):
    data = _insert_sub("vacinas", params["id"], ["tipo", "dose", "data_aplicacao", "status"], body)
    return 201, data


@route("PUT", "/api/vacinas/{id}")
def update_vacina(handler, params, body, query):
    conn = get_db()
    fields = ["tipo", "dose", "data_aplicacao", "status"]
    updates = {f: body[f] for f in fields if f in body}
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE vacinas SET {set_clause} WHERE id=?", (*updates.values(), params["id"]))
        conn.commit()
    row = conn.execute("SELECT * FROM vacinas WHERE id=?", (params["id"],)).fetchone()
    conn.close()
    if not row:
        return 404, {"erro": "Vacina não encontrada"}
    return 200, dict(row)


@route("POST", "/api/gestantes/{id}/parto")
def add_parto(handler, params, body, query):
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO partos (gestante_id, tipo, data, hora, medico, equipe, complicacoes,
        idade_gestacional_semanas)
        VALUES (?,?,?,?,?,?,?,?)
        RETURNING id""",
        (params["id"], body.get("tipo"), body.get("data"), body.get("hora"),
         body.get("medico"), body.get("equipe"), body.get("complicacoes"),
         body.get("idade_gestacional_semanas")),
    )
    parto_id = cur.fetchone()["id"]
    rn = body.get("recem_nascido")
    if rn:
        conn.execute(
            """INSERT INTO recem_nascidos
            (parto_id, nome, sexo, peso, altura, perimetro_cefalico, apgar1, apgar5,
             vitamina_k, teste_pezinho, teste_orelhinha, teste_coracaozinho)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (parto_id, rn.get("nome"), rn.get("sexo"), rn.get("peso"), rn.get("altura"),
             rn.get("perimetro_cefalico"), rn.get("apgar1"), rn.get("apgar5"),
             rn.get("vitamina_k"), rn.get("teste_pezinho"), rn.get("teste_orelhinha"),
             rn.get("teste_coracaozinho")),
        )
    conn.execute("UPDATE gestantes SET status='puerperio' WHERE id=?", (params["id"],))
    conn.commit()
    parto = dict(conn.execute("SELECT * FROM partos WHERE id=?", (parto_id,)).fetchone())
    parto["recem_nascidos"] = [dict(r) for r in conn.execute(
        "SELECT * FROM recem_nascidos WHERE parto_id=?", (parto_id,))]
    conn.close()
    return 201, parto


@route("POST", "/api/gestantes/{id}/puerperio")
def add_puerperio(handler, params, body, query):
    data = _insert_sub("puerperios", params["id"],
                        ["data", "amamentacao", "cicatrizacao", "pressao", "sangramento",
                         "humor", "consulta_retorno"], body)
    return 201, data


# ---- Solicitação de exames laboratoriais (painel pré-natal imprimível) -----

@route("POST", "/api/gestantes/{id}/solicitacoes-exames")
def add_solicitacao_exames(handler, params, body, query):
    conn = get_db()
    gestante = conn.execute("SELECT id FROM gestantes WHERE id=?", (params["id"],)).fetchone()
    if not gestante:
        conn.close()
        return 404, {"erro": "Gestante não encontrada"}
    cur = conn.execute(
        """INSERT INTO solicitacoes_exames (gestante_id, data, itens, observacoes, profissional, criado_em)
        VALUES (?,?,?,?,?,?)
        RETURNING id""",
        (params["id"], body.get("data") or datetime.now().strftime("%Y-%m-%d"),
         json.dumps(body.get("itens", [])), body.get("observacoes"),
         body.get("profissional") or CLINICA_PROFISSIONAL, datetime.now().isoformat()),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    row = dict(conn.execute("SELECT * FROM solicitacoes_exames WHERE id=?", (new_id,)).fetchone())
    conn.close()
    row["itens"] = json.loads(row.get("itens") or "[]")
    return 201, row


# ---- Documentos imprimíveis (Ficha, Solicitação de exames, Orientações) ---

ORIENTACOES_PAPANICOLAU = [
    "Não estar menstruada no dia do exame.",
    "Evitar relações sexuais nas últimas 48 horas antes da coleta.",
    "Não utilizar cremes, pomadas, óvulos ou medicamentos vaginais nas últimas 48 horas.",
    "Não realizar duchas vaginais nas últimas 48 horas.",
    "Se possível, esvazie a bexiga antes do exame para maior conforto.",
]


def _fmt_data_br(d):
    if not d:
        return "___/___/___"
    try:
        dt = datetime.strptime(str(d)[:10], "%Y-%m-%d")
        return dt.strftime("%d/%m/%Y")
    except ValueError:
        return d


def _campo(label, value):
    txt = value if value not in (None, "", "None") else "—"
    return f'<div class="item"><b>{label}:</b> {txt}</div>'


def _print_shell(titulo, corpo_html):
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>{titulo}</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ font-family: Arial, Helvetica, sans-serif; color: #333; max-width: 780px; margin: 24px auto; padding: 0 16px; }}
  .print-toolbar {{ text-align: right; margin-bottom: 12px; }}
  .print-toolbar button {{ background: #c2185b; color: #fff; border: none; padding: 9px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; }}
  .letterhead {{ display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #c2185b; padding-bottom: 12px; margin-bottom: 18px; }}
  .letterhead h1 {{ color: #c2185b; font-size: 22px; margin: 0 0 4px; }}
  .letterhead .prof {{ font-size: 13px; color: #555; }}
  .letterhead .contato {{ text-align: right; font-size: 12px; color: #666; line-height: 1.5; }}
  h2.doc-title {{ text-align: center; font-size: 16px; letter-spacing: 0.5px; text-transform: uppercase; color: #00796b; margin: 6px 0 20px; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 14px; }}
  th, td {{ border: 1px solid #e3d3da; padding: 6px 8px; font-size: 12.5px; text-align: left; }}
  th {{ background: #fdf1f5; color: #c2185b; }}
  .section {{ margin-bottom: 16px; }}
  .section-title {{ font-size: 11.5px; font-weight: 700; color: #c2185b; text-transform: uppercase; margin-bottom: 6px; border-bottom: 1px solid #f2e0e7; padding-bottom: 3px; }}
  .row {{ display: flex; flex-wrap: wrap; gap: 4px 22px; font-size: 13px; margin-bottom: 4px; }}
  .row .item {{ min-width: 150px; }}
  .row .item b {{ color: #555; }}
  .checklist {{ display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; font-size: 12.5px; }}
  .checklist .check {{ display: flex; gap: 6px; align-items: baseline; }}
  .box {{ display: inline-block; width: 12px; height: 12px; border: 1.5px solid #999; margin-right: 4px; vertical-align: middle; }}
  .box.on {{ background: #c2185b; border-color: #c2185b; }}
  .assinatura {{ margin-top: 46px; text-align: center; font-size: 12.5px; }}
  .assinatura .linha {{ border-top: 1px solid #333; width: 320px; margin: 0 auto 4px; }}
  .footer-doc {{ margin-top: 24px; padding-top: 8px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }}
  @media print {{ .print-toolbar {{ display: none; }} body {{ margin: 0; }} }}
</style>
</head>
<body>
  <div class="print-toolbar"><button onclick="window.print()">🖨️ Imprimir</button></div>
  <div class="letterhead">
    <div>
      <h1>{CLINICA_NOME}</h1>
      <div class="prof">{CLINICA_CARGO}<br><b>{CLINICA_PROFISSIONAL}</b> — {CLINICA_COREN}</div>
    </div>
    <div class="contato">{CLINICA_ENDERECO}<br>Tel/WhatsApp: {CLINICA_TELEFONE}<br>{CLINICA_INSTAGRAM}</div>
  </div>
  {corpo_html}
  <div class="footer-doc">Documento gerado pelo sistema NASCER — {CLINICA_NOME}</div>
</body>
</html>"""


@route_html("GET", "/api/gestantes/{id}/ficha/imprimir")
def imprimir_ficha(handler, params, body, query):
    conn = get_db()
    g = conn.execute("SELECT * FROM gestantes WHERE id=?", (params["id"],)).fetchone()
    if not g:
        conn.close()
        return 404, "<h1>Gestante não encontrada</h1>"
    g = enrich_gestante(g)
    consultas = [dict(r) for r in conn.execute(
        "SELECT * FROM prenatal_consultas WHERE gestante_id=? ORDER BY data DESC LIMIT 6", (params["id"],))]
    conn.close()
    av = g.get("avaliacao_inicial") or {}

    def sn(key):
        v = av.get(key)
        return "Sim" if v else ("Não" if v is False else "—")

    def chk(key, label):
        cls = "on" if av.get(key) else ""
        return f'<div class="check"><span class="box {cls}"></span>{label}: {sn(key)}</div>'

    linhas_consulta = "".join(
        f"<tr><td>{_fmt_data_br(c.get('data'))}</td><td>{(c.get('peso') or '—')} kg</td>"
        f"<td>{c.get('pressao_arterial') or '—'}</td><td>{(c.get('altura_uterina') or '—')} cm</td>"
        f"<td>{(c.get('bcf') or '—')} bpm</td><td>{c.get('queixas') or '—'}</td></tr>"
        for c in consultas
    ) or '<tr><td colspan="6" style="text-align:center;color:#999;">Nenhuma consulta registrada ainda.</td></tr>'

    corpo = f"""
    <h2 class="doc-title">Ficha da Gestante</h2>
    <div class="section">
      <div class="section-title">1. Identificação</div>
      <div class="row">
        {_campo("Nome", g.get("nome"))}
        {_campo("Data de nascimento", _fmt_data_br(g.get("data_nascimento")))}
        {_campo("Idade", g["idade"]["texto"] if g.get("idade") else "—")}
        {_campo("Estado civil", g.get("estado_civil"))}
        {_campo("Profissão", g.get("profissao"))}
        {_campo("CPF", g.get("cpf"))}
        {_campo("Telefone/WhatsApp", g.get("telefone"))}
        {_campo("E-mail", g.get("email"))}
        {_campo("Endereço", g.get("endereco"))}
        {_campo("Convênio", g.get("convenio"))}
        {_campo("Pessoa de referência", g.get("pessoa_referencia"))}
        {_campo("Telefone de referência", g.get("telefone_referencia"))}
      </div>
    </div>
    <div class="section">
      <div class="section-title">2. Dados obstétricos</div>
      <div class="row">
        {_campo("Gesta (G)", g.get("num_gestacoes"))}
        {_campo("Partos normais (P)", g.get("num_partos_normais"))}
        {_campo("Cesáreas", g.get("num_cesareas"))}
        {_campo("Abortos (A)", g.get("num_abortos"))}
        {_campo("Filhos vivos", g.get("filhos_vivos"))}
        {_campo("DUM", _fmt_data_br(g.get("dum")))}
        {_campo("DPP (Naegele)", _fmt_data_br(g.get("dpp")))}
        {_campo("Idade gestacional atual", g["idade_gestacional"]["texto"] if g.get("idade_gestacional") else "—")}
        {_campo("Tipo sanguíneo", g.get("tipo_sanguineo"))}
        {_campo("Altura", f"{g['altura']} m" if g.get("altura") else "—")}
      </div>
    </div>
    <div class="section">
      <div class="section-title">3. Histórico ginecológico</div>
      <div class="row">
        {_campo("Menarca", av.get("menarca"))}
        {_campo("Ciclo menstrual", av.get("ciclo_menstrual"))}
        {_campo("Uso de contraceptivos anteriores", av.get("uso_contraceptivos_anteriores"))}
        {_campo("Último preventivo (Papanicolau)", _fmt_data_br(av.get("ultimo_preventivo")) if av.get("ultimo_preventivo") else "—")}
        {_campo("Histórico de ISTs", av.get("historico_ists"))}
        {_campo("Teste de gravidez", av.get("teste_gravidez"))}
      </div>
    </div>
    <div class="section">
      <div class="section-title">4. Antecedentes pessoais e hábitos</div>
      <div class="checklist">
        {chk("hipertensao", "Hipertensão")}
        {chk("diabetes", "Diabetes")}
        {chk("asma", "Asma")}
        {chk("cardiopatias", "Cardiopatias")}
        {chk("doencas_renais", "Doenças renais")}
        {chk("doencas_tireoide", "Doenças da tireoide")}
        {chk("anemia", "Anemia")}
        {chk("tabagista", "Tabagismo")}
        {chk("etilista", "Etilismo")}
        {chk("atividade_fisica", "Atividade física")}
        {chk("sono_tranquilo", "Sono tranquilo")}
        {chk("problema_saude_atual", "Problema de saúde no momento")}
      </div>
      <div class="row" style="margin-top:8px;">
        {_campo("Alergias", g.get("alergias"))}
        {_campo("Cirurgias anteriores", g.get("antecedentes_cirurgicos"))}
        {_campo("Medicamentos em uso", g.get("medicamentos_uso"))}
      </div>
    </div>
    <div class="section">
      <div class="section-title">5. Histórico familiar</div>
      <div class="checklist">
        {chk("hist_fam_gemeos", "Gêmeos na família")}
        {chk("hist_fam_malformacoes", "Malformações congênitas")}
        {chk("hist_fam_doencas_geneticas", "Doenças genéticas")}
      </div>
    </div>
    <div class="section">
      <div class="section-title">6. Gestações anteriores</div>
      <div class="checklist">
        {chk("complicacoes_gestacao_anterior", "Complicações em gestação anterior")}
        {chk("complicacoes_parto_anterior", "Complicações em parto anterior")}
        {chk("aleitamento_anterior", "Aleitamento materno anterior")}
        {chk("hipertensao_gestacional_anterior", "Hipertensão gestacional anterior")}
        {chk("alcool_gestacao_anterior", "Uso de álcool em gestação anterior")}
        {chk("drogas_gestacao_anterior", "Uso de drogas em gestação anterior")}
        {chk("aborto_provocado_anterior", "Aborto provocado anterior")}
      </div>
    </div>
    <div class="section">
      <div class="section-title">7. Controle das consultas</div>
      <table>
        <thead><tr><th>Data</th><th>Peso</th><th>PA</th><th>Alt. uterina</th><th>BCF</th><th>Queixas/Observações</th></tr></thead>
        <tbody>{linhas_consulta}</tbody>
      </table>
    </div>
    <div class="assinatura">
      <div class="linha"></div>
      Assinatura e carimbo — {CLINICA_PROFISSIONAL} ({CLINICA_COREN})
    </div>
    """
    return 200, _print_shell(f"Ficha da Gestante — {g.get('nome')}", corpo)


@route_html("GET", "/api/gestantes/{id}/solicitacoes-exames/{sid}/imprimir")
def imprimir_solicitacao_exames(handler, params, body, query):
    conn = get_db()
    g = conn.execute("SELECT * FROM gestantes WHERE id=?", (params["id"],)).fetchone()
    s = conn.execute("SELECT * FROM solicitacoes_exames WHERE id=? AND gestante_id=?",
                      (params["sid"], params["id"])).fetchone()
    conn.close()
    if not g or not s:
        return 404, "<h1>Solicitação não encontrada</h1>"
    g = enrich_gestante(g)
    s = dict(s)
    itens = json.loads(s.get("itens") or "[]")
    marcados = set(itens)
    pares = [PAINEL_EXAMES_PRENATAL[i:i + 2] for i in range(0, len(PAINEL_EXAMES_PRENATAL), 2)]
    linhas = "".join(
        "<tr>" + "".join(
            f'<td style="width:28px;text-align:center;">{"✓" if item in marcados else ""}</td><td>{item}</td>'
            for item in par
        ) + "</tr>"
        for par in pares
    )
    obs_html = (f'<div class="section"><div class="section-title">Observações</div>'
                f'<div style="font-size:13px;">{s.get("observacoes")}</div></div>') if s.get("observacoes") else ""
    corpo = f"""
    <h2 class="doc-title">Solicitação de Exames Laboratoriais — Pré-natal</h2>
    <div class="row" style="margin-bottom:14px;">
      {_campo("Paciente", g.get("nome"))}
      {_campo("Data de nascimento", _fmt_data_br(g.get("data_nascimento")))}
      {_campo("Data da solicitação", _fmt_data_br(s.get("data")))}
    </div>
    <table>
      <thead><tr><th></th><th>Exame</th><th></th><th>Exame</th></tr></thead>
      <tbody>{linhas}</tbody>
    </table>
    {obs_html}
    <div class="assinatura">
      <div class="linha"></div>
      Assinatura e carimbo do profissional — {s.get("profissional") or CLINICA_PROFISSIONAL}
    </div>
    """
    return 200, _print_shell(f"Solicitação de exames — {g.get('nome')}", corpo)


@route_html("GET", "/api/exames/{id}/papanicolau/imprimir")
def imprimir_orientacoes_papanicolau(handler, params, body, query):
    conn = get_db()
    exame = conn.execute("SELECT * FROM exames WHERE id=?", (params["id"],)).fetchone()
    if not exame:
        conn.close()
        return 404, "<h1>Exame não encontrado</h1>"
    exame = dict(exame)
    g = conn.execute("SELECT * FROM gestantes WHERE id=?", (exame["gestante_id"],)).fetchone()
    conn.close()
    nome = g["nome"] if g else "Paciente"
    itens_html = "".join(f"<li>{o}</li>" for o in ORIENTACOES_PAPANICOLAU)
    corpo = f"""
    <h2 class="doc-title">Orientações para Realização do Exame de Papanicolau</h2>
    <p style="font-size:13.5px;">Prezada <b>{nome}</b>,</p>
    <p style="font-size:13.5px;">Para garantir um resultado de qualidade no seu exame de Papanicolau, siga as orientações abaixo:</p>
    <ul style="font-size:13.5px; line-height:1.9;">{itens_html}</ul>
    <p style="font-size:13.5px;"><b>Informe ao profissional se:</b></p>
    <ul style="font-size:13.5px; line-height:1.9;">
      <li>Está grávida ou suspeita de gravidez;</li>
      <li>Está em tratamento ginecológico;</li>
      <li>Apresenta corrimento, sangramento ou dor pélvica;</li>
      <li>Já realizou cirurgias ginecológicas.</li>
    </ul>
    <div class="section">
      <div class="section-title">Como é o exame?</div>
      <p style="font-size:13px;">O Papanicolau é um exame simples, rápido e geralmente indolor, realizado para prevenir e
      detectar precocemente alterações no colo do útero, inclusive o câncer do colo do útero. É normal ocorrer um pequeno
      desconforto ou discreto sangramento após a coleta, que costuma desaparecer em poucas horas.</p>
    </div>
    <div class="row" style="margin-top:16px;">
      {_campo("Data do exame", _fmt_data_br(exame.get("data")) if exame.get("data") else "___/___/___")}
      {_campo("Horário", exame.get("horario") or "___:___")}
    </div>
    <p style="font-size:12px;color:#888;margin-top:14px;">Obs: em caso de cancelamento, avise por gentileza através do
    WhatsApp. Grata.</p>
    """
    return 200, _print_shell(f"Orientações Papanicolau — {nome}", corpo)


# ---- Agenda ------------------------------------------------------------

@route("GET", "/api/agenda")
def list_agenda(handler, params, body, query):
    conn = get_db()
    rows = conn.execute(
        """SELECT agenda_eventos.*, gestantes.nome AS gestante_nome
           FROM agenda_eventos LEFT JOIN gestantes ON gestantes.id = agenda_eventos.gestante_id
           ORDER BY data_hora"""
    ).fetchall()
    conn.close()
    return 200, [dict(r) for r in rows]


@route("POST", "/api/agenda")
def create_agenda_evento(handler, params, body, query):
    conn = get_db()

    # Se vier "nova_paciente" no corpo, cadastra a gestante agora (com e-mail
    # de verificacao de conta) e usa o id recem-criado para o evento.
    gestante_id = body.get("gestante_id")
    nova_paciente_recem_criada = None
    nova_paciente = body.get("nova_paciente")
    if not gestante_id and nova_paciente and nova_paciente.get("nome"):
        nova_paciente_recem_criada = _criar_gestante(conn, nova_paciente)
        gestante_id = nova_paciente_recem_criada["id"]

    valor = body.get("valor")
    status_pagamento = "pendente" if valor else "nao_aplicavel"
    cur = conn.execute(
        """INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes, valor, status_pagamento)
        VALUES (?,?,?,?,?,?,?)
        RETURNING id""",
        (gestante_id, body.get("tipo"), body.get("data_hora"),
         body.get("status", "agendado"), body.get("observacoes"), valor, status_pagamento),
    )
    new_id = cur.fetchone()["id"]
    conn.commit()
    row = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (new_id,)).fetchone()

    if gestante_id:
        g = conn.execute("SELECT nome, email FROM gestantes WHERE id=?", (gestante_id,)).fetchone()
        if g and g["email"]:
            send_email(
                g["email"],
                f"{(body.get('tipo') or 'atendimento').capitalize()} agendado(a) - {CLINICA_NOME}",
                tpl_evento_marcado(
                    g["nome"],
                    body.get("tipo") or "atendimento",
                    body.get("data_hora"),
                    body.get("observacoes"),
                    valor=valor,
                    status_pagamento=status_pagamento,
                ),
                tipo="evento_marcado",
            )
    conn.close()
    resultado = dict(row)
    if nova_paciente_recem_criada:
        resultado["nova_paciente"] = enrich_gestante(nova_paciente_recem_criada)
    return 201, resultado


@route("POST", "/api/agenda/{id}/pagamento")
def criar_pagamento_evento(handler, params, body, query):
    conn = get_db()
    evento = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (params["id"],)).fetchone()
    if not evento:
        conn.close()
        return 404, {"erro": "Evento nao encontrado"}
    if not evento["valor"]:
        conn.close()
        return 400, {"erro": "Este evento nao possui valor definido"}
    gestante = None
    if evento["gestante_id"]:
        gestante = conn.execute("SELECT nome, email FROM gestantes WHERE id=?", (evento["gestante_id"],)).fetchone()
    titulo = f"{(evento['tipo'] or 'Atendimento').capitalize()} - {gestante['nome'] if gestante else 'Paciente'}"
    try:
        checkout_url, preference_id = mp_criar_preferencia(
            titulo, evento["valor"], evento["id"],
            email_pagador=(gestante["email"] if gestante else None),
        )
    except RuntimeError as e:
        conn.close()
        return 400, {"erro": str(e)}
    conn.execute(
        "UPDATE agenda_eventos SET checkout_url=?, payment_id=? WHERE id=?",
        (checkout_url, preference_id, evento["id"]),
    )
    conn.commit()
    conn.close()
    return 200, {"checkout_url": checkout_url, "preference_id": preference_id}


@route("POST", "/api/pagamentos/webhook")
def pagamento_webhook_post(handler, params, body, query):
    return _processar_webhook_pagamento(body, query)


@route("GET", "/api/pagamentos/webhook")
def pagamento_webhook_get(handler, params, body, query):
    return _processar_webhook_pagamento({}, query)


def _processar_webhook_pagamento(body, query):
    payment_id = None
    if body.get("data", {}).get("id"):
        payment_id = body["data"]["id"]
    elif query.get("data.id"):
        payment_id = query["data.id"][0]
    elif query.get("id"):
        payment_id = query["id"][0]
    if not payment_id or not MERCADOPAGO_ACCESS_TOKEN:
        return 200, {"ok": True}
    try:
        pagamento = mp_consultar_pagamento(payment_id)
    except Exception as e:  # noqa
        print(f"[mercadopago] erro ao consultar pagamento {payment_id}: {e}")
        return 200, {"ok": True}
    if pagamento.get("status") != "approved":
        return 200, {"ok": True}
    evento_id = pagamento.get("external_reference")
    if not evento_id:
        return 200, {"ok": True}
    conn = get_db()
    evento = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (evento_id,)).fetchone()
    if evento and evento["status_pagamento"] != "pago":
        conn.execute("UPDATE agenda_eventos SET status_pagamento='pago' WHERE id=?", (evento_id,))
        conn.commit()
        if evento["gestante_id"]:
            g = conn.execute("SELECT nome, email FROM gestantes WHERE id=?", (evento["gestante_id"],)).fetchone()
            if g and g["email"]:
                send_email(
                    g["email"], "Pagamento confirmado",
                    tpl_pagamento_confirmado(g["nome"], evento["tipo"] or "atendimento", evento["valor"], evento["data_hora"]),
                    tipo="pagamento_confirmado",
                )
    conn.close()
    return 200, {"ok": True}


@route("POST", "/api/agenda/{id}/marcar-pago")
def marcar_pago_manual(handler, params, body, query):
    """Alternativa ao Mercado Pago: confirmar pagamento manualmente (pix direto,
    dinheiro etc.) quando nao ha integracao de gateway ativa."""
    conn = get_db()
    evento = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (params["id"],)).fetchone()
    if not evento:
        conn.close()
        return 404, {"erro": "Evento nao encontrado"}
    conn.execute("UPDATE agenda_eventos SET status_pagamento='pago' WHERE id=?", (params["id"],))
    conn.commit()
    if evento["gestante_id"]:
        g = conn.execute("SELECT nome, email FROM gestantes WHERE id=?", (evento["gestante_id"],)).fetchone()
        if g and g["email"]:
            send_email(
                g["email"], "Pagamento confirmado",
                tpl_pagamento_confirmado(g["nome"], evento["tipo"] or "atendimento", evento["valor"], evento["data_hora"]),
                tipo="pagamento_confirmado",
            )
    row = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (params["id"],)).fetchone()
    conn.close()
    return 200, dict(row)


@route("PUT", "/api/agenda/{id}")
def update_agenda_evento(handler, params, body, query):
    conn = get_db()
    fields = ["gestante_id", "tipo", "data_hora", "status", "observacoes", "valor", "status_pagamento"]
    updates = {f: body[f] for f in fields if f in body}
    if updates:
        set_clause = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE agenda_eventos SET {set_clause} WHERE id=?", (*updates.values(), params["id"]))
        conn.commit()
    row = conn.execute("SELECT * FROM agenda_eventos WHERE id=?", (params["id"],)).fetchone()
    conn.close()
    if not row:
        return 404, {"erro": "Evento não encontrado"}
    return 200, dict(row)


@route("DELETE", "/api/agenda/{id}")
def delete_agenda_evento(handler, params, body, query):
    conn = get_db()
    conn.execute("DELETE FROM agenda_eventos WHERE id=?", (params["id"],))
    conn.commit()
    conn.close()
    return 200, {"ok": True}


# ---- Dashboard -----------------------------------------------------------

@route("GET", "/api/relatorios")
def relatorios(handler, params, body, query):
    conn = get_db()
    hoje_dt = datetime.now()
    hoje = hoje_dt.strftime("%Y-%m-%d")
    inicio_semana = (hoje_dt - timedelta(days=6)).strftime("%Y-%m-%d")
    inicio_mes = hoje_dt.strftime("%Y-%m-01")
    mes_prefix = hoje_dt.strftime("%Y-%m")

    def contagens(desde, ate):
        consultas = conn.execute(
            "SELECT COUNT(*) c FROM prenatal_consultas WHERE data BETWEEN ? AND ?", (desde, ate)
        ).fetchone()["c"]
        exames = conn.execute(
            "SELECT COUNT(*) c FROM exames WHERE data BETWEEN ? AND ? AND status='realizado'", (desde, ate)
        ).fetchone()["c"]
        partos = conn.execute(
            "SELECT COUNT(*) c FROM partos WHERE data BETWEEN ? AND ?", (desde, ate)
        ).fetchone()["c"]
        return {"consultas": consultas, "exames": exames, "partos": partos}

    resultado_hoje = contagens(hoje, hoje)
    resultado_semana = contagens(inicio_semana, hoje)
    resultado_mes = contagens(inicio_mes, hoje)

    faturamento_mes = conn.execute(
        "SELECT COALESCE(SUM(valor), 0) s FROM agenda_eventos WHERE status_pagamento='pago' AND data_hora LIKE ?",
        (f"{mes_prefix}%",),
    ).fetchone()["s"]
    faturamento_pendente_mes = conn.execute(
        "SELECT COALESCE(SUM(valor), 0) s FROM agenda_eventos WHERE status_pagamento='pendente' AND data_hora LIKE ?",
        (f"{mes_prefix}%",),
    ).fetchone()["s"]

    serie_30_dias = []
    for i in range(29, -1, -1):
        dia = (hoje_dt - timedelta(days=i)).strftime("%Y-%m-%d")
        c = conn.execute(
            "SELECT COUNT(*) c FROM prenatal_consultas WHERE data = ?", (dia,)
        ).fetchone()["c"]
        serie_30_dias.append({"data": dia, "atendimentos": c})

    partos_mes_por_tipo = {
        r["tipo"]: r["c"] for r in conn.execute(
            "SELECT tipo, COUNT(*) c FROM partos WHERE data LIKE ? GROUP BY tipo", (f"{mes_prefix}%",)
        )
    }

    tipos_atendimento_mes = {
        (r["tipo_atendimento"] or "Atendimento"): r["c"] for r in conn.execute(
            "SELECT tipo_atendimento, COUNT(*) c FROM prenatal_consultas WHERE data LIKE ? GROUP BY tipo_atendimento",
            (f"{mes_prefix}%",),
        )
    }

    conn.close()
    return 200, {
        "hoje": resultado_hoje,
        "semana": resultado_semana,
        "mes": resultado_mes,
        "faturamento_mes": faturamento_mes,
        "faturamento_pendente_mes": faturamento_pendente_mes,
        "serie_30_dias": serie_30_dias,
        "partos_mes_por_tipo": partos_mes_por_tipo,
        "tipos_atendimento_mes": tipos_atendimento_mes,
    }


@route("GET", "/api/dashboard")
def dashboard(handler, params, body, query):
    conn = get_db()
    total_gestantes = conn.execute("SELECT COUNT(*) c FROM gestantes WHERE status='gestante'").fetchone()["c"]
    total_puerperas = conn.execute("SELECT COUNT(*) c FROM gestantes WHERE status='puerperio'").fetchone()["c"]

    mes_atual = datetime.now().strftime("%Y-%m")
    partos_mes = conn.execute(
        "SELECT tipo, COUNT(*) c FROM partos WHERE data LIKE ? GROUP BY tipo", (f"{mes_atual}%",)
    ).fetchall()
    partos_mes_dict = {r["tipo"]: r["c"] for r in partos_mes}

    gestantes_rows = conn.execute("SELECT * FROM gestantes WHERE status='gestante'").fetchall()
    gestantes = [enrich_gestante(r) for r in gestantes_rows]
    alto_risco = sum(1 for g in gestantes if g["alto_risco"])
    prematuros = conn.execute(
        "SELECT COUNT(*) c FROM partos WHERE data LIKE ? AND idade_gestacional_semanas < 37",
        (f"{mes_atual}%",),
    ).fetchone()["c"]

    exames_pendentes = conn.execute("SELECT COUNT(*) c FROM exames WHERE status='pendente'").fetchone()["c"]
    vacinas_pendentes = conn.execute("SELECT COUNT(*) c FROM vacinas WHERE status='pendente'").fetchone()["c"]
    consultas_realizadas = conn.execute("SELECT COUNT(*) c FROM prenatal_consultas").fetchone()["c"]

    hoje = datetime.now().strftime("%Y-%m-%d")
    consultas_hoje = [dict(r) for r in conn.execute(
        """SELECT agenda_eventos.*, gestantes.nome AS gestante_nome FROM agenda_eventos
           LEFT JOIN gestantes ON gestantes.id = agenda_eventos.gestante_id
           WHERE data_hora LIKE ? ORDER BY data_hora""", (f"{hoje}%",))]

    proximas = [dict(r) for r in conn.execute(
        """SELECT agenda_eventos.*, gestantes.nome AS gestante_nome FROM agenda_eventos
           LEFT JOIN gestantes ON gestantes.id = agenda_eventos.gestante_id
           WHERE data_hora > ? ORDER BY data_hora LIMIT 8""", (datetime.now().isoformat(),))]

    risco_lista = [{"id": g["id"], "nome": g["nome"], "condicoes_risco": g["condicoes_risco"]}
                    for g in gestantes if g["alto_risco"]]

    conn.close()
    return 200, {
        "gestantes_cadastradas": total_gestantes,
        "puerperas": total_puerperas,
        "partos_normais_mes": partos_mes_dict.get("normal", 0),
        "cesareas_mes": partos_mes_dict.get("cesarea", 0),
        "forceps_mes": partos_mes_dict.get("forceps", 0),
        "gestantes_alto_risco": alto_risco,
        "partos_prematuros_mes": prematuros,
        "exames_pendentes": exames_pendentes,
        "vacinas_pendentes": vacinas_pendentes,
        "consultas_realizadas": consultas_realizadas,
        "consultas_hoje": consultas_hoje,
        "proximas_consultas": proximas,
        "gestantes_alto_risco_lista": risco_lista,
    }


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status, html):
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dispatch(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        body = {}
        length = int(self.headers.get("Content-Length", 0))
        if length:
            raw = self.rfile.read(length)
            try:
                body = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                body = {}

        for m, regex, fn in HTML_ROUTES:
            if m != method:
                continue
            match = regex.match(path)
            if match:
                try:
                    status, html = fn(self, match.groupdict(), body, query)
                except Exception as e:  # noqa
                    self._send_html(500, f"<h1>Erro</h1><p>{e}</p>")
                    return
                self._send_html(status, html)
                return

        for m, regex, fn in ROUTES:
            if m != method:
                continue
            match = regex.match(path)
            if match:
                try:
                    status, payload = fn(self, match.groupdict(), body, query)
                except Exception as e:  # noqa
                    self._send(500, {"erro": str(e)})
                    return
                self._send(status, payload)
                return
        self._send(404, {"erro": "Rota não encontrada", "path": path})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, fmt, *args):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {args[0]} {args[1]} -> {args[2]}")


def main():
    init_db()
    port = int(os.environ.get("PORT", 8000))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Sistema de Consultorio Obstetrico - API rodando em http://localhost:{port}")
    print("Ctrl+C para parar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
