const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ============================================================================
// Configuração / constantes
// ============================================================================

// Em produção (frontend e backend em domínios separados, ex: Cloudflare
// Pages + Render/Railway), defina window.API_BASE_OVERRIDE no index.html.
// Localmente, sem essa variável definida, detecta o endereço sozinho.
const API_BASE = window.API_BASE_OVERRIDE
  ? window.API_BASE_OVERRIDE
  : (window.location.hostname && window.location.protocol !== "file:"
    ? `${window.location.protocol}//${window.location.hostname}:8000/api`
    : "http://localhost:8000/api");

const RISK_OPTIONS = [
  { key: "hipertensao", label: "Hipertensão" },
  { key: "diabetes_gestacional", label: "Diabetes Gestacional" },
  { key: "pre_eclampsia", label: "Pré-eclâmpsia" },
  { key: "gemelaridade", label: "Gemelaridade" },
  { key: "restricao_crescimento", label: "Restrição de Crescimento" },
  { key: "placenta_previa", label: "Placenta Prévia" },
];

const EXAME_TIPOS = ["Hemograma", "Glicemia de jejum", "Curva glicêmica", "HIV", "Sífilis (VDRL)",
  "Hepatite B", "Hepatite C", "Toxoplasmose", "Rubéola", "Urina tipo 1", "Urocultura",
  "Proteinúria 24h", "Tipagem sanguínea", "Perfil biofísico fetal", "Papanicolau (Preventivo)", "Outro"];

const VACINA_TIPOS = ["dTpa", "Influenza", "COVID-19", "Hepatite B", "Outra"];

// Painel padrão de exames laboratoriais de pré-natal, no mesmo formato do
// impresso "Solicitação de exames" que a clínica já usa.
const PAINEL_EXAMES_PRENATAL = [
  "ABO-RH", "Glicemia de jejum", "Sífilis", "VDRL", "HIV", "Hepatite B - HBsAg",
  "Toxoplasmose", "Hemograma completo", "Ferretina", "Urina - Cultura",
  "Urina - EAS", "Coombs indireto", "Hemoglobina/Hematócrito",
  "Anti-HCV (Hepatite C)", "Rubéola IgG e IgM", "TSH",
];

// Checklist da "Ficha de Início de Pré-natal" — respostas sim/não que ficam
// guardadas em avaliacao_inicial (JSON) na gestante.
const AVALIACAO_INICIAL_GRUPOS = [
  {
    titulo: "Antecedentes pessoais",
    itens: [
      ["hipertensao", "Hipertensão"], ["diabetes", "Diabetes"], ["asma", "Asma"],
      ["cardiopatias", "Cardiopatias"], ["doencas_renais", "Doenças renais"],
      ["doencas_tireoide", "Doenças da tireoide"], ["anemia", "Anemia"],
    ],
  },
  {
    titulo: "Hábitos de vida",
    itens: [
      ["tabagista", "Tabagismo"], ["etilista", "Etilismo"],
      ["atividade_fisica", "Atividade física"], ["sono_tranquilo", "Sono tranquilo"],
      ["problema_saude_atual", "Problema de saúde no momento"],
    ],
  },
  {
    titulo: "Histórico familiar",
    itens: [
      ["hist_fam_gemeos", "Gêmeos na família"], ["hist_fam_malformacoes", "Malformações congênitas"],
      ["hist_fam_doencas_geneticas", "Doenças genéticas"],
    ],
  },
  {
    titulo: "Gestações e partos anteriores",
    itens: [
      ["complicacoes_gestacao_anterior", "Complicações em gestação anterior"],
      ["complicacoes_parto_anterior", "Complicações em parto anterior"],
      ["aleitamento_anterior", "Aleitamento materno anterior"],
      ["hipertensao_gestacional_anterior", "Hipertensão gestacional anterior"],
      ["alcool_gestacao_anterior", "Uso de álcool em gestação anterior"],
      ["drogas_gestacao_anterior", "Uso de drogas em gestação anterior"],
      ["aborto_provocado_anterior", "Aborto provocado anterior"],
    ],
  },
];

const AVALIACAO_INICIAL_TEXTO = [
  ["menarca", "Menarca (idade)"], ["ciclo_menstrual", "Ciclo menstrual"],
  ["uso_contraceptivos_anteriores", "Uso de contraceptivos anteriores"],
  ["ultimo_preventivo", "Último preventivo (Papanicolau)"], ["historico_ists", "Histórico de ISTs"],
  ["teste_gravidez", "Teste de gravidez (Beta-HCG / teste rápido)"],
];

const AGENDA_TIPOS = [
  { key: "consulta", label: "Consulta" },
  { key: "ultrassom", label: "Ultrassom" },
  { key: "exame", label: "Exame" },
  { key: "retorno", label: "Retorno" },
  { key: "vacina", label: "Vacina" },
];

const PARTO_TIPOS = ["normal", "cesarea", "forceps"];

// ============================================================================
// Helpers
// ============================================================================

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ erro: "Erro desconhecido" }));
    throw new Error(err.erro || `Erro ${res.status}`);
  }
  return res.json();
}

function fmtDate(d) {
  if (!d) return "—";
  const parts = d.split("T")[0].split("-");
  if (parts.length !== 3) return d;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function fmtDateTime(dt) {
  if (!dt) return "—";
  const [d, t] = dt.split("T");
  return `${fmtDate(d)}${t ? " às " + t.slice(0, 5) : ""}`;
}

function calcDppLocal(dum) {
  if (!dum) return null;
  const d = new Date(dum + "T00:00:00");
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + 280);
  return d.toISOString().slice(0, 10);
}

function calcIgLocal(dum) {
  if (!dum) return null;
  const d = new Date(dum + "T00:00:00");
  if (isNaN(d)) return null;
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff < 0) return null;
  return { semanas: Math.floor(diff / 7), dias: diff % 7, texto: `${Math.floor(diff / 7)}s${diff % 7}d` };
}

function initials(nome) {
  if (!nome) return "?";
  const parts = nome.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

function riskLabel(key) {
  const found = RISK_OPTIONS.find((r) => r.key === key);
  return found ? found.label : key;
}

const STATUS_BADGE = {
  pendente: { cls: "badge-warn", label: "Pendente" },
  realizado: { cls: "badge-ok", label: "Realizado" },
  aplicada: { cls: "badge-ok", label: "Aplicada" },
  agendado: { cls: "badge-teal", label: "Agendado" },
  confirmado: { cls: "badge-ok", label: "Confirmado" },
  cancelado: { cls: "badge-neutral", label: "Cancelado" },
  realizado_evento: { cls: "badge-ok", label: "Realizado" },
};

function StatusBadge({ status }) {
  const info = STATUS_BADGE[status] || { cls: "badge-neutral", label: status || "—" };
  return React.createElement("span", { className: `badge ${info.cls}` }, info.label);
}

// ============================================================================
// Componentes reutilizáveis
// ============================================================================

function StatCard({ icon, label, value, color, onClick }) {
  return (
    React.createElement("div", { className: `card stat-card${onClick ? " clickable" : ""}`, onClick: onClick, title: onClick ? "Clique para ver detalhes" : undefined }, React.createElement("div", { className: "icon-badge", style: { background: color + "22", color: color } }, icon), React.createElement("div", { className: "label" }, label), React.createElement("div", { className: "value" }, value))
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    React.createElement("div", { className: "modal-overlay", onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } }, React.createElement("div", { className: "modal", style: wide ? { maxWidth: 860 } : undefined }, React.createElement("div", { className: "modal-header" }, React.createElement("h3", null, title), React.createElement("button", { className: "modal-close", onClick: onClose }, "✕")), children))
  );
}

function EnderecoInput({ value, onChange }) {
  // Campo de endereço com autocomplete do Google Maps (Places API), quando o
  // script do Maps estiver carregado (ver index.html). Sem a chave/script,
  // funciona como um input de texto comum.
  const inputRef = useRef(null);
  useEffect(() => {
    if (!window.google || !window.google.maps || !window.google.maps.places || !inputRef.current) return;
    const autocomplete = new window.google.maps.places.Autocomplete(inputRef.current, {
      types: ["address"],
      componentRestrictions: { country: "br" },
      fields: ["formatted_address"],
    });
    const listener = autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (place && place.formatted_address) onChange(place.formatted_address);
    });
    return () => {
      if (window.google && window.google.maps && window.google.maps.event) {
        window.google.maps.event.removeListener(listener);
      }
    };
  }, []);
  return React.createElement("input", {
    ref: inputRef,
    value: value || "",
    onChange: (e) => onChange(e.target.value),
    placeholder: "Comece a digitar o endereço...",
    autoComplete: "off",
  });
}

function Field({ label, children, full }) {
  return (
    React.createElement("div", { className: `form-field ${full ? "full" : ""}` }, React.createElement("label", null, label), children)
  );
}

function MiniChart({ points, color = "#c2185b", unit = "" }) {
  // points: array de { x: label, y: number }
  const valid = points.filter((p) => typeof p.y === "number" && !isNaN(p.y));
  if (valid.length < 2) {
    return React.createElement("div", { className: "empty-state" }, "Dados insuficientes para gerar gráfico (mínimo 2 registros).");
  }
  const W = 560, H = 160, PAD = 30;
  const ys = valid.map((p) => p.y);
  const minY = Math.min(...ys) * 0.97;
  const maxY = Math.max(...ys) * 1.03;
  const range = maxY - minY || 1;
  const stepX = (W - PAD * 2) / (valid.length - 1);
  const coords = valid.map((p, i) => ({
    x: PAD + i * stepX,
    y: H - PAD - ((p.y - minY) / range) * (H - PAD * 2),
  }));
  const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  return (
    React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H }, React.createElement("polyline", { points: coords.map((c) => `${c.x},${c.y}`).join(" "), fill: "none", stroke: color, strokeWidth: "2.5" }), coords.map((c, i) => (
        React.createElement("g", { key: i }, React.createElement("circle", { cx: c.x, cy: c.y, r: "3.5", fill: color }), React.createElement("text", { x: c.x, y: c.y - 10, fontSize: "10", textAnchor: "middle", fill: "#6b6570" }, valid[i].y, unit), React.createElement("text", { x: c.x, y: H - 8, fontSize: "9", textAnchor: "middle", fill: "#a89aa2" }, valid[i].x))
      )))
  );
}

function RiskPills({ value, onChange }) {
  const toggle = (key) => {
    if (value.includes(key)) onChange(value.filter((k) => k !== key));
    else onChange([...value, key]);
  };
  return (
    React.createElement("div", { className: "checkbox-row" }, RISK_OPTIONS.map((opt) => (
        React.createElement("div", { key: opt.key, className: `checkbox-pill ${value.includes(opt.key) ? "checked" : ""}`, onClick: () => toggle(opt.key) }, value.includes(opt.key) ? "✓" : "+", " ", opt.label)
      )))
  );
}

// ============================================================================
// Sidebar
// ============================================================================

function Sidebar({ page, onNavigate }) {
  const items = [
    { key: "dashboard", label: "Dashboard", ic: "📊" },
    { key: "cadastros", label: "Cadastros", ic: "📝" },
    { key: "gestantes", label: "Gestantes", ic: "🤰" },
    { key: "agenda", label: "Agenda", ic: "📅" },
    { key: "calendario", label: "Calendário", ic: "🗓️" },
    { key: "relatorios", label: "Relatórios", ic: "📈" },
    { key: "configuracoes", label: "Configurações", ic: "⚙️" },
    { key: "sobre", label: "Sobre o sistema", ic: "ℹ️" },
  ];
  return (
    React.createElement("div", { className: "sidebar" }, React.createElement("div", { className: "sidebar-brand" }, React.createElement("div", { className: "logo-dot" }, React.createElement("img", { src: "logo.png", alt: "Graziela Freitas — Enfermeira Obstetra" })), React.createElement("div", null, React.createElement("h1", null, "Graziela Freitas"), React.createElement("p", null, "Enfermeira Obstetra"))), items.map((it) => (
        React.createElement("button", { key: it.key, className: `nav-item ${page === it.key ? "active" : ""}`, onClick: () => onNavigate(it.key) }, React.createElement("span", { className: "ic" }, it.ic), " ", it.label)
      )), React.createElement("div", { className: "sidebar-footer" }, "Sistema NASCER", React.createElement("br", null), "Cuidar de mulheres é acolher histórias que geram vida."))
  );
}

// ============================================================================
// Dashboard
// ============================================================================

function DashboardPage({ onOpenGestante, onNavigateGestantes, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!data) return React.createElement("div", { className: "empty-state" }, "Carregando indicadores...");

  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("div", null, React.createElement("h2", null, "Dashboard"), React.createElement("div", { className: "sub" }, "Visão geral do consultório — ", new Date().toLocaleDateString("pt-BR")))), React.createElement("div", { className: "grid grid-4", style: { marginBottom: 18 } }, React.createElement(StatCard, { icon: "🤰", label: "Gestantes ativas", value: data.gestantes_cadastradas, color: "#c2185b", onClick: () => onNavigateGestantes("gestante") }), React.createElement(StatCard, { icon: "👶", label: "Puérperas", value: data.puerperas, color: "#7e57c2", onClick: () => onNavigateGestantes("puerperio") }), React.createElement(StatCard, { icon: "⚠️", label: "Alto risco", value: data.gestantes_alto_risco, color: "#d32f2f", onClick: () => onNavigateGestantes("risco") }), React.createElement(StatCard, { icon: "🩺", label: "Consultas realizadas", value: data.consultas_realizadas, color: "#00796b", onClick: () => onNavigate("agenda") })), React.createElement("div", { className: "grid grid-4", style: { marginBottom: 24 } }, React.createElement(StatCard, { icon: "👣", label: "Partos normais (mês)", value: data.partos_normais_mes, color: "#2e7d32", onClick: () => onNavigate("relatorios") }), React.createElement(StatCard, { icon: "🔪", label: "Cesáreas (mês)", value: data.cesareas_mes, color: "#ef6c00", onClick: () => onNavigate("relatorios") }), React.createElement(StatCard, { icon: "🧪", label: "Exames pendentes", value: data.exames_pendentes, color: "#ef6c00", onClick: () => onNavigateGestantes("todas") }), React.createElement(StatCard, { icon: "💉", label: "Vacinas pendentes", value: data.vacinas_pendentes, color: "#ef6c00", onClick: () => onNavigateGestantes("todas") })), React.createElement("div", { className: "grid grid-2" }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Consultas de hoje"), data.consultas_hoje.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhuma consulta agendada para hoje."), data.consultas_hoje.map((c) => (
            React.createElement("div", { key: c.id, className: "gestante-card", onClick: () => c.gestante_id && onOpenGestante(c.gestante_id) }, React.createElement("div", { className: "gestante-row" }, React.createElement("div", { className: "avatar-circle" }, initials(c.gestante_nome)), React.createElement("div", { className: "info" }, React.createElement("div", { className: "nome" }, c.gestante_nome || "Sem paciente vinculada"), React.createElement("div", { className: "meta" }, fmtDateTime(c.data_hora), " · ", c.observacoes))), React.createElement(StatusBadge, { status: c.status }))
          ))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Gestantes de alto risco"), data.gestantes_alto_risco_lista.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhuma gestante de alto risco no momento."), data.gestantes_alto_risco_lista.map((g) => (
            React.createElement("div", { key: g.id, className: "gestante-card", onClick: () => onOpenGestante(g.id) }, React.createElement("div", { className: "gestante-row" }, React.createElement("div", { className: "avatar-circle" }, initials(g.nome)), React.createElement("div", { className: "info" }, React.createElement("div", { className: "nome" }, g.nome), React.createElement("div", { className: "meta" }, g.condicoes_risco.map((c) => React.createElement("span", { key: c, className: "risk-tag" }, riskLabel(c)))))))
          )))), React.createElement("div", { className: "card", style: { marginTop: 16 } }, React.createElement("div", { className: "section-title" }, "Próximas consultas e eventos"), data.proximas_consultas.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum evento futuro agendado."), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Data"), React.createElement("th", null, "Tipo"), React.createElement("th", null, "Paciente"), React.createElement("th", null, "Observações"), React.createElement("th", null, "Status"))), React.createElement("tbody", null, data.proximas_consultas.map((c) => (
              React.createElement("tr", { key: c.id, onClick: () => c.gestante_id && onOpenGestante(c.gestante_id) }, React.createElement("td", null, fmtDateTime(c.data_hora)), React.createElement("td", { style: { textTransform: "capitalize" } }, c.tipo), React.createElement("td", null, c.gestante_nome || "—"), React.createElement("td", null, c.observacoes), React.createElement("td", null, React.createElement(StatusBadge, { status: c.status })))
            ))))))
  );
}

function ApiErrorBanner({ error }) {
  return (
    React.createElement("div", { className: "alert-banner" }, "⚠️ Não foi possível conectar à API (", API_BASE, "). Verifique se o backend está rodando (", React.createElement("code", null, "python3 server.py"), "). Detalhe: ", error)
  );
}

// ============================================================================
// Gestantes — lista
// ============================================================================

function GestantesListPage({ onOpenGestante, initialFiltro }) {
  const [gestantes, setGestantes] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState(initialFiltro || "todas");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const reload = useCallback(() => {
    api("/gestantes").then(setGestantes).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleDelete = async (g) => {
    if (!window.confirm(`Excluir "${g.nome}"?\n\nIsso apaga também todo o histórico dela (consultas, exames, partos, vacinas etc.) e não pode ser desfeito.`)) return;
    try {
      await api(`/gestantes/${g.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      alert("Erro ao excluir: " + e.message);
    }
  };

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!gestantes) return React.createElement("div", { className: "empty-state" }, "Carregando...");

  const filtered = gestantes.filter((g) => {
    if (search && !g.nome.toLowerCase().includes(search.toLowerCase())) return false;
    if (filtro === "risco" && !g.alto_risco) return false;
    if (filtro === "puerperio" && g.status !== "puerperio") return false;
    if (filtro === "gestante" && g.status !== "gestante") return false;
    return true;
  });

  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("div", null, React.createElement("h2", null, "Gestantes"), React.createElement("div", { className: "sub" }, gestantes.length, " pacientes cadastradas")), React.createElement("button", { className: "btn btn-primary", onClick: () => setShowForm(true) }, "+ Nova gestante")), React.createElement("div", { className: "card" }, React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" } }, React.createElement("input", { className: "search-input", placeholder: "Buscar por nome...", value: search, onChange: (e) => setSearch(e.target.value) }), React.createElement("div", { className: "chip-select" }, [["todas", "Todas"], ["gestante", "Gestantes"], ["puerperio", "Puérperas"], ["risco", "Alto risco"]].map(([k, l]) => (
              React.createElement("div", { key: k, className: `chip ${filtro === k ? "active" : ""}`, onClick: () => setFiltro(k) }, l)
            )))), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Paciente"), React.createElement("th", null, "IG"), React.createElement("th", null, "DPP"), React.createElement("th", null, "Convênio"), React.createElement("th", null, "Risco"), React.createElement("th", null, "Status"), React.createElement("th", null, "Ações"))), React.createElement("tbody", null, filtered.map((g) => (
              React.createElement("tr", { key: g.id, onClick: () => onOpenGestante(g.id) }, React.createElement("td", null, React.createElement("div", { className: "gestante-row" }, React.createElement("div", { className: "avatar-circle" }, initials(g.nome)), React.createElement("div", { className: "info" }, React.createElement("div", { className: "nome" }, g.nome), React.createElement("div", { className: "meta" }, g.telefone || "sem telefone")))), React.createElement("td", null, g.idade_gestacional ? g.idade_gestacional.texto : "—"), React.createElement("td", null, fmtDate(g.dpp)), React.createElement("td", null, g.convenio || "—"), React.createElement("td", null, g.alto_risco ? React.createElement("span", { className: "badge badge-danger" }, "Alto risco") : React.createElement("span", { className: "badge badge-ok" }, "Habitual")), React.createElement("td", { style: { textTransform: "capitalize" } }, React.createElement("span", { className: "badge badge-lavender" }, g.status)), React.createElement("td", { onClick: (e) => e.stopPropagation() }, React.createElement("div", { style: { display: "flex", gap: 6, justifyContent: "flex-end" } }, React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Editar", onClick: () => setEditing(g) }, "✏️ Editar"), React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Excluir", style: { color: "var(--danger)" }, onClick: () => handleDelete(g) }, "✕ Excluir"))))
            )), filtered.length === 0 && (
              React.createElement("tr", null, React.createElement("td", { colSpan: "7" }, React.createElement("div", { className: "empty-state" }, "Nenhuma gestante encontrada.")))
            )))), showForm && (
        React.createElement(GestanteFormModal, { onClose: () => setShowForm(false), onSaved: (g) => { setShowForm(false); reload(); onOpenGestante(g.id); } })
      ), editing && (
        React.createElement(GestanteFormModal, { initial: editing, onClose: () => setEditing(null), onSaved: () => { setEditing(null); reload(); } })
      ))
  );
}

function GestanteFormModal({ onClose, onSaved, initial }) {
  const [form, setForm] = useState(initial || {
    nome: "", data_nascimento: "", cpf: "", telefone: "", email: "", endereco: "", convenio: "SUS",
    tipo_sanguineo: "", num_gestacoes: 1, num_partos_normais: 0, num_cesareas: 0, num_abortos: 0,
    alergias: "", doencas_preexistentes: "", medicamentos_uso: "", dum: "", condicoes_risco: [],
    estado_civil: "", profissao: "", pessoa_referencia: "", telefone_referencia: "",
    altura: "", filhos_vivos: 0, status: "gestante",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const dpp = calcDppLocal(form.dum);
  const ig = calcIgLocal(form.dum);

  const submit = async () => {
    if (!form.nome) { setErr("Nome é obrigatório."); return; }
    setSaving(true);
    setErr(null);
    try {
      const saved = initial
        ? await api(`/gestantes/${initial.id}`, { method: "PUT", body: form })
        : await api("/gestantes", { method: "POST", body: form });
      onSaved(saved);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    React.createElement(Modal, { title: initial ? "Editar gestante" : "Cadastro da gestante", onClose: onClose, wide: true }, err && React.createElement("div", { className: "alert-banner" }, err), React.createElement("div", { className: "form-grid" }, React.createElement(Field, { label: "Nome completo", full: true }, React.createElement("input", { value: form.nome, onChange: (e) => set("nome", e.target.value) })), React.createElement(Field, { label: "Gestante?" }, React.createElement("div", { style: { display: "flex", gap: 8 } }, React.createElement("button", { type: "button", className: form.status !== "paciente" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("status", "gestante") }, "Sim"), React.createElement("button", { type: "button", className: form.status === "paciente" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("status", "paciente") }, "Não"))), React.createElement(Field, { label: "Data de nascimento" }, React.createElement("input", { type: "date", value: form.data_nascimento || "", onChange: (e) => set("data_nascimento", e.target.value) })), React.createElement(Field, { label: "CPF" }, React.createElement("input", { value: form.cpf || "", onChange: (e) => set("cpf", e.target.value), placeholder: "000.000.000-00" })), React.createElement(Field, { label: "Telefone" }, React.createElement("input", { value: form.telefone || "", onChange: (e) => set("telefone", e.target.value), placeholder: "(00) 00000-0000" })), React.createElement(Field, { label: "E-mail" }, React.createElement("input", { type: "email", value: form.email || "", onChange: (e) => set("email", e.target.value), placeholder: "paciente@email.com" })), React.createElement(Field, { label: "Convênio / SUS" }, React.createElement("input", { value: form.convenio || "", onChange: (e) => set("convenio", e.target.value) })), React.createElement(Field, { label: "Endereço", full: true }, React.createElement(EnderecoInput, { value: form.endereco, onChange: (v) => set("endereco", v) })), React.createElement(Field, { label: "Tipo sanguíneo" }, React.createElement("input", { value: form.tipo_sanguineo || "", onChange: (e) => set("tipo_sanguineo", e.target.value), placeholder: "ex: O+" })), React.createElement(Field, { label: "DUM (data última menstruação)" }, React.createElement("input", { type: "date", value: form.dum || "", onChange: (e) => set("dum", e.target.value) }))), form.dum && (
        React.createElement("div", { className: "badge badge-lavender", style: { marginTop: 10 } }, "IG estimada:", ig ? ig.texto : "—", " · DPP (Naegele): ", fmtDate(dpp))
      ), React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Dados complementares"), React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Estado civil" }, React.createElement("input", { value: form.estado_civil || "", onChange: (e) => set("estado_civil", e.target.value) })), React.createElement(Field, { label: "Profissão" }, React.createElement("input", { value: form.profissao || "", onChange: (e) => set("profissao", e.target.value) })), React.createElement(Field, { label: "Altura (m)" }, React.createElement("input", { type: "number", step: "0.01", value: form.altura || "", onChange: (e) => set("altura", e.target.value), placeholder: "ex: 1.65" })), React.createElement(Field, { label: "Filhos vivos" }, React.createElement("input", { type: "number", min: "0", value: form.filhos_vivos, onChange: (e) => set("filhos_vivos", +e.target.value) })), React.createElement(Field, { label: "Pessoa de referência" }, React.createElement("input", { value: form.pessoa_referencia || "", onChange: (e) => set("pessoa_referencia", e.target.value) })), React.createElement(Field, { label: "Telefone de referência" }, React.createElement("input", { value: form.telefone_referencia || "", onChange: (e) => set("telefone_referencia", e.target.value) }))), React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Histórico obstétrico"), React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Nº de gestações" }, React.createElement("input", { type: "number", min: "0", value: form.num_gestacoes, onChange: (e) => set("num_gestacoes", +e.target.value) })), React.createElement(Field, { label: "Partos normais" }, React.createElement("input", { type: "number", min: "0", value: form.num_partos_normais, onChange: (e) => set("num_partos_normais", +e.target.value) })), React.createElement(Field, { label: "Cesarianas" }, React.createElement("input", { type: "number", min: "0", value: form.num_cesareas, onChange: (e) => set("num_cesareas", +e.target.value) })), React.createElement(Field, { label: "Abortos" }, React.createElement("input", { type: "number", min: "0", value: form.num_abortos, onChange: (e) => set("num_abortos", +e.target.value) }))), React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Histórico médico"), React.createElement("div", { className: "form-grid" }, React.createElement(Field, { label: "Alergias" }, React.createElement("input", { value: form.alergias || "", onChange: (e) => set("alergias", e.target.value) })), React.createElement(Field, { label: "Doenças pré-existentes" }, React.createElement("input", { value: form.doencas_preexistentes || "", onChange: (e) => set("doencas_preexistentes", e.target.value) })), React.createElement(Field, { label: "Medicamentos em uso", full: true }, React.createElement("input", { value: form.medicamentos_uso || "", onChange: (e) => set("medicamentos_uso", e.target.value) }))), React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Condições de risco gestacional"), React.createElement(RiskPills, { value: form.condicoes_risco || [], onChange: (v) => set("condicoes_risco", v) }), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar")))
  );
}

function CadastroPage({ onSaved, onCancel }) {
  const [form, setForm] = useState({
    nome: "", data_nascimento: "", cpf: "", telefone: "", email: "", endereco: "", convenio: "SUS",
    tipo_sanguineo: "", num_gestacoes: 1, num_partos_normais: 0, num_cesareas: 0, num_abortos: 0,
    alergias: "", doencas_preexistentes: "", medicamentos_uso: "", dum: "", condicoes_risco: [],
    estado_civil: "", profissao: "", pessoa_referencia: "", telefone_referencia: "",
    altura: "", filhos_vivos: 0, status: "gestante",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const dpp = calcDppLocal(form.dum);
  const ig = calcIgLocal(form.dum);

  const submit = async () => {
    if (!form.nome) { setErr("Nome é obrigatório."); return; }
    setSaving(true);
    setErr(null);
    try {
      const saved = await api("/gestantes", { method: "POST", body: form });
      onSaved(saved.id);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    React.createElement("div", null,
      React.createElement("div", { className: "topbar" },
        React.createElement("div", null,
          React.createElement("h2", null, "Cadastros"),
          React.createElement("div", { className: "sub" }, "Cadastre uma nova paciente e colete todas as informações de uma vez")
        )
      ),
      err && React.createElement("div", { className: "alert-banner" }, err),
      React.createElement("div", { className: "card" },
        React.createElement("div", { className: "section-title" }, "Cadastrar nova paciente"),
        React.createElement("div", { className: "form-grid" },
          React.createElement(Field, { label: "Nome completo", full: true }, React.createElement("input", { value: form.nome, onChange: (e) => set("nome", e.target.value) })),
          React.createElement(Field, { label: "Gestante?" }, React.createElement("div", { style: { display: "flex", gap: 8 } }, React.createElement("button", { type: "button", className: form.status !== "paciente" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("status", "gestante") }, "Sim"), React.createElement("button", { type: "button", className: form.status === "paciente" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("status", "paciente") }, "Não"))),
          React.createElement(Field, { label: "Data de nascimento" }, React.createElement("input", { type: "date", value: form.data_nascimento || "", onChange: (e) => set("data_nascimento", e.target.value) })),
          React.createElement(Field, { label: "CPF" }, React.createElement("input", { value: form.cpf || "", onChange: (e) => set("cpf", e.target.value), placeholder: "000.000.000-00" })),
          React.createElement(Field, { label: "Telefone" }, React.createElement("input", { value: form.telefone || "", onChange: (e) => set("telefone", e.target.value), placeholder: "(00) 00000-0000" })),
          React.createElement(Field, { label: "E-mail" }, React.createElement("input", { type: "email", value: form.email || "", onChange: (e) => set("email", e.target.value), placeholder: "paciente@email.com" })),
          React.createElement(Field, { label: "Convênio / SUS" }, React.createElement("input", { value: form.convenio || "", onChange: (e) => set("convenio", e.target.value) })),
          React.createElement(Field, { label: "Endereço", full: true }, React.createElement(EnderecoInput, { value: form.endereco, onChange: (v) => set("endereco", v) })),
          React.createElement(Field, { label: "Tipo sanguíneo" }, React.createElement("input", { value: form.tipo_sanguineo || "", onChange: (e) => set("tipo_sanguineo", e.target.value), placeholder: "ex: O+" })),
          React.createElement(Field, { label: "DUM (data última menstruação)" }, React.createElement("input", { type: "date", value: form.dum || "", onChange: (e) => set("dum", e.target.value) }))
        ),
        form.dum && React.createElement("div", { className: "badge badge-lavender", style: { marginTop: 10 } }, "IG estimada:", ig ? ig.texto : "—", " · DPP (Naegele): ", fmtDate(dpp)),
        React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Dados complementares"),
        React.createElement("div", { className: "form-grid cols-3" },
          React.createElement(Field, { label: "Estado civil" }, React.createElement("input", { value: form.estado_civil || "", onChange: (e) => set("estado_civil", e.target.value) })),
          React.createElement(Field, { label: "Profissão" }, React.createElement("input", { value: form.profissao || "", onChange: (e) => set("profissao", e.target.value) })),
          React.createElement(Field, { label: "Altura (m)" }, React.createElement("input", { type: "number", step: "0.01", value: form.altura || "", onChange: (e) => set("altura", e.target.value), placeholder: "ex: 1.65" })),
          React.createElement(Field, { label: "Filhos vivos" }, React.createElement("input", { type: "number", min: "0", value: form.filhos_vivos, onChange: (e) => set("filhos_vivos", +e.target.value) })),
          React.createElement(Field, { label: "Pessoa de referência" }, React.createElement("input", { value: form.pessoa_referencia || "", onChange: (e) => set("pessoa_referencia", e.target.value) })),
          React.createElement(Field, { label: "Telefone de referência" }, React.createElement("input", { value: form.telefone_referencia || "", onChange: (e) => set("telefone_referencia", e.target.value) }))
        ),
        React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Histórico obstétrico"),
        React.createElement("div", { className: "form-grid cols-3" },
          React.createElement(Field, { label: "Nº de gestações" }, React.createElement("input", { type: "number", min: "0", value: form.num_gestacoes, onChange: (e) => set("num_gestacoes", +e.target.value) })),
          React.createElement(Field, { label: "Partos normais" }, React.createElement("input", { type: "number", min: "0", value: form.num_partos_normais, onChange: (e) => set("num_partos_normais", +e.target.value) })),
          React.createElement(Field, { label: "Cesarianas" }, React.createElement("input", { type: "number", min: "0", value: form.num_cesareas, onChange: (e) => set("num_cesareas", +e.target.value) })),
          React.createElement(Field, { label: "Abortos" }, React.createElement("input", { type: "number", min: "0", value: form.num_abortos, onChange: (e) => set("num_abortos", +e.target.value) }))
        ),
        React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Histórico médico"),
        React.createElement("div", { className: "form-grid" },
          React.createElement(Field, { label: "Alergias" }, React.createElement("input", { value: form.alergias || "", onChange: (e) => set("alergias", e.target.value) })),
          React.createElement(Field, { label: "Doenças pré-existentes" }, React.createElement("input", { value: form.doencas_preexistentes || "", onChange: (e) => set("doencas_preexistentes", e.target.value) })),
          React.createElement(Field, { label: "Medicamentos em uso", full: true }, React.createElement("input", { value: form.medicamentos_uso || "", onChange: (e) => set("medicamentos_uso", e.target.value) }))
        ),
        React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Condições de risco gestacional"),
        React.createElement(RiskPills, { value: form.condicoes_risco || [], onChange: (v) => set("condicoes_risco", v) }),
        React.createElement("div", { className: "modal-actions" },
          React.createElement("button", { className: "btn btn-ghost", onClick: onCancel }, "Cancelar"),
          React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar cadastro")
        )
      )
    )
  );
}

// ============================================================================
// Detalhe da gestante
// ============================================================================

function GestanteDetailPage({ gestanteId, onBack }) {
  const [g, setG] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("dados");
  const [editForm, setEditForm] = useState(false);

  const reload = useCallback(() => {
    api(`/gestantes/${gestanteId}`).then(setG).catch((e) => setError(e.message));
  }, [gestanteId]);

  useEffect(() => { reload(); }, [reload]);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!g) return React.createElement("div", { className: "empty-state" }, "Carregando ficha da paciente...");

  const tabs = [
    ["dados", "Dados gerais"],
    ["prenatal", "Prontuário"],
    ["exames", "Exames"],
    ["ultrassons", "Ultrassons"],
    ["vacinas", "Vacinas"],
    ["parto", "Parto & RN"],
    ["puerperio", "Puerpério"],
    ["timeline", "Linha do tempo"],
    ["cartao", "Cartão digital"],
  ];

  return (
    React.createElement("div", null, React.createElement("button", { className: "btn btn-ghost btn-sm", style: { marginBottom: 14 }, onClick: onBack }, "← Voltar para gestantes"), React.createElement("div", { className: "card", style: { marginBottom: 18 } }, React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 } }, React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "center" } }, React.createElement("div", { className: "avatar-circle", style: { width: 54, height: 54, fontSize: 18 } }, initials(g.nome)), React.createElement("div", null, React.createElement("h2", { style: { margin: 0 } }, g.nome), React.createElement("div", { className: "sub", style: { marginTop: 4 } }, g.convenio || "—", " · ", g.tipo_sanguineo || "tipo sang. não informado", " · ", g.telefone || "sem telefone"), React.createElement("div", { style: { marginTop: 8 } }, React.createElement("span", { className: "badge badge-lavender", style: { marginRight: 6 } }, g.status === "gestante" ? "Gestante" : g.status === "puerperio" ? "Puérpera" : "Finalizada"), g.idade_gestacional && React.createElement("span", { className: "badge badge-teal", style: { marginRight: 6 } }, "IG ", g.idade_gestacional.texto), g.dpp && React.createElement("span", { className: "badge badge-neutral", style: { marginRight: 6 } }, "DPP ", fmtDate(g.dpp)), g.alto_risco && React.createElement("span", { className: "badge badge-danger" }, "Alto risco")), g.condicoes_risco.length > 0 && (
                React.createElement("div", { style: { marginTop: 8 } }, g.condicoes_risco.map((c) => React.createElement("span", { key: c, className: "risk-tag" }, riskLabel(c))))
              ))), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => window.open(`${API_BASE}/gestantes/${g.id}/ficha/imprimir`, "_blank") }, "🖨️ Imprimir ficha"), React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setEditForm(true) }, "Editar cadastro"))), React.createElement("div", { className: "tabs" }, tabs.map(([k, l]) => (
          React.createElement("div", { key: k, className: `tab ${tab === k ? "active" : ""}`, onClick: () => setTab(k) }, l)
        ))), tab === "dados" && React.createElement(DadosGeraisTab, { g: g, reload: reload }), tab === "prenatal" && React.createElement(ProntuarioTab, { g: g, reload: reload }), tab === "exames" && React.createElement(ExamesTab, { g: g, reload: reload }), tab === "ultrassons" && React.createElement(UltrassonsTab, { g: g, reload: reload }), tab === "vacinas" && React.createElement(VacinasTab, { g: g, reload: reload }), tab === "parto" && React.createElement(PartoTab, { g: g, reload: reload }), tab === "puerperio" && React.createElement(PuerperioTab, { g: g, reload: reload }), tab === "timeline" && React.createElement(TimelineTab, { g: g }), tab === "cartao" && React.createElement(CartaoDigitalTab, { g: g }), editForm && (
        React.createElement(GestanteFormModal, { initial: g, onClose: () => setEditForm(false), onSaved: () => { setEditForm(false); reload(); } })
      ))
  );
}

function DadosGeraisTab({ g, reload }) {
  return (
    React.createElement(React.Fragment, null, React.createElement("div", { className: "grid grid-2" }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Dados pessoais"), React.createElement(InfoRow, { label: "Nome", value: g.nome }), React.createElement(InfoRow, { label: "Data de nascimento", value: fmtDate(g.data_nascimento) }), React.createElement(InfoRow, { label: "Idade", value: g.idade ? g.idade.texto : "—" }), React.createElement(InfoRow, { label: "Estado civil", value: g.estado_civil }), React.createElement(InfoRow, { label: "Profissão", value: g.profissao }), React.createElement(InfoRow, { label: "CPF", value: g.cpf }), React.createElement(InfoRow, { label: "Telefone", value: g.telefone }), React.createElement(InfoRow, { label: "E-mail", value: g.email ? (g.email + (g.email_verificado ? " ✓ verificado" : " (não verificado)")) : null }), React.createElement(InfoRow, { label: "Endereço", value: g.endereco }), React.createElement(InfoRow, { label: "Convênio", value: g.convenio }), React.createElement(InfoRow, { label: "Tipo sanguíneo", value: g.tipo_sanguineo }), React.createElement(InfoRow, { label: "Altura", value: g.altura ? `${g.altura} m` : null }), React.createElement(InfoRow, { label: "Pessoa de referência", value: g.pessoa_referencia }), React.createElement(InfoRow, { label: "Telefone de referência", value: g.telefone_referencia })), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Histórico obstétrico"), React.createElement(InfoRow, { label: "DUM", value: fmtDate(g.dum) }), React.createElement(InfoRow, { label: "DPP calculada", value: fmtDate(g.dpp) }), React.createElement(InfoRow, { label: "Idade gestacional", value: g.idade_gestacional ? g.idade_gestacional.texto : "—" }), React.createElement(InfoRow, { label: "Nº de gestações", value: g.num_gestacoes }), React.createElement(InfoRow, { label: "Partos normais", value: g.num_partos_normais }), React.createElement(InfoRow, { label: "Cesarianas", value: g.num_cesareas }), React.createElement(InfoRow, { label: "Abortos", value: g.num_abortos }), React.createElement(InfoRow, { label: "Filhos vivos", value: g.filhos_vivos })), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Histórico médico"), React.createElement(InfoRow, { label: "Alergias", value: g.alergias }), React.createElement(InfoRow, { label: "Doenças pré-existentes", value: g.doencas_preexistentes }), React.createElement(InfoRow, { label: "Medicamentos em uso", value: g.medicamentos_uso })), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Risco gestacional"), g.condicoes_risco.length === 0
          ? React.createElement("div", { className: "empty-state" }, "Gestação de risco habitual — nenhuma condição sinalizada.")
          : g.condicoes_risco.map((c) => React.createElement("span", { key: c, className: "risk-tag" }, riskLabel(c))))), React.createElement(AvaliacaoInicialCard, { g: g, reload: reload }))
  );
}

function AvaliacaoInicialCard({ g, reload }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(g.avaliacao_inicial || {});
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(g.avaliacao_inicial || {}); }, [g.avaliacao_inicial]);

  const toggle = (key) => setDraft((d) => ({ ...d, [key]: !d[key] }));
  const setTexto = (key, v) => setDraft((d) => ({ ...d, [key]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await api(`/gestantes/${g.id}`, { method: "PUT", body: { avaliacao_inicial: draft } });
      setEditing(false);
      reload();
    } finally { setSaving(false); }
  };

  return (
    React.createElement("div", { className: "card", style: { marginTop: 16 } }, React.createElement("div", { className: "section-title" }, "Avaliação inicial (ficha de início de pré-natal)", editing
        ? React.createElement("button", { className: "btn btn-primary btn-sm", onClick: save, disabled: saving }, saving ? "Salvando..." : "Salvar")
        : React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setEditing(true) }, "Editar")
      ), React.createElement("div", { className: "form-grid" }, AVALIACAO_INICIAL_TEXTO.map(([key, label]) => (
          React.createElement(Field, { key: key, label: label }, editing
              ? React.createElement("input", { value: draft[key] || "", onChange: (e) => setTexto(key, e.target.value) })
              : React.createElement("div", { style: { fontSize: 13, padding: "6px 0" } }, draft[key] || "—"))
        ))), AVALIACAO_INICIAL_GRUPOS.map((grupo) => (
        React.createElement("div", { key: grupo.titulo, style: { marginTop: 14 } }, React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--rose)", textTransform: "uppercase", marginBottom: 6 } }, grupo.titulo), React.createElement("div", { className: "checkbox-row" }, grupo.itens.map(([key, label]) => (
              editing
                ? React.createElement("div", { key: key, className: `checkbox-pill ${draft[key] ? "checked" : ""}`, onClick: () => toggle(key) }, draft[key] ? "✓" : "+", " ", label)
                : React.createElement("span", { key: key, className: `badge ${draft[key] ? "badge-danger" : "badge-neutral"}`, style: { marginRight: 6, marginBottom: 6, display: "inline-block" } }, label, ": ", draft[key] ? "Sim" : "Não")
            )))))))
  );
}

function InfoRow({ label, value }) {
  return (
    React.createElement("div", { style: { display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f2e9ee", fontSize: 13.5 } }, React.createElement("span", { style: { color: "var(--ink-soft)" } }, label), React.createElement("span", { style: { fontWeight: 600, textAlign: "right", maxWidth: "60%" } }, value || "—"))
  );
}

// ---- Prontuário (pré-natal / atendimentos) --------------------------------

const MESES_ABREV = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];

function fmtDuracao(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

function ProntuarioTab({ g, reload }) {
  const [subview, setSubview] = useState("historico");
  const [atendimentoAtivo, setAtendimentoAtivo] = useState(false);
  const [duracao, setDuracao] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState("Todos");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    if (!atendimentoAtivo) return;
    const id = setInterval(() => setDuracao((d) => d + 1), 1000);
    return () => clearInterval(id);
  }, [atendimentoAtivo]);

  const iniciarAtendimento = () => {
    setAtendimentoAtivo(true);
    setDuracao(0);
    setShowForm(true);
  };

  const primeiraConsulta = g.prenatal.length > 0
    ? g.prenatal.reduce((min, c) => (c.data && (!min || c.data < min) ? c.data : min), null)
    : null;

  const tiposDisponiveis = ["Todos", ...new Set(g.prenatal.map((c) => c.tipo_atendimento || "Atendimento"))];

  const historicoFiltrado = g.prenatal.filter((c) => {
    if (filtroTipo !== "Todos" && (c.tipo_atendimento || "Atendimento") !== filtroTipo) return false;
    if (busca) {
      const alvo = `${c.queixas || ""} ${c.hipotese_diagnostica || ""} ${fmtDate(c.data)}`.toLowerCase();
      if (!alvo.includes(busca.toLowerCase())) return false;
    }
    return true;
  });

  return (
    React.createElement("div", { style: { display: "flex", gap: 18, alignItems: "flex-start" } }, React.createElement("div", { style: { width: 210, flexShrink: 0, position: "sticky", top: 0 } }, React.createElement("button", { className: "btn btn-primary", style: { width: "100%", justifyContent: "center", marginBottom: 8 }, onClick: iniciarAtendimento }, "▶ Iniciar atendimento"), atendimentoAtivo && (
          React.createElement("div", { className: "badge badge-teal", style: { width: "100%", textAlign: "center", marginBottom: 14, display: "block", boxSizing: "border-box", padding: "8px 0" } }, "⏱", fmtDuracao(duracao))
        ), React.createElement("div", { className: "prontuario-nav" }, React.createElement("div", { className: `prontuario-nav-item ${subview === "historico" ? "active" : ""}`, onClick: () => setSubview("historico") }, "Histórico de Consulta"), React.createElement("div", { className: `prontuario-nav-item ${subview === "tabela" ? "active" : ""}`, onClick: () => setSubview("tabela") }, "Tabela de acompanhamento"), React.createElement("div", { className: `prontuario-nav-item ${subview === "anamnese" ? "active" : ""}`, onClick: () => setSubview("anamnese") }, "Transcrição da Anamnese"))), React.createElement("div", { style: { flex: 1, minWidth: 0 } }, React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "center" } }, React.createElement("div", { className: "avatar-circle", style: { width: 46, height: 46 } }, initials(g.nome)), React.createElement("div", null, React.createElement("div", { style: { fontWeight: 700, fontSize: 14.5 } }, g.nome), React.createElement("div", { className: "sub", style: { fontSize: 12.5, marginTop: 2 } }, React.createElement("b", null, "Idade:"), " ", g.idade ? g.idade.texto : "—", " &nbsp;·&nbsp; ", React.createElement("b", null, "Convênio:"), " ", g.convenio || "—", " &nbsp;·&nbsp; ", React.createElement("b", null, "Primeira consulta:"), " ", primeiraConsulta ? fmtDate(primeiraConsulta) : "Sem registro")))), React.createElement("div", { className: "grid grid-4", style: { marginBottom: 16 } }, React.createElement(AntecedenteCard, { label: "Antec. clínicos", field: "antecedentes_clinicos", value: g.antecedentes_clinicos, gestanteId: g.id, reload: reload }), React.createElement(AntecedenteCard, { label: "Antec. cirúrgicos", field: "antecedentes_cirurgicos", value: g.antecedentes_cirurgicos, gestanteId: g.id, reload: reload }), React.createElement(AntecedenteCard, { label: "Antec. familiares", field: "antecedentes_familiares", value: g.antecedentes_familiares, gestanteId: g.id, reload: reload }), React.createElement(AntecedenteCard, { label: "Hábitos", field: "habitos", value: g.habitos, gestanteId: g.id, reload: reload })), subview === "historico" && (
          React.createElement("div", null, React.createElement("div", { style: { display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" } }, React.createElement("input", { className: "search-input", placeholder: "Buscar por data, diagnóstico ou palavra-chave...", value: busca, onChange: (e) => setBusca(e.target.value) }), React.createElement("select", { value: filtroTipo, onChange: (e) => setFiltroTipo(e.target.value), style: { padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", fontSize: 13.5 } }, tiposDisponiveis.map((t) => React.createElement("option", { key: t, value: t }, t))), React.createElement("span", { style: { fontSize: 12.5, color: "var(--ink-soft)" } }, historicoFiltrado.length, " de ", g.prenatal.length, " atendimento(s)")), historicoFiltrado.length === 0 && React.createElement("div", { className: "card" }, React.createElement("div", { className: "empty-state" }, "Nenhum atendimento encontrado.")), historicoFiltrado.map((c) => {
              const [ano, mes] = (c.data || "").split("-");
              return (
                React.createElement("div", { key: c.id, className: "atendimento-card" }, React.createElement("div", { className: "atendimento-date" }, React.createElement("div", { className: "day" }, (c.data || "").split("-")[2] || "--"), React.createElement("div", { className: "mon" }, MESES_ABREV[(parseInt(mes, 10) || 1) - 1]), React.createElement("div", { className: "year" }, ano)), React.createElement("div", { className: "atendimento-content" }, React.createElement("div", { className: "atendimento-header" }, React.createElement("span", null, React.createElement("b", null, "Por:"), " ", c.profissional || "—"), React.createElement("span", { className: "badge badge-neutral" }, c.tipo_atendimento || "Atendimento")), c.queixas && React.createElement(AtendField, { label: "Queixa principal" }, c.queixas), c.exame_fisico && React.createElement(AtendField, { label: "Exame físico" }, c.exame_fisico), c.hma && React.createElement(AtendField, { label: "História da moléstia atual" }, c.hma), c.evolucao_clinica && React.createElement(AtendField, { label: "Histórico e antecedentes" }, c.evolucao_clinica), c.hipotese_diagnostica && (
                      React.createElement("div", { className: "atend-highlight atend-diag" }, React.createElement("div", { className: "atend-highlight-label" }, "Hipótese diagnóstica"), c.hipotese_diagnostica)
                    ), c.conduta && React.createElement(AtendField, { label: "Condutas" }, c.conduta), c.prescricao && (
                      React.createElement("div", { className: "atend-highlight atend-presc" }, React.createElement("div", { className: "atend-highlight-label" }, "Prescrição"), c.prescricao)
                    ), c.exames_solicitados && (
                      React.createElement("div", { className: "atend-highlight atend-exames" }, React.createElement("div", { className: "atend-highlight-label" }, "Exames solicitados"), c.exames_solicitados)
                    ), c.orientacoes && React.createElement(AtendField, { label: "Orientações" }, c.orientacoes), c.retorno && React.createElement(AtendField, { label: "Retorno" }, fmtDate(c.retorno))))
              );
            }))
        ), subview === "tabela" && (
          React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Tabela de acompanhamento"), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Data"), React.createElement("th", null, "Peso"), React.createElement("th", null, "PA"), React.createElement("th", null, "Alt. uterina"), React.createElement("th", null, "BCF"), React.createElement("th", null, "Edema"))), React.createElement("tbody", null, g.prenatal.map((c) => (
                  React.createElement("tr", { key: c.id }, React.createElement("td", null, fmtDate(c.data)), React.createElement("td", null, c.peso ? `${c.peso} kg` : "—"), React.createElement("td", null, c.pressao_arterial || "—"), React.createElement("td", null, c.altura_uterina ? `${c.altura_uterina} cm` : "—"), React.createElement("td", null, c.bcf ? `${c.bcf} bpm` : "—"), React.createElement("td", null, c.edema || "—"))
                )), g.prenatal.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "6" }, React.createElement("div", { className: "empty-state" }, "Nenhum registro ainda."))))))
        ), subview === "anamnese" && (
          React.createElement(AnamneseEditor, { gestanteId: g.id, value: g.anamnese, reload: reload })
        )), showForm && (
        React.createElement(PrenatalFormModal, { gestanteId: g.id, onClose: () => { setShowForm(false); setAtendimentoAtivo(false); }, onSaved: () => { setShowForm(false); setAtendimentoAtivo(false); reload(); } })
      ))
  );
}

function AtendField({ label, children }) {
  return (
    React.createElement("div", { style: { marginBottom: 8 } }, React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--ink-soft)", textTransform: "uppercase" } }, label), React.createElement("div", { style: { fontSize: 13 } }, children))
  );
}

function AntecedenteCard({ label, field, value, gestanteId, reload }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => { setDraft(value || ""); }, [value]);

  const save = async () => {
    setEditing(false);
    if (draft === (value || "")) return;
    await api(`/gestantes/${gestanteId}`, { method: "PUT", body: { [field]: draft } });
    reload();
  };

  return (
    React.createElement("div", { className: "card", style: { padding: 14 } }, React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--rose)", textTransform: "uppercase", marginBottom: 6 } }, label), editing ? (
        React.createElement("textarea", { autoFocus: true, value: draft, onChange: (e) => setDraft(e.target.value), onBlur: save, style: { width: "100%", minHeight: 60, border: "1px solid var(--rose)", borderRadius: 8, padding: 6, fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" } })
      ) : (
        React.createElement("div", { onClick: () => setEditing(true), style: { fontSize: 12.5, cursor: "text", color: value ? "var(--ink)" : "var(--rose)", minHeight: 20 } }, value || "Inserir informação")
      ))
  );
}

function AnamneseEditor({ gestanteId, value, reload }) {
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value || ""); }, [value]);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/gestantes/${gestanteId}`, { method: "PUT", body: { anamnese: draft } });
      reload();
    } finally { setSaving(false); }
  };

  return (
    React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Transcrição da Anamnese", React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: save, disabled: saving }, saving ? "Salvando..." : "Salvar")), React.createElement("textarea", { value: draft, onChange: (e) => setDraft(e.target.value), placeholder: "Registre aqui a anamnese da paciente (pode ser preenchida manualmente durante o atendimento)...", style: { width: "100%", minHeight: 260, border: "1px solid var(--border)", borderRadius: 9, padding: 12, fontSize: 13.5, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" } }))
  );
}

function MiniStat({ label, value }) {
  return (
    React.createElement("div", { style: { background: "#faf5f7", borderRadius: 8, padding: "8px 10px" } }, React.createElement("div", { style: { fontSize: 10.5, color: "var(--ink-soft)", fontWeight: 700, textTransform: "uppercase" } }, label), React.createElement("div", { style: { fontSize: 14, fontWeight: 700 } }, value))
  );
}

function PrenatalFormModal({ gestanteId, onClose, onSaved }) {
  const [form, setForm] = useState({
    data: new Date().toISOString().slice(0, 10), profissional: "", tipo_atendimento: "Atendimento",
    peso: "", altura_uterina: "", pressao_arterial: "",
    bcf: "", fc: "", fr: "", temperatura: "", movimentos_fetais: "", edema: "", queixas: "", exame_fisico: "", hma: "",
    evolucao_clinica: "", hipotese_diagnostica: "", conduta: "", prescricao: "", exames_solicitados: "", orientacoes: "", retorno: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await api(`/gestantes/${gestanteId}/prenatal`, { method: "POST", body: form });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    React.createElement(Modal, { title: "Novo atendimento", onClose: onClose, wide: true }, React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Data" }, React.createElement("input", { type: "date", value: form.data, onChange: (e) => set("data", e.target.value) })), React.createElement(Field, { label: "Profissional (Por:)" }, React.createElement("input", { value: form.profissional, onChange: (e) => set("profissional", e.target.value), placeholder: "Nome do profissional" })), React.createElement(Field, { label: "Tipo de atendimento" }, React.createElement("select", { value: form.tipo_atendimento, onChange: (e) => set("tipo_atendimento", e.target.value) }, React.createElement("option", null, "Atendimento"), React.createElement("option", null, "Retorno"), React.createElement("option", null, "Urgência"), React.createElement("option", null, "Teleconsulta"))), React.createElement(Field, { label: "Peso (kg)" }, React.createElement("input", { type: "number", step: "0.1", value: form.peso, onChange: (e) => set("peso", e.target.value) })), React.createElement(Field, { label: "Altura uterina (cm)" }, React.createElement("input", { type: "number", step: "0.1", value: form.altura_uterina, onChange: (e) => set("altura_uterina", e.target.value) })), React.createElement(Field, { label: "Pressão arterial" }, React.createElement("input", { placeholder: "120x80", value: form.pressao_arterial, onChange: (e) => set("pressao_arterial", e.target.value) })), React.createElement(Field, { label: "BCF (bpm)" }, React.createElement("input", { type: "number", value: form.bcf, onChange: (e) => set("bcf", e.target.value) })), React.createElement(Field, { label: "FC (bpm)" }, React.createElement("input", { type: "number", value: form.fc, onChange: (e) => set("fc", e.target.value) })), React.createElement(Field, { label: "FR (irpm)" }, React.createElement("input", { type: "number", value: form.fr, onChange: (e) => set("fr", e.target.value) })), React.createElement(Field, { label: "Temperatura (°C)" }, React.createElement("input", { type: "number", step: "0.1", value: form.temperatura, onChange: (e) => set("temperatura", e.target.value) })), React.createElement(Field, { label: "Edema" }, React.createElement("input", { value: form.edema, onChange: (e) => set("edema", e.target.value), placeholder: "ausente / +/4+ / ++/4+..." })), React.createElement(Field, { label: "Movimentos fetais", full: true }, React.createElement("input", { value: form.movimentos_fetais, onChange: (e) => set("movimentos_fetais", e.target.value) })), React.createElement(Field, { label: "Queixa principal", full: true }, React.createElement("textarea", { value: form.queixas, onChange: (e) => set("queixas", e.target.value) })), React.createElement(Field, { label: "Exame físico", full: true }, React.createElement("textarea", { value: form.exame_fisico, onChange: (e) => set("exame_fisico", e.target.value) })), React.createElement(Field, { label: "História da moléstia atual (HMA)", full: true }, React.createElement("textarea", { value: form.hma, onChange: (e) => set("hma", e.target.value) })), React.createElement(Field, { label: "Histórico e antecedentes", full: true }, React.createElement("textarea", { value: form.evolucao_clinica, onChange: (e) => set("evolucao_clinica", e.target.value) })), React.createElement(Field, { label: "Hipótese diagnóstica", full: true }, React.createElement("input", { value: form.hipotese_diagnostica, onChange: (e) => set("hipotese_diagnostica", e.target.value), placeholder: "ex: K29 - Gastrite e duodenite" })), React.createElement(Field, { label: "Condutas", full: true }, React.createElement("textarea", { value: form.conduta, onChange: (e) => set("conduta", e.target.value) })), React.createElement(Field, { label: "Prescrição", full: true }, React.createElement("textarea", { value: form.prescricao, onChange: (e) => set("prescricao", e.target.value) })), React.createElement(Field, { label: "Exames solicitados", full: true }, React.createElement("textarea", { value: form.exames_solicitados, onChange: (e) => set("exames_solicitados", e.target.value) })), React.createElement(Field, { label: "Orientações", full: true }, React.createElement("textarea", { value: form.orientacoes, onChange: (e) => set("orientacoes", e.target.value) })), React.createElement(Field, { label: "Data de retorno" }, React.createElement("input", { type: "date", value: form.retorno, onChange: (e) => set("retorno", e.target.value) }))), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar consulta")))
  );
}

// ---- Exames -------------------------------------------------------------

function ExamesTab({ g, reload }) {
  const [showForm, setShowForm] = useState(false);
  const [showPainel, setShowPainel] = useState(false);

  const markDone = async (exame) => {
    const resultado = prompt(`Resultado de "${exame.tipo}":`, exame.resultado || "");
    if (resultado === null) return;
    await api(`/exames/${exame.id}`, { method: "PUT", body: { status: "realizado", resultado } });
    reload();
  };

  const imprimirOrientacoesPapanicolau = (exame) => {
    window.open(`${API_BASE}/exames/${exame.id}/papanicolau/imprimir`, "_blank");
  };

  const solicitacoes = g.solicitacoes_exames || [];

  return (
    React.createElement("div", null, React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { className: "section-title" }, "Exames (", g.exames.length, ")", React.createElement("div", { style: { display: "flex", gap: 8 } }, React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => setShowPainel(true) }, "🖨️ Solicitar exames (painel pré-natal)"), React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setShowForm(true) }, "+ Solicitar exame"))), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Exame"), React.createElement("th", null, "Data"), React.createElement("th", null, "Status"), React.createElement("th", null, "Resultado"), React.createElement("th", null))), React.createElement("tbody", null, g.exames.map((e) => (
            React.createElement("tr", { key: e.id }, React.createElement("td", null, e.tipo, e.horario ? ` · ${e.horario}` : ""), React.createElement("td", null, fmtDate(e.data)), React.createElement("td", null, React.createElement(StatusBadge, { status: e.status })), React.createElement("td", null, e.resultado || "—"), React.createElement("td", null, React.createElement("div", { style: { display: "flex", gap: 6 } }, e.status !== "realizado" && React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => markDone(e) }, "Registrar resultado"), e.tipo === "Papanicolau (Preventivo)" && React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => imprimirOrientacoesPapanicolau(e) }, "🖨️ Orientações"))))
          )), g.exames.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "5" }, React.createElement("div", { className: "empty-state" }, "Nenhum exame solicitado.")))))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Solicitações de exames impressas (", solicitacoes.length, ")"), solicitacoes.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhuma solicitação gerada ainda."), solicitacoes.map((s) => (
        React.createElement("div", { key: s.id, className: "gestante-card" }, React.createElement("div", null, React.createElement("div", { className: "nome" }, fmtDate(s.data), " · ", s.itens.length, " exame(s)"), React.createElement("div", { className: "meta" }, s.profissional)), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => window.open(`${API_BASE}/gestantes/${g.id}/solicitacoes-exames/${s.id}/imprimir`, "_blank") }, "🖨️ Reimprimir"))
      ))), showForm && (
        React.createElement(SimpleFormModal, { title: "Solicitar exame", fields: [
            { key: "tipo", label: "Tipo de exame", type: "select", options: EXAME_TIPOS },
            { key: "data", label: "Data da solicitação", type: "date", default: new Date().toISOString().slice(0, 10) },
            { key: "horario", label: "Horário (se aplicável)", type: "time" },
          ], onClose: () => setShowForm(false), onSubmit: async (body) => { await api(`/gestantes/${g.id}/exames`, { method: "POST", body: { ...body, status: "pendente" } }); setShowForm(false); reload(); } })
      ), showPainel && (
        React.createElement(SolicitacaoExamesModal, { gestanteId: g.id, onClose: () => setShowPainel(false), onSaved: (s) => { setShowPainel(false); reload(); window.open(`${API_BASE}/gestantes/${g.id}/solicitacoes-exames/${s.id}/imprimir`, "_blank"); } })
      ))
  );
}

function SolicitacaoExamesModal({ gestanteId, onClose, onSaved }) {
  const [itens, setItens] = useState([]);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [observacoes, setObservacoes] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (item) => {
    setItens((cur) => cur.includes(item) ? cur.filter((i) => i !== item) : [...cur, item]);
  };

  const submit = async () => {
    setSaving(true);
    try {
      const saved = await api(`/gestantes/${gestanteId}/solicitacoes-exames`, { method: "POST", body: { itens, data, observacoes } });
      onSaved(saved);
    } finally { setSaving(false); }
  };

  return (
    React.createElement(Modal, { title: "Solicitação de exames laboratoriais — painel pré-natal", onClose: onClose, wide: true },
      React.createElement("div", { className: "form-grid" }, React.createElement(Field, { label: "Data da solicitação" }, React.createElement("input", { type: "date", value: data, onChange: (e) => setData(e.target.value) }))),
      React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--rose)", textTransform: "uppercase", margin: "12px 0 6px" } }, "Selecione os exames"),
      React.createElement("div", { className: "checkbox-row" }, PAINEL_EXAMES_PRENATAL.map((item) => (
          React.createElement("div", { key: item, className: `checkbox-pill ${itens.includes(item) ? "checked" : ""}`, onClick: () => toggle(item) }, itens.includes(item) ? "✓" : "+", " ", item)
        ))),
      React.createElement(Field, { label: "Observações", full: true }, React.createElement("textarea", { value: observacoes, onChange: (e) => setObservacoes(e.target.value) })),
      React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving || itens.length === 0 }, saving ? "Gerando..." : "Gerar e imprimir")))
  );
}

// Formulário simples e genérico para modais curtos
function SimpleFormModal({ title, fields, onClose, onSubmit, wide }) {
  const initial = {};
  fields.forEach((f) => { initial[f.key] = f.default ?? ""; });
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try { await onSubmit(form); } finally { setSaving(false); }
  };

  return (
    React.createElement(Modal, { title: title, onClose: onClose, wide: wide }, React.createElement("div", { className: "form-grid" }, fields.map((f) => (
          React.createElement(Field, { key: f.key, label: f.label, full: f.full }, f.type === "select" ? (
              React.createElement("select", { value: form[f.key], onChange: (e) => set(f.key, e.target.value) }, React.createElement("option", { value: "" }, "Selecione..."), f.options.map((o) => React.createElement("option", { key: o, value: o }, o)))
            ) : f.type === "textarea" ? (
              React.createElement("textarea", { value: form[f.key], onChange: (e) => set(f.key, e.target.value) })
            ) : (
              React.createElement("input", { type: f.type || "text", value: form[f.key], onChange: (e) => set(f.key, e.target.value) })
            ))
        ))), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar")))
  );
}

// ---- Ultrassons -----------------------------------------------------------

function UltrassonsTab({ g, reload }) {
  const [showForm, setShowForm] = useState(false);
  const pesosFetais = [...g.ultrassons].reverse().map((u) => ({ x: u.idade_gestacional || fmtDate(u.data), y: u.peso_fetal }));

  return (
    React.createElement("div", null, React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { className: "section-title" }, "Crescimento fetal — peso estimado", React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setShowForm(true) }, "+ Novo ultrassom")), React.createElement(MiniChart, { points: pesosFetais, color: "#7e57c2", unit: "g" })), React.createElement("div", { className: "grid grid-2" }, g.ultrassons.map((u) => (
          React.createElement("div", { key: u.id, className: "card" }, React.createElement("div", { className: "section-title" }, fmtDate(u.data), " · IG ", u.idade_gestacional || "—"), React.createElement(InfoRow, { label: "Peso fetal estimado", value: u.peso_fetal ? `${u.peso_fetal} g` : "—" }), React.createElement(InfoRow, { label: "Sexo", value: u.sexo }), React.createElement(InfoRow, { label: "Placenta", value: u.placenta }), React.createElement(InfoRow, { label: "Líquido amniótico", value: u.liquido_amniotico }), React.createElement(InfoRow, { label: "BCF", value: u.bcf ? `${u.bcf} bpm` : "—" }), React.createElement(InfoRow, { label: "Comprimento", value: u.comprimento ? `${u.comprimento} cm` : "—" }), React.createElement(InfoRow, { label: "Circunf. cefálica", value: u.circunferencia_cefalica ? `${u.circunferencia_cefalica} cm` : "—" }), React.createElement(InfoRow, { label: "Percentil", value: u.percentil }), u.observacoes && React.createElement("p", { style: { fontSize: 13, marginTop: 8 } }, React.createElement("b", null, "Obs:"), " ", u.observacoes))
        )), g.ultrassons.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum ultrassom registrado.")), showForm && (
        React.createElement(UltrassomFormModal, { gestanteId: g.id, onClose: () => setShowForm(false), onSaved: () => { setShowForm(false); reload(); } })
      ))
  );
}

function UltrassomFormModal({ gestanteId, onClose, onSaved }) {
  const [form, setForm] = useState({
    data: new Date().toISOString().slice(0, 10), idade_gestacional: "", peso_fetal: "", sexo: "",
    placenta: "", liquido_amniotico: "", bcf: "", comprimento: "", circunferencia_cefalica: "",
    percentil: "", observacoes: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async () => {
    setSaving(true);
    try { await api(`/gestantes/${gestanteId}/ultrassons`, { method: "POST", body: form }); onSaved(); } finally { setSaving(false); }
  };
  return (
    React.createElement(Modal, { title: "Novo ultrassom", onClose: onClose, wide: true }, React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Data" }, React.createElement("input", { type: "date", value: form.data, onChange: (e) => set("data", e.target.value) })), React.createElement(Field, { label: "Idade gestacional" }, React.createElement("input", { placeholder: "ex: 22s3d", value: form.idade_gestacional, onChange: (e) => set("idade_gestacional", e.target.value) })), React.createElement(Field, { label: "Peso fetal (g)" }, React.createElement("input", { type: "number", value: form.peso_fetal, onChange: (e) => set("peso_fetal", e.target.value) })), React.createElement(Field, { label: "Sexo" }, React.createElement("select", { value: form.sexo, onChange: (e) => set("sexo", e.target.value) }, React.createElement("option", { value: "" }, "Não identificado"), React.createElement("option", null, "Masculino"), React.createElement("option", null, "Feminino"))), React.createElement(Field, { label: "Placenta" }, React.createElement("input", { value: form.placenta, onChange: (e) => set("placenta", e.target.value) })), React.createElement(Field, { label: "Líquido amniótico" }, React.createElement("input", { value: form.liquido_amniotico, onChange: (e) => set("liquido_amniotico", e.target.value) })), React.createElement(Field, { label: "BCF (bpm)" }, React.createElement("input", { type: "number", value: form.bcf, onChange: (e) => set("bcf", e.target.value) })), React.createElement(Field, { label: "Comprimento (cm)" }, React.createElement("input", { type: "number", step: "0.1", value: form.comprimento, onChange: (e) => set("comprimento", e.target.value) })), React.createElement(Field, { label: "Circunf. cefálica (cm)" }, React.createElement("input", { type: "number", step: "0.1", value: form.circunferencia_cefalica, onChange: (e) => set("circunferencia_cefalica", e.target.value) })), React.createElement(Field, { label: "Percentil" }, React.createElement("input", { value: form.percentil, onChange: (e) => set("percentil", e.target.value) })), React.createElement(Field, { label: "Observações", full: true }, React.createElement("textarea", { value: form.observacoes, onChange: (e) => set("observacoes", e.target.value) }))), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar")))
  );
}

// ---- Vacinas -------------------------------------------------------------

function VacinasTab({ g, reload }) {
  const [showForm, setShowForm] = useState(false);
  const markApplied = async (v) => {
    const data = prompt(`Data de aplicação de "${v.tipo}" (AAAA-MM-DD):`, new Date().toISOString().slice(0, 10));
    if (!data) return;
    await api(`/vacinas/${v.id}`, { method: "PUT", body: { status: "aplicada", data_aplicacao: data } });
    reload();
  };
  return (
    React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Controle de vacinas", React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setShowForm(true) }, "+ Registrar vacina")), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Vacina"), React.createElement("th", null, "Dose"), React.createElement("th", null, "Data aplicação"), React.createElement("th", null, "Status"), React.createElement("th", null))), React.createElement("tbody", null, g.vacinas.map((v) => (
            React.createElement("tr", { key: v.id }, React.createElement("td", null, v.tipo), React.createElement("td", null, v.dose || "—"), React.createElement("td", null, fmtDate(v.data_aplicacao)), React.createElement("td", null, React.createElement(StatusBadge, { status: v.status })), React.createElement("td", null, v.status !== "aplicada" && React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => markApplied(v) }, "Marcar aplicada")))
          )), g.vacinas.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "5" }, React.createElement("div", { className: "empty-state" }, "Nenhuma vacina registrada."))))), showForm && (
        React.createElement(SimpleFormModal, { title: "Registrar vacina", fields: [
            { key: "tipo", label: "Vacina", type: "select", options: VACINA_TIPOS },
            { key: "dose", label: "Dose", default: "Dose única" },
          ], onClose: () => setShowForm(false), onSubmit: async (body) => { await api(`/gestantes/${g.id}/vacinas`, { method: "POST", body: { ...body, status: "pendente" } }); setShowForm(false); reload(); } })
      ))
  );
}

// ---- Parto & Recém-nascido ------------------------------------------------

function PartoTab({ g, reload }) {
  const [showForm, setShowForm] = useState(false);
  return (
    React.createElement("div", null, g.partos.length === 0 && (
        React.createElement("div", { className: "card" }, React.createElement("div", { className: "empty-state" }, "Nenhum parto registrado ainda."), React.createElement("div", { style: { textAlign: "center" } }, React.createElement("button", { className: "btn btn-primary", onClick: () => setShowForm(true) }, "Registrar parto")))
      ), g.partos.map((p) => (
        React.createElement("div", { key: p.id, className: "grid grid-2", style: { marginBottom: 16 } }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Parto — ", fmtDate(p.data)), React.createElement(InfoRow, { label: "Tipo", value: p.tipo }), React.createElement(InfoRow, { label: "Hora", value: p.hora }), React.createElement(InfoRow, { label: "Idade gestacional", value: p.idade_gestacional_semanas ? `${p.idade_gestacional_semanas} semanas` : "—" }), React.createElement(InfoRow, { label: "Médico(a)", value: p.medico }), React.createElement(InfoRow, { label: "Equipe", value: p.equipe }), React.createElement(InfoRow, { label: "Complicações", value: p.complicacoes || "Nenhuma" })), p.recem_nascidos.map((rn) => (
            React.createElement("div", { key: rn.id, className: "card" }, React.createElement("div", { className: "section-title" }, "Recém-nascido: ", rn.nome || "—"), React.createElement(InfoRow, { label: "Sexo", value: rn.sexo }), React.createElement(InfoRow, { label: "Peso", value: rn.peso ? `${rn.peso} kg` : "—" }), React.createElement(InfoRow, { label: "Altura", value: rn.altura ? `${rn.altura} cm` : "—" }), React.createElement(InfoRow, { label: "Perímetro cefálico", value: rn.perimetro_cefalico ? `${rn.perimetro_cefalico} cm` : "—" }), React.createElement(InfoRow, { label: "Apgar 1min / 5min", value: `${rn.apgar1 ?? "—"} / ${rn.apgar5 ?? "—"}` }), React.createElement(InfoRow, { label: "Vitamina K", value: rn.vitamina_k }), React.createElement(InfoRow, { label: "Teste do pezinho", value: rn.teste_pezinho }), React.createElement(InfoRow, { label: "Teste da orelhinha", value: rn.teste_orelhinha }), React.createElement(InfoRow, { label: "Teste do coraçãozinho", value: rn.teste_coracaozinho }))
          )))
      )), showForm && (
        React.createElement(PartoFormModal, { gestanteId: g.id, onClose: () => setShowForm(false), onSaved: () => { setShowForm(false); reload(); } })
      ))
  );
}

function PartoFormModal({ gestanteId, onClose, onSaved }) {
  const [form, setForm] = useState({
    tipo: "normal", data: new Date().toISOString().slice(0, 10), hora: "", idade_gestacional_semanas: "",
    medico: "", equipe: "", complicacoes: "",
    recem_nascido: { nome: "", sexo: "", peso: "", altura: "", perimetro_cefalico: "", apgar1: "", apgar5: "", vitamina_k: "Aplicada", teste_pezinho: "", teste_orelhinha: "", teste_coracaozinho: "" },
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setRn = (k, v) => setForm((f) => ({ ...f, recem_nascido: { ...f.recem_nascido, [k]: v } }));

  const submit = async () => {
    setSaving(true);
    try { await api(`/gestantes/${gestanteId}/parto`, { method: "POST", body: form }); onSaved(); } finally { setSaving(false); }
  };

  return (
    React.createElement(Modal, { title: "Registrar parto", onClose: onClose, wide: true }, React.createElement("h4", { style: { margin: "0 0 8px" } }, "Dados do parto"), React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Tipo" }, React.createElement("select", { value: form.tipo, onChange: (e) => set("tipo", e.target.value) }, PARTO_TIPOS.map((t) => React.createElement("option", { key: t, value: t }, t)))), React.createElement(Field, { label: "Data" }, React.createElement("input", { type: "date", value: form.data, onChange: (e) => set("data", e.target.value) })), React.createElement(Field, { label: "Hora" }, React.createElement("input", { type: "time", value: form.hora, onChange: (e) => set("hora", e.target.value) })), React.createElement(Field, { label: "Idade gestacional (semanas)" }, React.createElement("input", { type: "number", value: form.idade_gestacional_semanas, onChange: (e) => set("idade_gestacional_semanas", e.target.value) })), React.createElement(Field, { label: "Médico(a)" }, React.createElement("input", { value: form.medico, onChange: (e) => set("medico", e.target.value) })), React.createElement(Field, { label: "Equipe" }, React.createElement("input", { value: form.equipe, onChange: (e) => set("equipe", e.target.value) })), React.createElement(Field, { label: "Complicações", full: true }, React.createElement("input", { value: form.complicacoes, onChange: (e) => set("complicacoes", e.target.value) }))), React.createElement("h4", { style: { margin: "18px 0 8px" } }, "Recém-nascido"), React.createElement("div", { className: "form-grid cols-3" }, React.createElement(Field, { label: "Nome", full: true }, React.createElement("input", { value: form.recem_nascido.nome, onChange: (e) => setRn("nome", e.target.value) })), React.createElement(Field, { label: "Sexo" }, React.createElement("select", { value: form.recem_nascido.sexo, onChange: (e) => setRn("sexo", e.target.value) }, React.createElement("option", { value: "" }, "Selecione"), React.createElement("option", null, "Masculino"), React.createElement("option", null, "Feminino"))), React.createElement(Field, { label: "Peso (kg)" }, React.createElement("input", { type: "number", step: "0.01", value: form.recem_nascido.peso, onChange: (e) => setRn("peso", e.target.value) })), React.createElement(Field, { label: "Altura (cm)" }, React.createElement("input", { type: "number", step: "0.1", value: form.recem_nascido.altura, onChange: (e) => setRn("altura", e.target.value) })), React.createElement(Field, { label: "Perímetro cefálico (cm)" }, React.createElement("input", { type: "number", step: "0.1", value: form.recem_nascido.perimetro_cefalico, onChange: (e) => setRn("perimetro_cefalico", e.target.value) })), React.createElement(Field, { label: "Apgar 1 min" }, React.createElement("input", { type: "number", min: "0", max: "10", value: form.recem_nascido.apgar1, onChange: (e) => setRn("apgar1", e.target.value) })), React.createElement(Field, { label: "Apgar 5 min" }, React.createElement("input", { type: "number", min: "0", max: "10", value: form.recem_nascido.apgar5, onChange: (e) => setRn("apgar5", e.target.value) })), React.createElement(Field, { label: "Vitamina K" }, React.createElement("input", { value: form.recem_nascido.vitamina_k, onChange: (e) => setRn("vitamina_k", e.target.value) })), React.createElement(Field, { label: "Teste do pezinho" }, React.createElement("input", { value: form.recem_nascido.teste_pezinho, onChange: (e) => setRn("teste_pezinho", e.target.value), placeholder: "Realizado / Agendado" })), React.createElement(Field, { label: "Teste da orelhinha" }, React.createElement("input", { value: form.recem_nascido.teste_orelhinha, onChange: (e) => setRn("teste_orelhinha", e.target.value), placeholder: "Realizado / Agendado" })), React.createElement(Field, { label: "Teste do coraçãozinho" }, React.createElement("input", { value: form.recem_nascido.teste_coracaozinho, onChange: (e) => setRn("teste_coracaozinho", e.target.value), placeholder: "Realizado / Agendado" }))), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Registrar parto")))
  );
}

// ---- Puerpério -------------------------------------------------------------

function PuerperioTab({ g, reload }) {
  const [showForm, setShowForm] = useState(false);
  return (
    React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Acompanhamento de puerpério", React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setShowForm(true) }, "+ Novo registro")), g.puerperios.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum registro de puerpério ainda."), g.puerperios.map((p) => (
        React.createElement("div", { key: p.id, className: "gestante-card", style: { display: "block" } }, React.createElement("strong", null, fmtDate(p.data)), React.createElement(InfoRow, { label: "Amamentação", value: p.amamentacao }), React.createElement(InfoRow, { label: "Cicatrização", value: p.cicatrizacao }), React.createElement(InfoRow, { label: "Pressão", value: p.pressao }), React.createElement(InfoRow, { label: "Sangramento", value: p.sangramento }), React.createElement(InfoRow, { label: "Humor", value: p.humor }), React.createElement(InfoRow, { label: "Consulta de retorno", value: fmtDate(p.consulta_retorno) }))
      )), showForm && (
        React.createElement(SimpleFormModal, { title: "Registro de puerpério", wide: true, fields: [
            { key: "data", label: "Data", type: "date", default: new Date().toISOString().slice(0, 10) },
            { key: "amamentacao", label: "Amamentação", type: "textarea", full: true },
            { key: "cicatrizacao", label: "Cicatrização", full: true },
            { key: "pressao", label: "Pressão arterial" },
            { key: "sangramento", label: "Sangramento" },
            { key: "humor", label: "Humor / estado emocional", full: true },
            { key: "consulta_retorno", label: "Consulta de retorno", type: "date" },
          ], onClose: () => setShowForm(false), onSubmit: async (body) => { await api(`/gestantes/${g.id}/puerperio`, { method: "POST", body }); setShowForm(false); reload(); } })
      ))
  );
}

// ---- Linha do tempo ---------------------------------------------------------

function TimelineTab({ g }) {
  const events = [];
  g.prenatal.forEach((c) => events.push({ date: c.data, title: "Consulta de pré-natal", desc: c.evolucao_clinica || c.queixas || "Consulta de rotina" }));
  g.exames.forEach((e) => events.push({ date: e.data, title: `Exame: ${e.tipo}`, desc: e.status === "realizado" ? `Resultado: ${e.resultado || "—"}` : "Pendente" }));
  g.ultrassons.forEach((u) => events.push({ date: u.data, title: `Ultrassom (${u.idade_gestacional || "—"})`, desc: u.observacoes || `Peso fetal: ${u.peso_fetal || "—"}g` }));
  g.vacinas.filter((v) => v.data_aplicacao).forEach((v) => events.push({ date: v.data_aplicacao, title: `Vacina: ${v.tipo}`, desc: v.dose || "" }));
  g.partos.forEach((p) => events.push({ date: p.data, title: `Parto (${p.tipo})`, desc: `${p.medico || ""} ${p.complicacoes ? "· " + p.complicacoes : ""}` }));
  g.puerperios.forEach((p) => events.push({ date: p.data, title: "Registro de puerpério", desc: p.amamentacao || "" }));

  events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Linha do tempo da gestação"), events.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum evento registrado ainda."), React.createElement("div", { className: "timeline" }, events.map((e, i) => (
          React.createElement("div", { className: "timeline-item", key: i }, React.createElement("div", { className: "dot-col" }, React.createElement("div", { className: "dot" }), React.createElement("div", { className: "line" })), React.createElement("div", { className: "content" }, React.createElement("div", { className: "date" }, fmtDate(e.date)), React.createElement("div", { className: "title" }, e.title), React.createElement("div", { className: "desc" }, e.desc)))
        ))))
  );
}

// ---- Cartão da gestante digital ---------------------------------------------

function CartaoDigitalTab({ g }) {
  const ultimaConsulta = g.prenatal[0];
  return (
    React.createElement("div", { className: "card", id: "cartao-print", style: { maxWidth: 640, margin: "0 auto" } }, React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 } }, React.createElement("div", null, React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: "var(--rose)", textTransform: "uppercase" } }, "Cartão da Gestante Digital"), React.createElement("h2", { style: { margin: "4px 0 0" } }, g.nome)), React.createElement("div", { className: "qrcode-box", title: "QR Code (simulado no protótipo)" })), React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, React.createElement(MiniStat, { label: "DPP", value: fmtDate(g.dpp) }), React.createElement(MiniStat, { label: "IG atual", value: g.idade_gestacional ? g.idade_gestacional.texto : "—" }), React.createElement(MiniStat, { label: "Tipo sanguíneo", value: g.tipo_sanguineo || "—" })), ultimaConsulta && (
        React.createElement(React.Fragment, null, React.createElement("div", { className: "section-title" }, "Última consulta (", fmtDate(ultimaConsulta.data), ")"), React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, React.createElement(MiniStat, { label: "Peso", value: ultimaConsulta.peso ? `${ultimaConsulta.peso} kg` : "—" }), React.createElement(MiniStat, { label: "Pressão", value: ultimaConsulta.pressao_arterial || "—" }), React.createElement(MiniStat, { label: "Alt. uterina", value: ultimaConsulta.altura_uterina ? `${ultimaConsulta.altura_uterina} cm` : "—" })))
      ), React.createElement("div", { className: "section-title" }, "Vacinas"), React.createElement("div", { className: "pill-list", style: { marginBottom: 16 } }, g.vacinas.map((v) => (
          React.createElement("span", { key: v.id, className: `badge ${v.status === "aplicada" ? "badge-ok" : "badge-warn"}` }, v.tipo, " ", v.status === "aplicada" ? "✓" : "pendente")
        )), g.vacinas.length === 0 && React.createElement("span", { className: "empty-state" }, "Nenhuma vacina registrada")), React.createElement("div", { className: "section-title" }, "Exames"), React.createElement("div", { className: "pill-list", style: { marginBottom: 16 } }, g.exames.map((e) => (
          React.createElement("span", { key: e.id, className: `badge ${e.status === "realizado" ? "badge-ok" : "badge-warn"}` }, e.tipo)
        )), g.exames.length === 0 && React.createElement("span", { className: "empty-state" }, "Nenhum exame registrado")), React.createElement("div", { style: { textAlign: "center", marginTop: 20 } }, React.createElement("button", { className: "btn btn-secondary", onClick: () => window.print() }, "🖨️ Imprimir / Exportar")))
  );
}

// ============================================================================
// Agenda
// ============================================================================

function AgendaPage() {
  const [eventos, setEventos] = useState(null);
  const [gestantes, setGestantes] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [pagando, setPagando] = useState(null);
  const [editingEvento, setEditingEvento] = useState(null);

  const reload = useCallback(() => {
    Promise.all([api("/agenda"), api("/gestantes"), api("/tipos-consulta")])
      .then(([ev, ge, tp]) => { setEventos(ev); setGestantes(ge); setTipos(tp); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!eventos) return React.createElement("div", { className: "empty-state" }, "Carregando agenda...");

  const tiposAtivos = tipos.filter((t) => t.ativo);

  const filtered = eventos.filter((e) => filtroTipo === "todos" || e.tipo === filtroTipo);
  const hojeStr = new Date().toISOString().slice(0, 10);
  const passados = filtered.filter((e) => e.data_hora < hojeStr);
  const futuros = filtered.filter((e) => e.data_hora >= hojeStr);

  const updateStatus = async (ev, status) => {
    await api(`/agenda/${ev.id}`, { method: "PUT", body: { status } });
    reload();
  };

  const gerarLinkPagamento = async (ev) => {
    setPagando(ev.id);
    try {
      const res = await api(`/agenda/${ev.id}/pagamento`, { method: "POST" });
      window.open(res.checkout_url, "_blank");
      reload();
    } catch (e) {
      alert("Não foi possível gerar o link de pagamento: " + e.message);
    } finally {
      setPagando(null);
    }
  };

  const marcarPago = async (ev) => {
    await api(`/agenda/${ev.id}/marcar-pago`, { method: "POST" });
    reload();
  };

  const handleDeleteEvento = async (ev) => {
    if (!window.confirm(`Excluir este evento (${ev.tipo || "evento"} — ${ev.gestante_nome || "sem paciente"})?\n\nNão pode ser desfeito.`)) return;
    // Exclusão otimista: some da tela na hora do clique, sem esperar o
    // round-trip da API nem recarregar a lista inteira de novo. Se a chamada
    // falhar, o evento volta pra lista e mostra o erro.
    setEventos((prev) => (prev ? prev.filter((e) => e.id !== ev.id) : prev));
    try {
      await api(`/agenda/${ev.id}`, { method: "DELETE" });
    } catch (e) {
      setEventos((prev) => (prev ? [...prev, ev] : prev));
      alert("Erro ao excluir: " + e.message);
    }
  };

  const AcoesEventoCell = ({ e }) => (
    React.createElement("div", { style: { display: "flex", gap: 6 } }, React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Editar", onClick: () => setEditingEvento(e) }, "✏️ Editar"), React.createElement("button", { className: "btn btn-ghost btn-sm", title: "Excluir", style: { color: "var(--danger)" }, onClick: () => handleDeleteEvento(e) }, "✕ Excluir"))
  );

  const ValorCell = ({ e }) => {
    if (!e.valor) return React.createElement("span", { style: { color: "var(--ink-soft)" } }, "—");
    return (
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, React.createElement("span", null, "R$ ", Number(e.valor).toFixed(2)), React.createElement(StatusBadge, { status: e.status_pagamento }), e.status_pagamento !== "pago" && (
          React.createElement("div", { style: { display: "flex", gap: 4 } }, React.createElement("button", { className: "btn btn-secondary btn-sm", disabled: pagando === e.id, onClick: () => gerarLinkPagamento(e) }, pagando === e.id ? "Gerando..." : "Link pagamento"), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => marcarPago(e) }, "Marcar pago"))
        ))
    );
  };

  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("div", null, React.createElement("h2", null, "Agenda obstétrica"), React.createElement("div", { className: "sub" }, "Consultas, ultrassons, exames, retornos e vacinas")), React.createElement("button", { className: "btn btn-primary", onClick: () => setShowForm(true) }, "+ Novo evento")), React.createElement("div", { className: "chip-select", style: { marginBottom: 16 } }, React.createElement("div", { className: `chip ${filtroTipo === "todos" ? "active" : ""}`, onClick: () => setFiltroTipo("todos") }, "Todos"), tiposAtivos.map((t) => (
          React.createElement("div", { key: t.id, className: `chip ${filtroTipo === t.nome ? "active" : ""}`, style: { textTransform: "capitalize" }, onClick: () => setFiltroTipo(t.nome) }, t.nome)
        ))), React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { className: "section-title" }, "Próximos eventos (", futuros.length, ")"), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Data"), React.createElement("th", null, "Tipo"), React.createElement("th", null, "Paciente"), React.createElement("th", null, "Observações"), React.createElement("th", null, "Status"), React.createElement("th", null, "Valor / Pagamento"), React.createElement("th", null, "Ações"))), React.createElement("tbody", null, futuros.map((e) => (
              React.createElement("tr", { key: e.id }, React.createElement("td", null, fmtDateTime(e.data_hora)), React.createElement("td", { style: { textTransform: "capitalize" } }, e.tipo), React.createElement("td", null, e.gestante_nome || "—"), React.createElement("td", null, e.observacoes), React.createElement("td", null, React.createElement(StatusBadge, { status: e.status })), React.createElement("td", null, React.createElement(ValorCell, { e: e })), React.createElement("td", null, React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, e.status === "agendado" && (
                    React.createElement("div", { style: { display: "flex", gap: 6 } }, React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: () => updateStatus(e, "confirmado") }, "Confirmar"), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => updateStatus(e, "cancelado") }, "Cancelar"))
                  ), React.createElement(AcoesEventoCell, { e: e }))))
            )), futuros.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "8" }, React.createElement("div", { className: "empty-state" }, "Nenhum evento futuro.")))))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Eventos anteriores (", passados.length, ")"), React.createElement("table", null, React.createElement("thead", null, React.createElement("tr", null, React.createElement("th", null, "Data"), React.createElement("th", null, "Tipo"), React.createElement("th", null, "Paciente"), React.createElement("th", null, "Observações"), React.createElement("th", null, "Status"), React.createElement("th", null, "Valor / Pagamento"), React.createElement("th", null, "Ações"))), React.createElement("tbody", null, passados.slice(0, 20).map((e) => (
              React.createElement("tr", { key: e.id }, React.createElement("td", null, fmtDateTime(e.data_hora)), React.createElement("td", { style: { textTransform: "capitalize" } }, e.tipo), React.createElement("td", null, e.gestante_nome || "—"), React.createElement("td", null, e.observacoes), React.createElement("td", null, React.createElement(StatusBadge, { status: e.status })), React.createElement("td", null, React.createElement(ValorCell, { e: e })), React.createElement("td", null, React.createElement(AcoesEventoCell, { e: e })))
            )), passados.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "7" }, React.createElement("div", { className: "empty-state" }, "Nenhum evento anterior.")))))), showForm && (
        React.createElement(AgendaFormModal, { gestantes: gestantes, tipos: tiposAtivos, onClose: () => setShowForm(false), onSaved: () => { setShowForm(false); reload(); } })
      ), editingEvento && (
        React.createElement(AgendaFormModal, { gestantes: gestantes, tipos: tiposAtivos, initial: editingEvento, onClose: () => setEditingEvento(null), onSaved: () => { setEditingEvento(null); reload(); } })
      ))
  );
}

function AgendaFormModal({ gestantes, tipos, onClose, onSaved, dataInicial, initial }) {
  const tiposDisponiveis = (tipos && tipos.length > 0) ? tipos : AGENDA_TIPOS.map((t) => ({ id: t.key, nome: t.key, preco: null, limite_diario: null, ativo: true }));
  const tipoInicial = initial ? initial.tipo : (dataInicial ? undefined : undefined);
  const [modoPaciente, setModoPaciente] = useState("existente");
  const [form, setForm] = useState(initial ? {
    gestante_id: initial.gestante_id || "",
    tipo: initial.tipo || (tiposDisponiveis[0] ? tiposDisponiveis[0].nome : "consulta"),
    data_hora: (initial.data_hora || "").slice(0, 16),
    observacoes: initial.observacoes || "",
    valor: initial.valor != null ? initial.valor : "",
  } : {
    gestante_id: "", tipo: tiposDisponiveis[0] ? tiposDisponiveis[0].nome : "consulta",
    data_hora: dataInicial ? `${dataInicial}T09:00` : "",
    observacoes: "", valor: "",
  });
  const [novaPaciente, setNovaPaciente] = useState({ nome: "", email: "", telefone: "", endereco: "" });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const [precoTocado, setPrecoTocado] = useState(!!initial);
  const [disponibilidade, setDisponibilidade] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setNova = (k, v) => setNovaPaciente((f) => ({ ...f, [k]: v }));

  const setTipo = (novoTipo) => {
    set("tipo", novoTipo);
    if (!precoTocado) {
      const t = tiposDisponiveis.find((x) => x.nome === novoTipo);
      set("valor", t && t.preco != null ? t.preco : "");
    }
  };

  // Consulta o backend pra saber se o consultório abre nesse dia/horário e
  // quantas vagas restam pro tipo escolhido, e mostra um aviso ANTES da
  // profissional tentar salvar (o servidor também valida isso de novo ao
  // salvar, então não tem como burlar essa checagem).
  useEffect(() => {
    const data = (form.data_hora || "").slice(0, 10);
    if (!data || !form.tipo) { setDisponibilidade(null); return; }
    let cancelado = false;
    api(`/agenda/disponibilidade?tipo=${encodeURIComponent(form.tipo)}&data=${data}`)
      .then((d) => { if (!cancelado) setDisponibilidade(d); })
      .catch(() => { if (!cancelado) setDisponibilidade(null); });
    return () => { cancelado = true; };
  }, [form.tipo, form.data_hora]);

  const bloqueadoPorAgenda = disponibilidade && (
    !disponibilidade.aberto || (disponibilidade.vagas_restantes !== null && disponibilidade.vagas_restantes !== undefined && disponibilidade.vagas_restantes <= 0)
  );

  const submit = async () => {
    setErro("");
    if (!initial && modoPaciente === "nova" && !novaPaciente.nome.trim()) {
      setErro("Informe o nome da nova paciente.");
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await api(`/agenda/${initial.id}`, {
          method: "PUT",
          body: {
            gestante_id: form.gestante_id || null,
            tipo: form.tipo,
            data_hora: form.data_hora,
            observacoes: form.observacoes,
            valor: form.valor ? parseFloat(form.valor) : null,
          },
        });
      } else {
        const payload = {
          ...form,
          gestante_id: modoPaciente === "existente" ? (form.gestante_id || null) : null,
          valor: form.valor ? parseFloat(form.valor) : null,
        };
        if (modoPaciente === "nova") {
          payload.nova_paciente = novaPaciente;
        }
        await api("/agenda", { method: "POST", body: payload });
      }
      onSaved();
    } catch (e) {
      setErro(e.message);
    } finally { setSaving(false); }
  };
  return (
    React.createElement(Modal, { title: initial ? "Editar evento" : "Novo evento na agenda", onClose: onClose }, React.createElement("div", { className: "form-grid" }, React.createElement(Field, { label: "Paciente", full: true }, !initial && React.createElement("div", { className: "paciente-toggle", style: { display: "flex", gap: 8, marginBottom: 8 } }, React.createElement("button", { type: "button", className: modoPaciente === "existente" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => setModoPaciente("existente") }, "Paciente já cadastrada"), React.createElement("button", { type: "button", className: modoPaciente === "nova" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => setModoPaciente("nova") }, "Cadastrar novo paciente")), (initial || modoPaciente === "existente") ? (
            React.createElement("select", { value: form.gestante_id, onChange: (e) => set("gestante_id", e.target.value) }, React.createElement("option", { value: "" }, "Sem paciente vinculada"), gestantes.map((g) => React.createElement("option", { key: g.id, value: g.id }, g.nome)))
          ) : (
            React.createElement("div", { className: "nova-paciente-box", style: { border: "1px solid var(--border, #e0e0e0)", borderRadius: 8, padding: 10, display: "grid", gap: 8 } }, React.createElement("input", { placeholder: "Nome completo *", value: novaPaciente.nome, onChange: (e) => setNova("nome", e.target.value) }), React.createElement("input", { type: "email", placeholder: "E-mail (envia confirmações)", value: novaPaciente.email, onChange: (e) => setNova("email", e.target.value) }), React.createElement("input", { placeholder: "Telefone", value: novaPaciente.telefone, onChange: (e) => setNova("telefone", e.target.value) }), React.createElement(EnderecoInput, { value: novaPaciente.endereco, onChange: (v) => setNova("endereco", v) }), React.createElement("p", { style: { fontSize: 12, color: "var(--ink-soft, #888)", margin: 0 } }, "A paciente será cadastrada automaticamente ao salvar. Se informar e-mail, ela recebe um e-mail de verificação de cadastro e a confirmação do agendamento."))
          )), React.createElement(Field, { label: "Tipo" }, React.createElement("select", { value: form.tipo, onChange: (e) => setTipo(e.target.value), style: { textTransform: "capitalize" } }, tiposDisponiveis.map((t) => React.createElement("option", { key: t.id, value: t.nome, style: { textTransform: "capitalize" } }, t.nome)))), React.createElement(Field, { label: "Data e hora" }, React.createElement("input", { type: "datetime-local", value: form.data_hora, onChange: (e) => set("data_hora", e.target.value) })), React.createElement(Field, { label: "Valor (R$) — opcional" }, React.createElement("input", { type: "number", step: "0.01", min: "0", value: form.valor, onChange: (e) => { setPrecoTocado(true); set("valor", e.target.value); }, placeholder: "ex: 150.00" })), React.createElement(Field, { label: "Observações", full: true }, React.createElement("textarea", { value: form.observacoes, onChange: (e) => set("observacoes", e.target.value) }))), disponibilidade && React.createElement("div", { className: `badge ${bloqueadoPorAgenda ? "badge-danger" : "badge-ok"}`, style: { marginTop: 4, marginBottom: 4 } }, !disponibilidade.aberto ? `Consultório fechado ${(disponibilidade.dia_semana_nome || "").toLowerCase()}` : disponibilidade.limite_diario ? `${disponibilidade.dia_semana_nome} · ${disponibilidade.abertura}–${disponibilidade.fechamento} · ${disponibilidade.vagas_restantes > 0 ? disponibilidade.vagas_restantes + " vaga(s) livre(s) de " + disponibilidade.limite_diario : "sem vagas nesse dia"}` : `${disponibilidade.dia_semana_nome} · ${disponibilidade.abertura}–${disponibilidade.fechamento}`), erro && React.createElement("p", { style: { color: "#c62828", fontSize: 13 } }, erro), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"), React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving || bloqueadoPorAgenda }, saving ? "Salvando..." : "Salvar evento")))
  );
}

// ============================================================================
// Sobre
// ============================================================================

function SobrePage() {
  const incluido = [
    "Cadastro completo da gestante (dados pessoais, histórico obstétrico e médico, condições de risco)",
    "Pré-natal: consultas com cálculo automático de IG e DPP (regra de Naegele), evolução clínica, prescrição",
    "Agenda obstétrica: consultas, ultrassons, exames, retornos e vacinas com confirmação/cancelamento",
    "Controle de exames laboratoriais com status pendente/realizado",
    "Ultrassons com gráfico de evolução do peso fetal",
    "Controle de vacinas com alertas de pendência",
    "Linha do tempo cronológica da gestação",
    "Cartão da gestante digital (resumo para impressão)",
    "Registro de parto e recém-nascido (Apgar, testes de triagem neonatal)",
    "Acompanhamento de puerpério",
    "Dashboard com indicadores do consultório",
    "Calendário visual (mês e semana) com prévia dos compromissos ao passar o mouse",
    "Relatórios: atendimentos/exames/partos por dia, semana e mês, faturamento e gráfico de 30 dias",
    "E-mail automático de verificação de cadastro, confirmação de agendamento e confirmação de pagamento (via Gmail — requer configurar as credenciais, veja o README)",
    "Pagamento de consultas/exames via Mercado Pago (link de checkout) ou confirmação manual (requer configurar o Access Token, veja o README)",
  ];
  const proximaFase = [
    "Portal da gestante e portal do profissional (login por perfil)",
    "Notificações automáticas por WhatsApp / SMS",
    "Geração automática de documentos em PDF (receitas, atestados, encaminhamentos)",
    "Partograma digital gráfico e tela de trabalho de parto em tempo real",
    "Assinatura eletrônica e conformidade formal com a LGPD (auditoria, backup automático)",
    "Integrações com laboratórios, sistemas hospitalares (HIS/PEP) e padrões HL7/FHIR",
    "Recursos com IA (resumo automático de consulta, sugestões de exame por semana gestacional)",
  ];
  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("h2", null, "Sobre este protótipo")), React.createElement("div", { className: "grid grid-2" }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "✅ O que já está funcionando"), React.createElement("ul", { style: { paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8 } }, incluido.map((i) => React.createElement("li", { key: i }, i)))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "🗺️ Próximas fases (fora do escopo deste protótipo)"), React.createElement("ul", { style: { paddingLeft: 18, fontSize: 13.5, lineHeight: 1.8, color: "var(--ink-soft)" } }, proximaFase.map((i) => React.createElement("li", { key: i }, i))))), React.createElement("div", { className: "card", style: { marginTop: 16 } }, React.createElement("div", { className: "section-title" }, "Stack técnica"), React.createElement("p", { style: { fontSize: 13.5, lineHeight: 1.7 } }, "Backend em Python puro (biblioteca padrão, sem dependências) servindo uma API REST + SQLite. Frontend em React, carregado via CDN, sem etapa de build — abra e use. Isso torna o protótipo fácil de instalar (só precisa de Python 3) e fácil de evoluir depois para uma stack com build (Vite) e banco de produção (PostgreSQL), se o projeto avançar.")))
  );
}

// ============================================================================
// Calendário (mês + semana)
// ============================================================================

const DIAS_SEMANA_ABR = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES_NOME = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
  "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const CAL_HOUR_START = 7;
const CAL_HOUR_END = 20;
const CAL_ROW_H = 52;

function isoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function navegarCalendario(date, view, delta) {
  const d = new Date(date);
  if (view === "mes") d.setMonth(d.getMonth() + delta);
  else d.setDate(d.getDate() + delta * 7);
  return d;
}

function buildMonthGrid(anchor) {
  const year = anchor.getFullYear(), month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(last);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const weeks = [];
  let cur = new Date(start);
  while (cur <= end) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function buildWeekDays(anchor) {
  const start = new Date(anchor);
  start.setDate(start.getDate() - start.getDay());
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function labelMes(date) {
  return `${MESES_NOME[date.getMonth()]} de ${date.getFullYear()}`;
}

function labelSemana(date) {
  const days = buildWeekDays(date);
  const ini = days[0], fim = days[6];
  const fmt = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `${fmt(ini)} – ${fmt(fim)}/${fim.getFullYear()}`;
}

function CalendarioPage() {
  const [view, setView] = useState("mes");
  const [anchor, setAnchor] = useState(new Date());
  const [eventos, setEventos] = useState(null);
  const [gestantes, setGestantes] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [error, setError] = useState(null);
  const [diaSelecionado, setDiaSelecionado] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [dataInicialForm, setDataInicialForm] = useState(null);

  const reload = useCallback(() => {
    Promise.all([api("/agenda"), api("/gestantes"), api("/tipos-consulta")])
      .then(([ev, ge, tp]) => { setEventos(ev); setGestantes(ge); setTipos(tp.filter((t) => t.ativo)); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!eventos) return React.createElement("div", { className: "empty-state" }, "Carregando calendário...");

  const eventosPorDia = {};
  eventos.forEach((e) => {
    if (!e.data_hora) return;
    const dia = e.data_hora.slice(0, 10);
    (eventosPorDia[dia] = eventosPorDia[dia] || []).push(e);
  });
  Object.values(eventosPorDia).forEach((lst) => lst.sort((a, b) => a.data_hora.localeCompare(b.data_hora)));

  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("div", null, React.createElement("h2", null, "Calendário"), React.createElement("div", { className: "sub" }, "Consultas, exames, ultrassons, retornos e vacinas")), React.createElement("button", { className: "btn btn-primary", onClick: () => { setDataInicialForm(null); setShowForm(true); } }, "+ Novo evento")), React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 } }, React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setAnchor(navegarCalendario(anchor, view, -1)) }, "←"), React.createElement("div", { style: { fontWeight: 700, fontSize: 15, minWidth: 190, textAlign: "center" } }, view === "mes" ? labelMes(anchor) : labelSemana(anchor)), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setAnchor(navegarCalendario(anchor, view, 1)) }, "→"), React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setAnchor(new Date()) }, "Hoje")), React.createElement("div", { className: "chip-select" }, React.createElement("div", { className: `chip ${view === "mes" ? "active" : ""}`, onClick: () => setView("mes") }, "Mês"), React.createElement("div", { className: `chip ${view === "semana" ? "active" : ""}`, onClick: () => setView("semana") }, "Semana")))), view === "mes" ? (
        React.createElement(MesView, { anchor: anchor, eventosPorDia: eventosPorDia, onDiaClick: (dia) => setDiaSelecionado(dia) })
      ) : (
        React.createElement(SemanaView, { anchor: anchor, eventosPorDia: eventosPorDia, onDiaClick: (dia) => setDiaSelecionado(dia) })
      ), diaSelecionado && (
        React.createElement(DiaDetalheModal, { dia: diaSelecionado, eventos: eventosPorDia[diaSelecionado] || [], onClose: () => setDiaSelecionado(null), onNovoEvento: () => { setDataInicialForm(diaSelecionado); setDiaSelecionado(null); setShowForm(true); } })
      ), showForm && (
        React.createElement(AgendaFormModal, { gestantes: gestantes, tipos: tipos, dataInicial: dataInicialForm, onClose: () => setShowForm(false), onSaved: () => { setShowForm(false); reload(); } })
      ))
  );
}

function MesView({ anchor, eventosPorDia, onDiaClick }) {
  const weeks = buildMonthGrid(anchor);
  const hojeStr = isoLocal(new Date());
  const mesAtual = anchor.getMonth();
  return (
    React.createElement("div", { className: "card cal-card" }, React.createElement("div", { className: "cal-grid-header" }, DIAS_SEMANA_ABR.map((d) => React.createElement("div", { key: d, className: "cal-weekday" }, d))), React.createElement("div", { className: "cal-grid-body" }, weeks.map((week, wi) => (
          React.createElement("div", { className: "cal-week", key: wi }, week.map((day) => {
              const iso = isoLocal(day);
              const evs = eventosPorDia[iso] || [];
              const foraDoMes = day.getMonth() !== mesAtual;
              const isHoje = iso === hojeStr;
              return (
                React.createElement("div", { key: iso, className: `cal-day ${foraDoMes ? "cal-day-out" : ""} ${isHoje ? "cal-day-today" : ""}`, onClick: () => onDiaClick(iso) }, React.createElement("div", { className: "cal-day-number" }, day.getDate()), evs.length > 0 && (
                    React.createElement("div", { className: "cal-day-dots" }, evs.slice(0, 4).map((e) => React.createElement("span", { key: e.id, className: `cal-dot cal-dot-${e.tipo}` })), evs.length > 4 && React.createElement("span", { className: "cal-dot-more" }, "+", evs.length - 4))
                  ), evs.length > 0 && (
                    React.createElement("div", { className: "cal-tooltip" }, React.createElement("div", { className: "cal-tooltip-title" }, fmtDate(iso), " · ", evs.length, " compromisso(s)"), evs.slice(0, 6).map((e) => (
                        React.createElement("div", { key: e.id, className: "cal-tooltip-item" }, React.createElement("b", null, e.data_hora.slice(11, 16)), " — ", e.tipo, e.gestante_nome ? ` · ${e.gestante_nome}` : "")
                      )), evs.length > 6 && React.createElement("div", { className: "cal-tooltip-item" }, "e mais ", evs.length - 6, "..."))
                  ))
              );
            }))
        ))))
  );
}

function SemanaView({ anchor, eventosPorDia, onDiaClick }) {
  const days = buildWeekDays(anchor);
  const hoursRange = [];
  for (let h = CAL_HOUR_START; h <= CAL_HOUR_END; h++) hoursRange.push(h);
  const hojeStr = isoLocal(new Date());

  return (
    React.createElement("div", { className: "card cal-card", style: { overflowX: "auto" } }, React.createElement("div", { className: "cal-week-grid", style: { gridTemplateColumns: "60px repeat(7, minmax(120px, 1fr))" } }, React.createElement("div", { className: "cal-week-corner" }), days.map((d) => {
          const iso = isoLocal(d);
          return (
            React.createElement("div", { key: iso, className: `cal-week-daylabel ${iso === hojeStr ? "cal-week-daylabel-today" : ""}`, onClick: () => onDiaClick(iso) }, React.createElement("div", { className: "cal-week-daylabel-name" }, DIAS_SEMANA_ABR[d.getDay()]), React.createElement("div", { className: "cal-week-daylabel-num" }, d.getDate()))
          );
        }), React.createElement("div", { className: "cal-week-hours" }, hoursRange.map((h) => (
            React.createElement("div", { key: h, className: "cal-hour-label", style: { height: CAL_ROW_H } }, String(h).padStart(2, "0"), ":00")
          ))), days.map((d) => {
          const iso = isoLocal(d);
          const evs = eventosPorDia[iso] || [];
          return (
            React.createElement("div", { key: iso, className: "cal-day-col", style: { height: CAL_ROW_H * hoursRange.length } }, hoursRange.map((h, i) => React.createElement("div", { key: h, className: "cal-hour-line", style: { top: i * CAL_ROW_H } })), evs.map((e) => {
                const partes = e.data_hora.slice(11, 16).split(":");
                const hh = parseInt(partes[0], 10), mm = parseInt(partes[1], 10);
                if (hh < CAL_HOUR_START || hh > CAL_HOUR_END) return null;
                const top = (hh - CAL_HOUR_START) * CAL_ROW_H + (mm / 60) * CAL_ROW_H;
                return (
                  React.createElement("div", { key: e.id, className: `cal-event cal-event-${e.tipo}`, style: { top: top, height: CAL_ROW_H - 6 }, title: `${e.tipo} - ${e.gestante_nome || "sem paciente"}` }, React.createElement("div", { className: "cal-event-time" }, e.data_hora.slice(11, 16)), React.createElement("div", { className: "cal-event-title" }, e.tipo, e.gestante_nome ? ` · ${e.gestante_nome}` : ""))
                );
              }))
          );
        })))
  );
}

function DiaDetalheModal({ dia, eventos, onClose, onNovoEvento }) {
  return (
    React.createElement(Modal, { title: `Compromissos — ${fmtDate(dia)}`, onClose: onClose }, eventos.length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum compromisso neste dia."), eventos.map((e) => (
        React.createElement("div", { key: e.id, className: "gestante-card", style: { display: "block" } }, React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } }, React.createElement("strong", null, e.data_hora.slice(11, 16), " — ", e.tipo), React.createElement(StatusBadge, { status: e.status })), React.createElement("div", { style: { fontSize: 13, color: "var(--ink-soft)" } }, e.gestante_nome || "Sem paciente vinculada"), e.observacoes && React.createElement("div", { style: { fontSize: 12.5, marginTop: 4 } }, e.observacoes), e.valor ? (
            React.createElement("div", { style: { fontSize: 12.5, marginTop: 4 } }, React.createElement("b", null, "Valor:"), " R$ ", Number(e.valor).toFixed(2), " · ", React.createElement(StatusBadge, { status: e.status_pagamento }))
          ) : null)
      )), React.createElement("div", { className: "modal-actions" }, React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Fechar"), React.createElement("button", { className: "btn btn-primary", onClick: onNovoEvento }, "+ Novo evento neste dia")))
  );
}

// ============================================================================
// Relatórios
// ============================================================================

function BarChartSimples({ dados, color = "#c2185b" }) {
  const W = 640, H = 160, PAD = 24;
  const max = Math.max(1, ...dados.map((d) => d.atendimentos));
  const barW = (W - PAD * 2) / dados.length;
  return (
    React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H }, dados.map((d, i) => {
        const h = (d.atendimentos / max) * (H - PAD * 2);
        const x = PAD + i * barW;
        const y = H - PAD - h;
        return (
          React.createElement("g", { key: d.data }, React.createElement("rect", { x: x + 1, y: y, width: Math.max(barW - 2, 1), height: Math.max(h, d.atendimentos ? 2 : 0), fill: color, rx: "2", opacity: d.atendimentos ? 1 : 0.12 }), i % 5 === 0 && React.createElement("text", { x: x + barW / 2, y: H - 6, fontSize: "8.5", textAnchor: "middle", fill: "#a89aa2" }, d.data.slice(8, 10), "/", d.data.slice(5, 7)))
        );
      }))
  );
}

function RelatoriosPage() {
  const [dados, setDados] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api("/relatorios").then(setDados).catch((e) => setError(e.message));
  }, []);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!dados) return React.createElement("div", { className: "empty-state" }, "Carregando relatórios...");

  const fmtMoeda = (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;

  return (
    React.createElement("div", null, React.createElement("div", { className: "topbar" }, React.createElement("div", null, React.createElement("h2", null, "Relatórios"), React.createElement("div", { className: "sub" }, "Indicadores de atendimento e faturamento"))), React.createElement("div", { className: "grid grid-3", style: { marginBottom: 16 } }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Hoje"), React.createElement("div", { className: "grid grid-3", style: { gap: 8 } }, React.createElement(MiniStat, { label: "Consultas", value: dados.hoje.consultas }), React.createElement(MiniStat, { label: "Exames", value: dados.hoje.exames }), React.createElement(MiniStat, { label: "Partos", value: dados.hoje.partos }))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Últimos 7 dias"), React.createElement("div", { className: "grid grid-3", style: { gap: 8 } }, React.createElement(MiniStat, { label: "Consultas", value: dados.semana.consultas }), React.createElement(MiniStat, { label: "Exames", value: dados.semana.exames }), React.createElement(MiniStat, { label: "Partos", value: dados.semana.partos }))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Este mês"), React.createElement("div", { className: "grid grid-3", style: { gap: 8 } }, React.createElement(MiniStat, { label: "Consultas", value: dados.mes.consultas }), React.createElement(MiniStat, { label: "Exames", value: dados.mes.exames }), React.createElement(MiniStat, { label: "Partos", value: dados.mes.partos })))), React.createElement("div", { className: "grid grid-2", style: { marginBottom: 16 } }, React.createElement(StatCard, { icon: "💰", label: "Faturamento do mês (pago)", value: fmtMoeda(dados.faturamento_mes), color: "#2e7d32" }), React.createElement(StatCard, { icon: "⏳", label: "A receber (pendente)", value: fmtMoeda(dados.faturamento_pendente_mes), color: "#ef6c00" })), React.createElement("div", { className: "card", style: { marginBottom: 16 } }, React.createElement("div", { className: "section-title" }, "Atendimentos nos últimos 30 dias"), React.createElement(BarChartSimples, { dados: dados.serie_30_dias })), React.createElement("div", { className: "grid grid-2" }, React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Partos do mês por tipo"), Object.keys(dados.partos_mes_por_tipo).length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum parto registrado este mês."), Object.entries(dados.partos_mes_por_tipo).map(([tipo, c]) => (
            React.createElement("div", { key: tipo, className: "gestante-card" }, React.createElement("span", { style: { textTransform: "capitalize" } }, tipo), React.createElement("span", { className: "badge badge-lavender" }, c))
          ))), React.createElement("div", { className: "card" }, React.createElement("div", { className: "section-title" }, "Atendimentos do mês por tipo"), Object.keys(dados.tipos_atendimento_mes).length === 0 && React.createElement("div", { className: "empty-state" }, "Nenhum atendimento este mês."), Object.entries(dados.tipos_atendimento_mes).map(([tipo, c]) => (
            React.createElement("div", { key: tipo, className: "gestante-card" }, React.createElement("span", null, tipo), React.createElement("span", { className: "badge badge-teal" }, c))
          )))))
  );
}

// ============================================================================
// Configurações do consultório (horário de funcionamento e tipos de consulta)
// ============================================================================

function ConfiguracoesPage() {
  const [horarios, setHorarios] = useState(null);
  const [tipos, setTipos] = useState(null);
  const [error, setError] = useState(null);
  const [savingHorarios, setSavingHorarios] = useState(false);
  const [horariosMsg, setHorariosMsg] = useState("");
  const [showTipoForm, setShowTipoForm] = useState(false);
  const [editingTipo, setEditingTipo] = useState(null);

  const reload = useCallback(() => {
    Promise.all([api("/configuracoes/horario"), api("/tipos-consulta")])
      .then(([h, t]) => { setHorarios(h); setTipos(t); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (error) return React.createElement(ApiErrorBanner, { error: error });
  if (!horarios || !tipos) return React.createElement("div", { className: "empty-state" }, "Carregando configurações...");

  const setHorarioDia = (dia, patch) => {
    setHorarios((prev) => prev.map((h) => (h.dia_semana === dia ? { ...h, ...patch } : h)));
  };

  const salvarHorarios = async () => {
    setSavingHorarios(true);
    setHorariosMsg("");
    try {
      const atualizado = await api("/configuracoes/horario", {
        method: "PUT",
        body: { dias: horarios.map((h) => ({ dia_semana: h.dia_semana, aberto: h.aberto, abertura: h.abertura, fechamento: h.fechamento })) },
      });
      setHorarios(atualizado);
      setHorariosMsg("Horários salvos.");
    } catch (e) {
      setHorariosMsg("Erro: " + e.message);
    } finally {
      setSavingHorarios(false);
    }
  };

  const excluirTipo = async (t) => {
    if (!window.confirm(`Excluir o tipo de consulta "${t.nome}"?`)) return;
    try {
      await api(`/tipos-consulta/${t.id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      alert("Erro ao excluir: " + e.message);
    }
  };

  return (
    React.createElement("div", null,
      React.createElement("div", { className: "topbar" },
        React.createElement("div", null,
          React.createElement("h2", null, "Configurações do consultório"),
          React.createElement("div", { className: "sub" }, "Horário de funcionamento e tipos de consulta usados na agenda")
        )
      ),
      React.createElement("div", { className: "card", style: { marginBottom: 16 } },
        React.createElement("div", { className: "section-title" }, "Horário de funcionamento"),
        React.createElement("table", null,
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", null, "Dia"),
              React.createElement("th", null, "Situação"),
              React.createElement("th", null, "Abertura"),
              React.createElement("th", null, "Fechamento")
            )
          ),
          React.createElement("tbody", null,
            horarios.map((h) => (
              React.createElement("tr", { key: h.dia_semana },
                React.createElement("td", null, h.dia_semana_nome),
                React.createElement("td", null,
                  React.createElement("button", {
                    type: "button",
                    className: h.aberto ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost",
                    onClick: () => setHorarioDia(h.dia_semana, { aberto: h.aberto ? 0 : 1 }),
                  }, h.aberto ? "Aberto" : "Fechado")
                ),
                React.createElement("td", null,
                  React.createElement("input", {
                    type: "time", value: h.abertura || "08:00", disabled: !h.aberto,
                    onChange: (e) => setHorarioDia(h.dia_semana, { abertura: e.target.value }),
                  })
                ),
                React.createElement("td", null,
                  React.createElement("input", {
                    type: "time", value: h.fechamento || "18:00", disabled: !h.aberto,
                    onChange: (e) => setHorarioDia(h.dia_semana, { fechamento: e.target.value }),
                  })
                )
              )
            ))
          )
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginTop: 14 } },
          React.createElement("button", { className: "btn btn-primary", onClick: salvarHorarios, disabled: savingHorarios }, savingHorarios ? "Salvando..." : "Salvar horários"),
          horariosMsg && React.createElement("span", { style: { fontSize: 13, color: horariosMsg.indexOf("Erro") === 0 ? "#c62828" : "var(--ink-soft, #888)" } }, horariosMsg)
        )
      ),
      React.createElement("div", { className: "card" },
        React.createElement("div", { className: "section-title" }, "Tipos de consulta",
          React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => setShowTipoForm(true) }, "+ Novo tipo")
        ),
        React.createElement("table", null,
          React.createElement("thead", null,
            React.createElement("tr", null,
              React.createElement("th", null, "Nome"),
              React.createElement("th", null, "Preço"),
              React.createElement("th", null, "Limite por dia"),
              React.createElement("th", null, "Ativo"),
              React.createElement("th", null, "Ações")
            )
          ),
          React.createElement("tbody", null,
            tipos.map((t) => (
              React.createElement("tr", { key: t.id },
                React.createElement("td", { style: { textTransform: "capitalize" } }, t.nome),
                React.createElement("td", null, t.preco != null ? `R$ ${Number(t.preco).toFixed(2)}` : "—"),
                React.createElement("td", null, t.limite_diario || "Sem limite"),
                React.createElement("td", null, t.ativo ? React.createElement("span", { className: "badge badge-ok" }, "Ativo") : React.createElement("span", { className: "badge badge-neutral" }, "Inativo")),
                React.createElement("td", null,
                  React.createElement("div", { style: { display: "flex", gap: 6 } },
                    React.createElement("button", { className: "btn btn-ghost btn-sm", onClick: () => setEditingTipo(t) }, "✏️ Editar"),
                    React.createElement("button", { className: "btn btn-ghost btn-sm", style: { color: "var(--danger)" }, onClick: () => excluirTipo(t) }, "✕ Excluir")
                  )
                )
              )
            )),
            tipos.length === 0 && React.createElement("tr", null, React.createElement("td", { colSpan: "5" }, React.createElement("div", { className: "empty-state" }, "Nenhum tipo de consulta cadastrado.")))
          )
        )
      ),
      showTipoForm && React.createElement(TipoConsultaFormModal, { onClose: () => setShowTipoForm(false), onSaved: () => { setShowTipoForm(false); reload(); } }),
      editingTipo && React.createElement(TipoConsultaFormModal, { initial: editingTipo, onClose: () => setEditingTipo(null), onSaved: () => { setEditingTipo(null); reload(); } })
    )
  );
}

function TipoConsultaFormModal({ onClose, onSaved, initial }) {
  const [form, setForm] = useState(initial ? {
    nome: initial.nome || "", preco: initial.preco != null ? initial.preco : "",
    limite_diario: initial.limite_diario != null ? initial.limite_diario : "", ativo: initial.ativo !== 0,
  } : { nome: "", preco: "", limite_diario: "", ativo: true });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.nome.trim()) { setErro("Informe o nome do tipo de consulta."); return; }
    setSaving(true);
    setErro("");
    try {
      const body = {
        nome: form.nome.trim(),
        preco: form.preco !== "" ? parseFloat(form.preco) : null,
        limite_diario: form.limite_diario !== "" ? parseInt(form.limite_diario, 10) : null,
        ativo: !!form.ativo,
      };
      if (initial) {
        await api(`/tipos-consulta/${initial.id}`, { method: "PUT", body });
      } else {
        await api("/tipos-consulta", { method: "POST", body });
      }
      onSaved();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    React.createElement(Modal, { title: initial ? "Editar tipo de consulta" : "Novo tipo de consulta", onClose: onClose },
      React.createElement("div", { className: "form-grid" },
        React.createElement(Field, { label: "Nome", full: true },
          React.createElement("input", { value: form.nome, onChange: (e) => set("nome", e.target.value), placeholder: "ex: consulta, ultrassom, vacina..." })
        ),
        React.createElement(Field, { label: "Preço (R$)" },
          React.createElement("input", { type: "number", step: "0.01", min: "0", value: form.preco, onChange: (e) => set("preco", e.target.value), placeholder: "ex: 150.00" })
        ),
        React.createElement(Field, { label: "Limite máximo por dia" },
          React.createElement("input", { type: "number", min: "0", value: form.limite_diario, onChange: (e) => set("limite_diario", e.target.value), placeholder: "vazio = sem limite" })
        ),
        React.createElement(Field, { label: "Ativo" },
          React.createElement("div", { style: { display: "flex", gap: 8 } },
            React.createElement("button", { type: "button", className: form.ativo ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("ativo", true) }, "Sim"),
            React.createElement("button", { type: "button", className: !form.ativo ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost", onClick: () => set("ativo", false) }, "Não")
          )
        )
      ),
      erro && React.createElement("p", { style: { color: "#c62828", fontSize: 13 } }, erro),
      React.createElement("div", { className: "modal-actions" },
        React.createElement("button", { className: "btn btn-ghost", onClick: onClose }, "Cancelar"),
        React.createElement("button", { className: "btn btn-primary", onClick: submit, disabled: saving }, saving ? "Salvando..." : "Salvar")
      )
    )
  );
}

// ============================================================================
// App raiz
// ============================================================================

function App() {
  const [page, setPage] = useState("dashboard");
  const [gestanteId, setGestanteId] = useState(null);
  const [gestantesFiltroInicial, setGestantesFiltroInicial] = useState(null);

  const navigate = (p) => { setPage(p); setGestanteId(null); setGestantesFiltroInicial(null); };
  const openGestante = (id) => { setGestanteId(id); setPage("gestante-detail"); };
  const navigateGestantes = (filtro) => { setGestantesFiltroInicial(filtro); setGestanteId(null); setPage("gestantes"); };

  return (
    React.createElement("div", { className: "app-shell" }, React.createElement(Sidebar, { page: page, onNavigate: navigate }), React.createElement("div", { className: "main" }, page === "dashboard" && React.createElement(DashboardPage, { onOpenGestante: openGestante, onNavigateGestantes: navigateGestantes, onNavigate: navigate }), page === "gestantes" && React.createElement(GestantesListPage, { onOpenGestante: openGestante, initialFiltro: gestantesFiltroInicial }), page === "cadastros" && React.createElement(CadastroPage, { onSaved: openGestante, onCancel: () => navigate("gestantes") }), page === "gestante-detail" && React.createElement(GestanteDetailPage, { gestanteId: gestanteId, onBack: () => navigate("gestantes") }), page === "agenda" && React.createElement(AgendaPage, null), page === "calendario" && React.createElement(CalendarioPage, null), page === "relatorios" && React.createElement(RelatoriosPage, null), page === "configuracoes" && React.createElement(ConfiguracoesPage, null), page === "sobre" && React.createElement(SobrePage, null)))
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(App, null));
