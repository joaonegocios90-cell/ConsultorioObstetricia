"""
Popula o banco com dados fictícios para demonstração.
Executar: python3 seed.py   (antes de subir o server, ou com o server parado)
"""

import json
import os
from datetime import datetime, timedelta

from server import DB_PATH, USE_POSTGRES, get_db, init_db

# Todas as tabelas de dados (a ordem não importa — o TRUNCATE usa CASCADE).
TABELAS = [
    "gestantes", "prenatal_consultas", "exames", "solicitacoes_exames",
    "ultrassons", "vacinas", "agenda_eventos", "emails_log", "partos",
    "recem_nascidos", "puerperios",
]


def days_ago(n):
    return (datetime.now() - timedelta(days=n)).strftime("%Y-%m-%d")


def days_ahead(n):
    return (datetime.now() + timedelta(days=n)).strftime("%Y-%m-%d")


def seed():
    if USE_POSTGRES:
        # Garante que as tabelas existem e depois esvazia tudo (equivalente
        # a apagar e recriar o arquivo .db no modo SQLite). RESTART IDENTITY
        # reinicia os ids em 1, CASCADE cuida das tabelas relacionadas.
        init_db()
        conn = get_db()
        conn.execute(f"TRUNCATE TABLE {', '.join(TABELAS)} RESTART IDENTITY CASCADE")
        conn.commit()
        conn.close()
    else:
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)
        init_db()
    conn = get_db()
    cur = conn.cursor()

    # ---------------------------------------------------------------
    # Gestante 1: Mariana - gestação normal, 28 semanas
    # ---------------------------------------------------------------
    cur.execute(
        """INSERT INTO gestantes (nome, data_nascimento, cpf, telefone, endereco, convenio,
        tipo_sanguineo, num_gestacoes, num_partos_normais, num_cesareas, num_abortos,
        alergias, doencas_preexistentes, medicamentos_uso, dum, condicoes_risco, status, criado_em,
        antecedentes_clinicos, antecedentes_cirurgicos, antecedentes_familiares, habitos, email)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id""",
        ("Mariana Costa Silva", "1994-03-12", "123.456.789-00", "(11) 98765-4321",
         "Rua das Flores, 120 - São Paulo/SP", "SUS", "O+",
         2, 1, 0, 0, "Nenhuma conhecida", "Nenhuma", "Ácido fólico, Sulfato ferroso",
         days_ago(196), json.dumps([]), "gestante", datetime.now().isoformat(),
         "Nega hipertensão ou diabetes prévios.", "Nenhuma cirurgia relatada.",
         "Mãe hipertensa. Sem outros casos relevantes.", "Não fuma, não bebe. Alimentação regular.",
         "mariana.costa@example.com"),
    )
    g1 = cur.fetchone()["id"]

    for i, d in enumerate([180, 140, 100, 60, 20]):
        cur.execute(
            """INSERT INTO prenatal_consultas (gestante_id, data, profissional, tipo_atendimento,
            peso, altura_uterina, pressao_arterial, imc, bcf, movimentos_fetais, edema, queixas,
            exame_fisico, hma, evolucao_clinica, hipotese_diagnostica, conduta, prescricao,
            exames_solicitados, orientacoes, retorno)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (g1, days_ago(d), "Enf. Obstétrica Ana Paula Ramos", "Retorno" if d < 180 else "Atendimento",
             58 + i * 1.5, 18 + i * 2, "110x70", 22.5, 145 if d < 180 else None,
             "Presentes" if d < 160 else "Ainda não referidos", "Ausente",
             "Nenhuma queixa relevante", "Sem alterações",
             "Sem queixas agudas, acompanhamento de rotina." if d < 180 else "Primeira consulta de pré-natal.",
             "Gestação evoluindo bem, sem intercorrências.",
             "Z34 - Supervisão de gravidez normal" if d == 180 else "",
             "Manter acompanhamento de rotina",
             "Ácido fólico 5mg 1x/dia, Sulfato ferroso 40mg 1x/dia",
             "Hemograma, Glicemia de jejum" if d == 140 else "",
             "Manter hidratação, repouso e alimentação balanceada",
             days_ago(d - 30)),
        )

    for tipo, d, status, resultado in [
        ("Hemograma", days_ago(140), "realizado", "Dentro da normalidade"),
        ("Glicemia de jejum", days_ago(140), "realizado", "82 mg/dL - normal"),
        ("HIV", days_ago(180), "realizado", "Não reagente"),
        ("Sífilis (VDRL)", days_ago(180), "realizado", "Não reagente"),
        ("Toxoplasmose", days_ago(180), "realizado", "IgG+ IgM- (imune)"),
        ("Curva glicêmica", days_ago(20), "pendente", ""),
        ("Urina tipo 1", days_ago(20), "pendente", ""),
    ]:
        cur.execute(
            "INSERT INTO exames (gestante_id, tipo, data, resultado, status) VALUES (?,?,?,?,?)",
            (g1, tipo, d, resultado, status),
        )

    cur.execute(
        """INSERT INTO ultrassons (gestante_id, data, idade_gestacional, peso_fetal, sexo,
        placenta, liquido_amniotico, bcf, comprimento, circunferencia_cefalica, percentil, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (g1, days_ago(60), "22s3d", 480, "Feminino", "Posterior, grau I",
         "Normal (ILA 12cm)", 148, 27.5, 20.1, "P50", "Morfológico sem alterações"),
    )
    cur.execute(
        """INSERT INTO ultrassons (gestante_id, data, idade_gestacional, peso_fetal, sexo,
        placenta, liquido_amniotico, bcf, comprimento, circunferencia_cefalica, percentil, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (g1, days_ago(10), "27s2d", 1150, "Feminino", "Posterior, grau I",
         "Normal (ILA 11cm)", 142, 35.2, 25.4, "P55", "Crescimento adequado para idade gestacional"),
    )

    for tipo, dose, status, d in [
        ("dTpa", "Dose única", "aplicada", days_ago(60)),
        ("Influenza", "Dose única", "aplicada", days_ago(100)),
        ("Hepatite B", "1ª dose", "aplicada", days_ago(180)),
        ("Hepatite B", "2ª dose", "pendente", None),
    ]:
        cur.execute(
            "INSERT INTO vacinas (gestante_id, tipo, dose, data_aplicacao, status) VALUES (?,?,?,?,?)",
            (g1, tipo, dose, d, status),
        )

    cur.execute(
        """INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes, valor, status_pagamento)
        VALUES (?,?,?,?,?,?,?)""",
        (g1, "consulta", days_ahead(0) + "T09:00", "agendado", "Consulta de rotina - retorno", 180.0, "pendente"),
    )
    cur.execute(
        "INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes) VALUES (?,?,?,?,?)",
        (g1, "exame", days_ahead(3) + "T08:00", "agendado", "Curva glicêmica"),
    )

    # ---------------------------------------------------------------
    # Gestante 2: Fernanda - alto risco (pré-eclâmpsia + diabetes gestacional)
    # ---------------------------------------------------------------
    cur.execute(
        """INSERT INTO gestantes (nome, data_nascimento, cpf, telefone, endereco, convenio,
        tipo_sanguineo, num_gestacoes, num_partos_normais, num_cesareas, num_abortos,
        alergias, doencas_preexistentes, medicamentos_uso, dum, condicoes_risco, status, criado_em,
        antecedentes_clinicos, antecedentes_cirurgicos, antecedentes_familiares, habitos, email)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id""",
        ("Fernanda Oliveira Santos", "1988-07-25", "987.654.321-00", "(11) 91234-5678",
         "Av. Paulista, 900 - São Paulo/SP", "Convênio Unimed", "A-",
         3, 0, 2, 1, "Dipirona", "Hipertensão arterial crônica", "Metildopa 250mg, Insulina NPH",
         days_ago(224), json.dumps(["pre_eclampsia", "diabetes_gestacional", "hipertensao"]),
         "gestante", datetime.now().isoformat(),
         "Hipertensão arterial crônica diagnosticada há 5 anos. Diabetes gestacional na gestação anterior.",
         "2 cesarianas prévias.", "Mãe e irmã com diabetes tipo 2. Pai hipertenso.",
         "Sedentária. Dieta rica em sódio. Nega tabagismo/etilismo.",
         "fernanda.oliveira@example.com"),
    )
    g2 = cur.fetchone()["id"]

    for i, d in enumerate([200, 160, 120, 80, 40, 14]):
        cur.execute(
            """INSERT INTO prenatal_consultas (gestante_id, data, profissional, tipo_atendimento,
            peso, altura_uterina, pressao_arterial, imc, bcf, movimentos_fetais, edema, queixas,
            exame_fisico, hma, evolucao_clinica, hipotese_diagnostica, conduta, prescricao,
            exames_solicitados, orientacoes, retorno)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (g2, days_ago(d), "Dra. Camila Rocha", "Urgência" if d < 80 else "Retorno",
             70 + i * 2, 20 + i * 2.2,
             "150x95" if d < 80 else "140x90", 28.4, 138,
             "Presentes", "++/4+" if d < 80 else "+/4+",
             "Cefaleia leve" if d < 80 else "Nenhuma",
             "Edema de MMII, PA elevada, reflexos vivos" if d < 80 else "Sem alterações agudas",
             "Cefaleia e edema progressivo há 3 dias, sem escotomas ou dor epigástrica." if d < 80 else "",
             "Gestação de alto risco - monitorização intensiva de PA e glicemia.",
             "O14 - Pré-eclâmpsia" if d < 80 else "",
             "Encaminhada para pré-natal de alto risco. Retorno quinzenal.",
             "Metildopa 250mg 3x/dia, Insulina NPH conforme HGT",
             "Proteinúria de 24h, HGT diário, Perfil biofísico fetal",
             "Repouso relativo, dieta hipossódica e restrita em carboidratos simples",
             days_ago(d - 14)),
        )

    for tipo, d, status, resultado in [
        ("Hemograma", days_ago(160), "realizado", "Hb 11.2 - dentro do esperado"),
        ("Glicemia de jejum", days_ago(160), "realizado", "128 mg/dL - alterada"),
        ("Curva glicêmica", days_ago(120), "realizado", "Diagnóstico: Diabetes gestacional"),
        ("Proteinúria 24h", days_ago(14), "realizado", "310mg/24h - alterada"),
        ("HIV", days_ago(200), "realizado", "Não reagente"),
        ("Sífilis (VDRL)", days_ago(200), "realizado", "Não reagente"),
        ("Perfil biofísico fetal", days_ago(5), "pendente", ""),
    ]:
        cur.execute(
            "INSERT INTO exames (gestante_id, tipo, data, resultado, status) VALUES (?,?,?,?,?)",
            (g2, tipo, d, resultado, status),
        )

    cur.execute(
        """INSERT INTO ultrassons (gestante_id, data, idade_gestacional, peso_fetal, sexo,
        placenta, liquido_amniotico, bcf, comprimento, circunferencia_cefalica, percentil, observacoes)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (g2, days_ago(14), "30s0d", 1320, "Masculino", "Anterior, grau II",
         "Reduzido (ILA 6.8cm)", 138, 37.8, 27.9, "P25",
         "Restrição de crescimento fetal leve - acompanhar com Doppler"),
    )

    for tipo, dose, status, d in [
        ("dTpa", "Dose única", "aplicada", days_ago(80)),
        ("Influenza", "Dose única", "pendente", None),
        ("Hepatite B", "1ª dose", "aplicada", days_ago(200)),
    ]:
        cur.execute(
            "INSERT INTO vacinas (gestante_id, tipo, dose, data_aplicacao, status) VALUES (?,?,?,?,?)",
            (g2, tipo, dose, d, status),
        )

    cur.execute(
        """INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes, valor, status_pagamento)
        VALUES (?,?,?,?,?,?,?)""",
        (g2, "retorno", days_ahead(0) + "T14:30", "agendado", "Pré-natal de alto risco - avaliação de PA", 250.0, "pago"),
    )
    cur.execute(
        "INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes) VALUES (?,?,?,?,?)",
        (g2, "exame", days_ahead(2) + "T07:30", "agendado", "Perfil biofísico fetal"),
    )

    # ---------------------------------------------------------------
    # Gestante 3: Juliana - já teve o bebê (puerpério)
    # ---------------------------------------------------------------
    cur.execute(
        """INSERT INTO gestantes (nome, data_nascimento, cpf, telefone, endereco, convenio,
        tipo_sanguineo, num_gestacoes, num_partos_normais, num_cesareas, num_abortos,
        alergias, doencas_preexistentes, medicamentos_uso, dum, condicoes_risco, status, criado_em,
        antecedentes_clinicos, antecedentes_cirurgicos, antecedentes_familiares, habitos, email)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id""",
        ("Juliana Almeida Pereira", "1996-11-02", "456.789.123-00", "(11) 99887-6655",
         "Rua Augusta, 55 - São Paulo/SP", "SUS", "B+",
         1, 0, 0, 0, "Nenhuma", "Nenhuma", "Nenhum", days_ago(290),
         json.dumps([]), "puerperio", datetime.now().isoformat(),
         "Nega comorbidades.", "Nenhuma cirurgia relatada.", "Sem histórico familiar relevante.",
         "Não fuma, não bebe. Pratica caminhadas leves.",
         "juliana.almeida@example.com"),
    )
    g3 = cur.fetchone()["id"]

    for i, d in enumerate([270, 230, 190, 150, 110, 70, 30]):
        cur.execute(
            """INSERT INTO prenatal_consultas (gestante_id, data, profissional, tipo_atendimento,
            peso, altura_uterina, pressao_arterial, imc, bcf, movimentos_fetais, edema, queixas,
            exame_fisico, hipotese_diagnostica, evolucao_clinica, conduta, prescricao,
            exames_solicitados, orientacoes, retorno)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (g3, days_ago(d), "Enf. Obstétrica Ana Paula Ramos", "Retorno" if d < 270 else "Atendimento",
             55 + i * 1.8, 15 + i * 2.5, "115x75", 21.8,
             140 if d < 260 else None, "Presentes" if d < 220 else "Ainda não referidos",
             "Ausente", "Nenhuma", "Sem alterações",
             "Z34 - Supervisão de gravidez normal" if d == 270 else "",
             "Gestação de baixo risco, evolução normal.",
             "Manter acompanhamento de rotina", "Ácido fólico, Sulfato ferroso", "",
             "Orientações gerais de pré-natal", days_ago(max(d - 30, 5))),
        )

    cur.execute(
        """INSERT INTO partos (gestante_id, tipo, data, hora, medico, equipe, complicacoes,
        idade_gestacional_semanas)
        VALUES (?,?,?,?,?,?,?,?)
        RETURNING id""",
        (g3, "normal", days_ago(15), "03:45", "Dra. Camila Rocha",
         "Enf. Obstétrica Ana Paula, Téc. Enf. Roberta", "Nenhuma", 39),
    )
    parto3 = cur.fetchone()["id"]
    cur.execute(
        """INSERT INTO recem_nascidos (parto_id, nome, sexo, peso, altura, perimetro_cefalico,
        apgar1, apgar5, vitamina_k, teste_pezinho, teste_orelhinha, teste_coracaozinho)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
        (parto3, "Heitor Pereira Almeida", "Masculino", 3.28, 49, 34.5, 9, 10,
         "Aplicada", "Realizado - normal", "Realizado - passou", "Realizado - normal"),
    )
    cur.execute(
        """INSERT INTO puerperios (gestante_id, data, amamentacao, cicatrizacao, pressao,
        sangramento, humor, consulta_retorno) VALUES (?,?,?,?,?,?,?,?)""",
        (g3, days_ago(2), "Amamentação exclusiva, boa pega", "Em bom processo de cicatrização",
         "110x70", "Lóquios fisiológicos, quantidade normal", "Estável, sem sinais de blues puerperal",
         days_ahead(5)),
    )
    for tipo, dose, status, d in [
        ("dTpa", "Dose única", "aplicada", days_ago(100)),
        ("Influenza", "Dose única", "aplicada", days_ago(150)),
    ]:
        cur.execute(
            "INSERT INTO vacinas (gestante_id, tipo, dose, data_aplicacao, status) VALUES (?,?,?,?,?)",
            (g3, tipo, dose, d, status),
        )
    cur.execute(
        "INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes) VALUES (?,?,?,?,?)",
        (g3, "retorno", days_ahead(5) + "T10:00", "agendado", "Consulta de puerpério"),
    )

    # ---------------------------------------------------------------
    # Gestante 4: Patrícia - início de gestação (1º trimestre)
    # ---------------------------------------------------------------
    cur.execute(
        """INSERT INTO gestantes (nome, data_nascimento, cpf, telefone, endereco, convenio,
        tipo_sanguineo, num_gestacoes, num_partos_normais, num_cesareas, num_abortos,
        alergias, doencas_preexistentes, medicamentos_uso, dum, condicoes_risco, status, criado_em,
        antecedentes_clinicos, antecedentes_cirurgicos, antecedentes_familiares, habitos, email)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        RETURNING id""",
        ("Patrícia Gomes Lima", "1999-05-18", "321.654.987-00", "(11) 97654-3210",
         "Rua Vergueiro, 300 - São Paulo/SP", "Convênio Amil", "AB+",
         1, 0, 0, 0, "Penicilina", "Nenhuma", "Ácido fólico", days_ago(56),
         json.dumps([]), "gestante", datetime.now().isoformat(),
         "Nega comorbidades.", "Nenhuma cirurgia relatada.", "Sem histórico familiar relevante.",
         "Não fuma, não bebe. Sedentária, iniciando caminhadas.",
         "patricia.gomes@example.com"),
    )
    g4 = cur.fetchone()["id"]
    cur.execute(
        """INSERT INTO prenatal_consultas (gestante_id, data, profissional, tipo_atendimento,
        peso, altura_uterina, pressao_arterial, imc, bcf, movimentos_fetais, edema, queixas,
        exame_fisico, hma, hipotese_diagnostica, evolucao_clinica, conduta, prescricao,
        exames_solicitados, orientacoes, retorno)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (g4, days_ago(30), "Enf. Obstétrica Ana Paula Ramos", "Atendimento",
         62, None, "105x65", 23.1, None, "Ainda não referidos", "Ausente",
         "Náuseas matinais, sensibilidade mamária", "Sem alterações",
         "Náuseas há 2 semanas, predominantemente matinais, sem vômitos incoercíveis.",
         "Z34 - Supervisão de gravidez normal (1º trimestre)",
         "Primeira consulta de pré-natal. Gestação inicial confirmada por beta-HCG.",
         "Solicitados exames de rotina do 1º trimestre. Retorno em 4 semanas.",
         "Ácido fólico 5mg 1x/dia", "Hemograma, Tipagem sanguínea, HIV, Sífilis, Toxoplasmose, Rubéola, Urina tipo 1",
         "Orientações sobre náuseas, evitar alimentos crus, iniciar ácido fólico", days_ahead(0)),
    )
    for tipo, d, status, resultado in [
        ("Hemograma", days_ago(28), "realizado", "Dentro da normalidade"),
        ("Tipagem sanguínea", days_ago(28), "realizado", "AB+"),
        ("HIV", days_ago(28), "realizado", "Não reagente"),
        ("Sífilis (VDRL)", days_ago(28), "realizado", "Não reagente"),
        ("Toxoplasmose", days_ago(28), "pendente", ""),
        ("Rubéola", days_ago(28), "pendente", ""),
        ("Urina tipo 1", days_ago(28), "pendente", ""),
    ]:
        cur.execute(
            "INSERT INTO exames (gestante_id, tipo, data, resultado, status) VALUES (?,?,?,?,?)",
            (g4, tipo, d, resultado, status),
        )
    cur.execute(
        "INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes) VALUES (?,?,?,?,?)",
        (g4, "consulta", days_ahead(1) + "T11:00", "agendado", "Primeira consulta de pré-natal - retorno"),
    )
    cur.execute(
        "INSERT INTO agenda_eventos (gestante_id, tipo, data_hora, status, observacoes) VALUES (?,?,?,?,?)",
        (g4, "ultrassom", days_ahead(4) + "T09:30", "agendado", "Ultrassom morfológico de 1º trimestre"),
    )

    conn.commit()
    conn.close()
    print(f"Banco populado com sucesso: {DB_PATH}")
    print("4 gestantes cadastradas (1 alto risco, 1 puérpera, 1 início de gestação, 1 rotina).")


if __name__ == "__main__":
    seed()
