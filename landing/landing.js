"use strict";

// All demonstrations use illustrative data. No message is sent from this page.
const examples = {
  ventas: {
    question: "¿Cuánto llevamos de ventas?",
    intro: "Este mes llevas",
    amount: "$842,000",
    detail: "en 12 ventas confirmadas.",
    title: "Ventas por cliente",
    caption: "12 ventas · septiembre",
    shares: [51, 33, 16],
    rows: [
      ["Grupo Norte", "$428,000", "51%"],
      ["Comercial del Valle", "$278,000", "33%"],
      ["Otros clientes", "$136,000", "16%"],
    ],
  },
  gastos: {
    question: "¿Cuánto hemos gastado este mes?",
    intro: "Este mes has registrado",
    amount: "$318,400",
    detail: "en gastos durante septiembre.",
    title: "Gastos por categoría",
    caption: "Gastos registrados · septiembre",
    shares: [70, 20, 10],
    rows: [
      ["Proveedores", "$224,000", "70%"],
      ["Operación", "$62,400", "20%"],
      ["Logística", "$32,000", "10%"],
    ],
  },
  cobros: {
    question: "¿Qué nos falta por cobrar?",
    intro: "Tienes por cobrar",
    amount: "$196,500",
    detail: "en 3 cuentas pendientes.",
    title: "Cuentas por cobrar",
    caption: "3 cuentas · septiembre",
    shares: [50, 32, 18],
    rows: [
      ["Grupo Norte", "$98,000", "50%"],
      ["Comercial del Valle", "$63,000", "32%"],
      ["Taller Central", "$35,500", "18%"],
    ],
  },
};

const demo = document.querySelector("#demo");
function selectQuestion(key) {
  const item = examples[key];
  if (!item) return;
  demo.querySelector("[data-question]").textContent = item.question;
  demo.querySelector("[data-answer-intro]").textContent = item.intro;
  const currency = document.createElement("span");
  currency.textContent = "MXN";
  demo
    .querySelector("[data-answer-value]")
    .replaceChildren(`${item.amount} `, currency);
  demo.querySelector("[data-answer-detail]").textContent = item.detail;
  demo.querySelector("[data-chart-title]").textContent = item.title;
  demo.querySelector("[data-chart-caption]").textContent = item.caption;
  demo.querySelectorAll(".data-rows > div").forEach((row, i) => {
    const dot = document.createElement("i");
    row.children[0].replaceChildren(dot, item.rows[i][0]);
    row.children[1].textContent = item.rows[i][1];
    row.children[2].textContent = item.rows[i][2];
  });
  demo
    .querySelectorAll(".distribution i")
    .forEach((segment, i) =>
      segment.style.setProperty("--share", item.shares[i]),
    );
  demo.querySelectorAll("[data-ask], [data-metric]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String((button.dataset.ask || button.dataset.metric) === key),
    );
  });
}
demo.querySelectorAll("[data-ask], [data-metric]").forEach((button) => {
  button.addEventListener("click", () =>
    selectQuestion(button.dataset.ask || button.dataset.metric),
  );
});

// Meta ads: ?utm_content=a|b says which ad variant brought the visit.
const adParam = new URLSearchParams(location.search).get("utm_content");
const adVariant =
  adParam && /^[a-z0-9]{1,8}$/i.test(adParam) ? adParam.toLowerCase() : null;
const whatsappLinks = document.querySelectorAll('a[href^="https://wa.me/"]');
if (adVariant) {
  // The prefilled message tells us which ad started the chat.
  const text = encodeURIComponent(
    `Hola, vi su anuncio (${adVariant.toUpperCase()}) y quiero ver Tratto`,
  );
  whatsappLinks.forEach((link) => {
    link.href = link.href.replace(/\?text=[^&]*/, `?text=${text}`);
  });
  // The demo chat opens with the same question as the ad.
  if (adVariant === "a") {
    examples.cobros.question = "¿Cuánto nos deben hoy?";
    selectQuestion("cobros");
  } else if (adVariant === "b") {
    examples.cotizado = {
      question: "¿Cuánto cotizamos esta semana?",
      intro: "Esta semana cotizaste",
      amount: "$3,760,200",
      detail: "en 14 cotizaciones. 5 siguen sin respuesta.",
      title: "Cotizado por cliente",
      caption: "14 cotizaciones · esta semana",
      shares: [50, 32, 18],
      rows: [
        ["Grupo Norte", "$1,880,100", "50%"],
        ["Comercial del Valle", "$1,203,264", "32%"],
        ["Otros clientes", "$676,836", "18%"],
      ],
    };
    selectQuestion("cotizado");
  }
}
// Meta Pixel: tapping any WhatsApp button counts as Contact, tagged with the ad variant.
whatsappLinks.forEach((link) =>
  link.addEventListener("click", () => {
    if (window.fbq)
      fbq("track", "Contact", { content_name: adVariant || "directo" });
  }),
);

const steps = [
  {
    label: "01 / COSTEAR",
    title: "El precio correcto empieza por un costo claro.",
    description:
      "Compras confirma los precios de proveedor. El portal calcula la utilidad y cada línea queda en el mismo expediente.",
    benefit: "El margen lo ve solo quien tú decidas.",
    exampleTitle: "Costeo · OPP-0387",
    status: "En costeo",
    rows: [
      ["Chamarra softshell", "$1,240.00"],
      ["Chaleco de trabajo", "$2,890.00"],
      ["Bota de seguridad", "$1,560.00"],
    ],
    totalLabel: "Utilidad calculada",
    total: "18.4%",
    note: "Compras confirmó los precios de proveedor",
  },
  {
    label: "02 / VALIDAR",
    title: "El margen se revisa antes de prometer un precio.",
    description:
      "Dirección revisa el costeo y aprueba con la información completa. Las validaciones quedan registradas, con fecha y responsable.",
    benefit: "Cada aprobación deja una versión de referencia.",
    exampleTitle: "Validación · OPP-0387",
    status: "Validado",
    rows: [
      ["Precios de proveedor", "Confirmados"],
      ["Margen mínimo", "Cumplido"],
      ["Aprobación de dirección", "Elena · 09:31"],
    ],
    totalLabel: "Costeo autorizado",
    total: "18.4%",
    note: "Versión validada guardada en el expediente",
  },
  {
    label: "03 / COTIZAR",
    title: "Del costeo al PDF. Sin volver a escribirlo.",
    description:
      "Genera la cotización con tu membrete a partir de los precios aprobados. Cada versión queda guardada para saber cuál se envió.",
    benefit: "Tu formato, tus condiciones y tu historial.",
    exampleTitle: "Cotización · COT-0387",
    status: "V2 vigente",
    rows: [
      ["340 · Chamarra softshell", "$521,560"],
      ["120 · Chaleco de trabajo", "$412,800"],
      ["340 · Bota de seguridad", "$349,960"],
    ],
    totalLabel: "Total de la cotización",
    total: "$1,284,320",
    note: "PDF con tu membrete · V1 archivada",
  },
  {
    label: "04 / DAR SEGUIMIENTO",
    title: "El siguiente paso siempre tiene responsable.",
    description:
      "Notas, tareas y fechas junto a la venta. Lo que conversas en WhatsApp queda en el expediente para que todo el equipo tenga contexto.",
    benefit: "Los recordatorios llegan a quien debe actuar.",
    exampleTitle: "Actividades · OPP-0387",
    status: "En negociación",
    rows: [
      ["Enviar muestras", "Ángel · 17 sep"],
      ["Confirmar precios", "Emily · Hecho"],
      ["Llamar a compras", "Ángel · 22 sep"],
    ],
    totalLabel: "Próximas actividades",
    total: "2 pendientes",
    note: "“Cliente pide las muestras el 17” · Nota de Ángel",
  },
  {
    label: "05 / ENTREGAR",
    title: "Lo que vendiste se convierte en un plan de entrega.",
    description:
      "La venta se vuelve proyecto con sus órdenes de compra, documentos y entregas. Cada avance mantiene la relación con lo cotizado.",
    benefit: "Compras, dirección y operación comparten contexto.",
    exampleTitle: "Proyecto · PRY-0142",
    status: "En entrega",
    rows: [
      ["OC-0201 · Calzado", "Firmada"],
      ["OC-0202 · Uniformes", "Firmada"],
      ["Entrega al cliente", "15 octubre"],
    ],
    totalLabel: "Órdenes de compra",
    total: "2 firmadas",
    note: "Proyecto creado a partir de OPP-0387",
  },
  {
    label: "06 / COBRAR",
    title: "Vender está bien. Saber qué falta cobrar, mejor.",
    description:
      "Consulta anticipos, pagos y vencimientos en el estado de cuenta del proyecto. Pregunta por WhatsApp cuando necesites una respuesta.",
    benefit: "Cobrado, pendiente y vencido en el mismo lugar.",
    exampleTitle: "Cobranza · PRY-0142",
    status: "En curso",
    rows: [
      ["Anticipo · 30%", "$385,296 · Cobrado"],
      ["Contra entrega · 50%", "$642,160 · Cobrado"],
      ["Finiquito · 20%", "$256,864 · Pendiente"],
    ],
    totalLabel: "Por cobrar",
    total: "$256,864",
    note: "Finiquito programado para el 30 de noviembre",
  },
];
const workflow = document.querySelector("[data-workflow]");
const tabs = [...workflow.querySelectorAll('[role="tab"]')];
function selectStep(index, focus = false) {
  const item = steps[index];
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  workflow
    .querySelector('[role="tabpanel"]')
    .setAttribute("aria-labelledby", tabs[index].id);
  const fields = {
    "step-label": item.label,
    "step-title": item.title,
    "step-description": item.description,
    "step-benefit": item.benefit,
    "example-title": item.exampleTitle,
    "example-status": item.status,
    "example-total-label": item.totalLabel,
    "example-total": item.total,
    "example-note": item.note,
  };
  Object.entries(fields).forEach(([name, value]) => {
    workflow.querySelector(`[data-${name}]`).textContent = value;
  });
  workflow.querySelectorAll("[data-example-rows] > div").forEach((row, i) => {
    row.children[0].textContent = item.rows[i][0];
    row.children[1].textContent = item.rows[i][1];
  });
  if (focus) tabs[index].focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectStep(index));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    selectStep(next, true);
  });
});

const actions = {
  consultar: {
    question: "¿Qué tenemos pendiente con Grupo Norte?",
    answer: "Hay 2 pendientes en su expediente:",
    lines: [
      ["Enviar muestras", "Ángel · mañana, 17 de septiembre"],
      ["Cobrar el anticipo", "$98,000 MXN · vence el 20 de septiembre"],
    ],
    event: "Todo viene del mismo expediente",
    detail: "Grupo Norte · OPP-0387",
  },
  registrar: {
    question:
      "Anota en Grupo Norte: el cliente pide las muestras el 17 de septiembre.",
    answer: "Listo. Guardé tu nota en el expediente:",
    lines: [
      [
        "Grupo Norte · OPP-0387",
        "“El cliente pide las muestras el 17 de septiembre.”",
      ],
      ["Registrada por Ángel", "Hoy, 09:41 · desde WhatsApp"],
    ],
    event: "La nota ya aparece en el portal",
    detail: "Visible para el equipo con acceso al expediente",
  },
  avisar: {
    question: "Avísame cuando se acerque el cobro de Grupo Norte.",
    answer: "Listo. Programé un recordatorio para ti:",
    lines: [
      ["Anticipo de Grupo Norte", "$98,000 MXN · vence el 20 de septiembre"],
      ["Aviso por WhatsApp", "19 de septiembre · un día antes"],
    ],
    event: "Recordatorio vinculado al cobro",
    detail: "Lo recibirás en este chat",
  },
};
const waSection = document.querySelector("#whatsapp");
waSection.querySelectorAll("[data-action]").forEach((button) =>
  button.addEventListener("click", () => {
    const item = actions[button.dataset.action];
    waSection.querySelector("[data-wa-question]").textContent = item.question;
    waSection.querySelector("[data-wa-answer]").textContent = item.answer;
    waSection.querySelector("[data-wa-event]").textContent = item.event;
    waSection.querySelector("[data-wa-event-detail]").textContent = item.detail;
    waSection.querySelectorAll("[data-wa-lines] > p").forEach((line, i) => {
      line.children[0].textContent = item.lines[i][0];
      line.children[1].textContent = item.lines[i][1];
    });
    waSection
      .querySelectorAll("[data-action]")
      .forEach((option) =>
        option.setAttribute("aria-pressed", String(option === button)),
      );
  }),
);

const menuButton = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".nav-links");
function closeMenu(restoreFocus = false) {
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Abrir menú");
  navLinks.classList.remove("is-open");
  if (restoreFocus) menuButton.focus();
}
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") !== "true";
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  navLinks.classList.toggle("is-open", open);
});
navLinks
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", () => closeMenu()));
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Escape" &&
    menuButton.getAttribute("aria-expanded") === "true"
  )
    closeMenu(true);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".nav")) closeMenu();
});
const desktop = window.matchMedia("(min-width: 641px)");
desktop.addEventListener("change", () => closeMenu());
