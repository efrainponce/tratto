(() => {
  'use strict';

  // Motion enhances a complete static page. It never gates the information.
  const demo = document.getElementById('demo');
  const motionButton = document.querySelector('.motion-toggle');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  let demoVisible = false;
  const activeAnimations = new Set();
  const motionAllowed = () => !reducedMotion.matches && !userPaused && !document.hidden;

  function stopAnimations() {
    activeAnimations.forEach(animation => animation.cancel());
    activeAnimations.clear();
  }
  function animate(element, frames, options = {}) {
    if (!element || !element.animate || !motionAllowed()) return;
    const animation = element.animate(frames, {
      duration: 450,
      easing: 'cubic-bezier(.2,.75,.2,1)',
      ...options
    });
    activeAnimations.add(animation);
    animation.addEventListener('finish', () => activeAnimations.delete(animation), { once: true });
    animation.addEventListener('cancel', () => activeAnimations.delete(animation), { once: true });
  }
  function updateMotion() {
    const paused = userPaused || reducedMotion.matches;
    demo.classList.toggle('motion-running', demoVisible && motionAllowed());
    demo.classList.toggle('motion-paused', paused);
    motionButton.hidden = reducedMotion.matches;
    motionButton.querySelector('.motion-label').textContent = paused ? 'Reanudar animación' : 'Pausar animación';
    if (!motionAllowed()) stopAnimations();
  }
  motionButton.addEventListener('click', () => {
    userPaused = !userPaused;
    updateMotion();
  });
  reducedMotion.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', updateMotion);

  if ('IntersectionObserver' in window) {
    let introduced = false;
    new IntersectionObserver(entries => {
      demoVisible = entries[0].isIntersecting;
      updateMotion();
      if (demoVisible && !introduced) {
        introduced = true;
        animate(document.querySelector('.portal-preview'), [
          { transform: 'translateY(12px)' }, { transform: 'translateY(0)' }
        ], { duration: 700 });
        animate(document.querySelector('.chat-preview'), [
          { transform: 'translateY(20px)' }, { transform: 'translateY(0)' }
        ], { duration: 850 });
      }
    }, { threshold: 0.12 }).observe(demo);

    const sections = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        animate(entry.target, [
          { transform: 'translateY(14px)' },
          { transform: 'translateY(0)' }
        ], { duration: 600 });
        sections.unobserve(entry.target);
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.section-head, .custom-intro, .killer, .implementation, .price, .faq, .final').forEach(section => sections.observe(section));
  }
  updateMotion();

  // Preserve campaign attribution and the existing Contact conversion event.
  const variant = new URLSearchParams(location.search).get('utm_content');
  const campaign = variant && /^[a-z0-9]{1,8}$/i.test(variant) ? variant : '';
  document.querySelectorAll('a[data-wa]').forEach(link => {
    const url = new URL(link.href);
    url.pathname = '/525538662809';
    if (campaign) {
      url.searchParams.set('text', `Hola, vi su anuncio (${campaign.toUpperCase()}) y quiero ver Tratto`);
    }
    link.href = url.href;
    link.addEventListener('click', () => {
      if (typeof window.fbq === 'function') {
        window.fbq('track', 'Contact', { content_name: campaign.toLowerCase() || 'directo' });
      }
    });
  });

  // Illustrative figures; this demo never queries a customer's portal.
  const examples = {
    sales: {
      question: '¿Cuánto llevamos de ventas este mes?',
      intro: 'Este mes llevas',
      amount: '$842,000 MXN',
      summary: 'en 12 ventas confirmadas.',
      detail: 'Grupo Norte representa $428,000, el 51% de tus ventas del mes.',
      source: 'Fuente: ventas registradas en tu portal.',
      title: 'Ventas por cliente',
      column: 'Cliente',
      period: 'Este mes',
      rows: [
        ['Grupo Norte', 'Confirmada', '$428,000'],
        ['Comercial del Valle', 'Confirmada', '$276,000'],
        ['Estudio Central', 'Confirmada', '$138,000']
      ]
    },
    expenses: {
      question: '¿Cuánto hemos gastado este mes?',
      intro: 'Tienes registrados',
      amount: '$318,400 MXN',
      summary: 'en gastos durante septiembre.',
      detail: 'La mayor parte es de proveedores: $224,000. Logística suma $64,800 y operación, $29,600.',
      source: 'Fuente: gastos registrados en tu portal.',
      title: 'Gastos por categoría',
      column: 'Categoría',
      period: 'Este mes',
      rows: [
        ['Proveedores', 'Registrado', '$224,000'],
        ['Logística', 'Registrado', '$64,800'],
        ['Operación', 'Registrado', '$29,600']
      ]
    },
    receivables: {
      question: '¿Qué nos falta por cobrar?',
      intro: 'Tienes por cobrar',
      amount: '$196,500 MXN',
      summary: 'en 3 cuentas pendientes.',
      detail: 'Prioriza a Grupo Norte: sus $98,000 vencieron el 12 de septiembre. Las otras dos cuentas siguen en plazo.',
      source: 'Fuente: cuentas por cobrar de tu portal.',
      title: 'Cuentas por cobrar',
      column: 'Cliente',
      period: 'Al 15 de septiembre',
      rows: [
        ['Grupo Norte', 'Venció 12 sep', '$98,000'],
        ['Comercial del Valle', 'Vence 20 sep', '$62,500'],
        ['Estudio Central', 'Vence 30 sep', '$36,000']
      ]
    }
  };

  // Ad B retains its original question, with matching portal figures.
  if (campaign.toLowerCase() === 'b') {
    examples.sales = {
      question: '¿Cuánto cotizamos esta semana?',
      intro: 'Esta semana cotizaste',
      amount: '$3,760,200 MXN',
      summary: 'en 14 cotizaciones.',
      detail: 'Policía Estatal va en V2, en negociación. Son montos cotizados; todavía no son ventas confirmadas.',
      source: 'Fuente: cotizaciones registradas en tu portal.',
      title: 'Cotizaciones por cliente',
      column: 'Cliente',
      period: 'Esta semana',
      rows: [
        ['Policía Estatal', 'En negociación', '$1,284,320'],
        ['Grupo Norte', 'Cotizada', '$1,475,880'],
        ['Comercial del Valle', 'Cotizada', '$1,000,000']
      ]
    };
    document.getElementById('sales-label').textContent = 'Cotizaciones';
    document.querySelector('[data-metric="sales"]').classList.add('metric--long');
    document.getElementById('sales-value').textContent = '$3,760,200';
    document.getElementById('sales-note').textContent = '14 esta semana';
    document.querySelector('[data-question="sales"]').textContent = 'Cotizaciones';
  }

  const questionButtons = [...document.querySelectorAll('[data-question]')];
  function showExample(key, transition = true) {
    const example = examples[key];
    if (!example) return;
    const fields = {
      'demo-question': example.question,
      'answer-intro': example.intro,
      'answer-amount': example.amount,
      'answer-summary': example.summary,
      'answer-detail': example.detail,
      'answer-source': example.source,
      'detail-title': example.title,
      'detail-column': example.column,
      'detail-period': example.period
    };
    Object.entries(fields).forEach(([id, value]) => {
      document.getElementById(id).textContent = value;
    });
    const rows = example.rows.map(cells => {
      const row = document.createElement('tr');
      cells.forEach((text, i) => {
        const cell = document.createElement('td');
        if (i === 0) {
          const dot = document.createElement('span');
          dot.className = 'table-dot';
          dot.setAttribute('aria-hidden', 'true');
          cell.append(dot);
        }
        cell.append(document.createTextNode(text));
        row.append(cell);
      });
      return row;
    });
    document.getElementById('detail-rows').replaceChildren(...rows);
    const amounts = example.rows.map(row => Number(row[2].replace(/[^0-9]/g, '')));
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    document.querySelectorAll('.distribution span').forEach((segment, i) => {
      segment.style.setProperty('--share', (amounts[i] / total * 100).toFixed(3));
    });
    questionButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.question === key)));
    document.querySelectorAll('[data-metric]').forEach(metric => metric.classList.toggle('active', metric.dataset.metric === key));
    if (transition) {
      stopAnimations();
      animate(document.querySelector('.answer'), [
        { transform: 'translateY(7px)' }, { transform: 'translateY(0)' }
      ]);
      animate(document.querySelector('.question'), [
        { transform: 'translateY(3px)' }, { transform: 'translateY(0)' }
      ], { duration: 300 });
      animate(document.querySelector('.metric.active'), [
        { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }
      ]);
    }
  }
  questionButtons.forEach(button => button.addEventListener('click', () => showExample(button.dataset.question)));
  document.querySelectorAll('[data-demo-target]').forEach(link => {
    link.addEventListener('click', () => showExample(link.dataset.demoTarget));
  });
  if (campaign.toLowerCase() === 'b') showExample('sales', false);
  document.querySelector('.demo-controls').hidden = false;

  // Manual tabs: mouse, touch and arrow keys select the same stable content.
  const tabList = document.querySelector('.steps-tabs');
  const tabs = [...tabList.querySelectorAll('[role="tab"]')];
  const panels = [...document.querySelectorAll('.step-pane')];
  function selectStep(index, focus = false, transition = true) {
    tabs.forEach((tab, i) => {
      const selected = index === i;
      tab.classList.toggle('on', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i].classList.toggle('on', selected);
      panels[i].hidden = !selected;
    });
    if (transition) {
      animate(panels[index], [
        { transform: 'translateY(6px)' }, { transform: 'translateY(0)' }
      ], { duration: 300 });
    }
    if (focus) tabs[index].focus({ preventScroll: true });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectStep(i));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (i + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        selectStep(next, true);
      }
    });
  });
  selectStep(0, false, false);
  tabList.hidden = false;
})();
