'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const money = (cents) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
const integer = (value) => new Intl.NumberFormat('en-AU').format(Number(value) || 0);
let model = null;
let csrf = '';

function alertUser(message, error = false) {
  const box = $('[data-alert]');
  box.textContent = message;
  box.className = 'op-alert is-visible' + (error ? ' is-error' : '');
  clearTimeout(alertUser.timer);
  alertUser.timer = setTimeout(() => { box.className = 'op-alert'; }, 6500);
}

function dollarsToCents(value) {
  const number = Number(String(value || '').replace(/[$,\s]/g, ''));
  if (!Number.isFinite(number) || number <= 0) throw new Error('Enter a valid amount greater than $0.');
  return Math.round(number * 100);
}

async function api(action = '', payload = {}) {
  const options = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
  let url = '/api/oakpay';
  if (action) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.headers['X-CSRF-Token'] = csrf;
    options.body = JSON.stringify({ action, ...payload });
  }
  const response = await fetch(url, options);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('The BLVCK OAK PAY service is unavailable on this deployment.');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to complete this action.');
  if (result.csrf) csrf = result.csrf;
  if (result.state) model = result.state;
  return result;
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function statusBadge(value) {
  const span = document.createElement('span');
  span.className = 'op-status ' + String(value || '').replace(/[^a-z_]/g, '');
  span.textContent = value === 'provider_required' ? 'Provider required' : value === 'draft' ? 'Draft' : String(value || 'open').replaceAll('_', ' ');
  return span;
}

function row(cells) {
  const tr = document.createElement('tr');
  cells.forEach((cell) => {
    const td = document.createElement('td');
    if (cell instanceof Node) td.append(cell);
    else td.textContent = String(cell ?? '');
    tr.append(td);
  });
  return tr;
}

function renderOptions() {
  const supplierSelects = $$('select[name="supplierId"]');
  supplierSelects.forEach((select) => {
    const current = select.value;
    const first = select.querySelector('option')?.textContent || 'Choose supplier';
    select.replaceChildren(new Option(first, ''));
    model.suppliers.forEach((supplier) => select.append(new Option(supplier.name, supplier.id)));
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  });
  const billSelect = $('select[name="billId"]');
  const currentBill = billSelect.value;
  billSelect.replaceChildren(new Option('No linked bill', ''));
  model.bills.filter((bill) => bill.status === 'open').forEach((bill) => {
    billSelect.append(new Option(`${bill.supplierName} · ${money(bill.amountCents)} · ${bill.reference || 'No reference'}`, bill.id));
  });
  if ([...billSelect.options].some((option) => option.value === currentBill)) billSelect.value = currentBill;
}

function renderOverview() {
  const summary = model.summary;
  setText('[data-metric-bills]', money(summary.outstandingBillCents));
  setText('[data-metric-bills-count]', `${summary.openBills} open ${summary.openBills === 1 ? 'bill' : 'bills'}`);
  setText('[data-metric-payments]', money(summary.paymentInstructionCents));
  setText('[data-metric-points]', integer(summary.rewardPreviewPoints));
  setText('[data-metric-requests]', money(summary.requestCents));
  setText('[data-metric-requests-count]', `${summary.requests} ${summary.requests === 1 ? 'draft' : 'drafts'}`);

  const rows = $('[data-payment-rows]');
  rows.replaceChildren();
  model.payments.slice(0, 6).forEach((payment) => rows.append(row([
    payment.supplierName,
    money(payment.amountCents),
    payment.fundingMethod.toUpperCase(),
    statusBadge(payment.status),
  ])));
  $('[data-payment-empty]').hidden = model.payments.length > 0;

  const activity = $('[data-activity-list]');
  activity.replaceChildren();
  model.activity.slice(0, 8).forEach((item) => {
    const div = document.createElement('div');
    div.className = 'op-activity-item';
    const strong = document.createElement('strong');
    strong.textContent = item.label;
    const span = document.createElement('span');
    span.textContent = new Date(item.at).toLocaleString('en-AU') + (item.detail ? ' · ' + item.detail : '');
    div.append(strong, span);
    activity.append(div);
  });
  $('[data-activity-empty]').hidden = model.activity.length > 0;
}

function renderBills() {
  const tbody = $('[data-bill-rows]');
  tbody.replaceChildren();
  model.bills.forEach((bill) => tbody.append(row([
    bill.supplierName,
    bill.reference || '—',
    bill.dueDate,
    bill.category,
    money(bill.amountCents),
    statusBadge(bill.status),
  ])));
  $('[data-bill-empty]').hidden = model.bills.length > 0;
}

function renderPayments() {
  const tbody = $('[data-payment-ledger]');
  tbody.replaceChildren();
  model.payments.forEach((payment) => tbody.append(row([
    new Date(payment.createdAt).toLocaleDateString('en-AU'),
    payment.supplierName,
    payment.reference || '—',
    payment.fundingMethod.toUpperCase(),
    money(payment.amountCents),
    integer(payment.rewardPreviewPoints),
    statusBadge(payment.status),
  ])));
  $('[data-payment-ledger-empty]').hidden = model.payments.length > 0;
  const points = model.profile.rewardsTier === 'plus' ? 2 : 1;
  setText('[data-reward-rate]', `${points} pt${points === 1 ? '' : 's'} / $1`);
  setText('[data-reward-tier]', model.profile.rewardsTier === 'plus' ? 'Plus preview' : 'Core preview');
}

function renderSuppliers() {
  const tbody = $('[data-supplier-rows]');
  tbody.replaceChildren();
  model.suppliers.forEach((supplier) => tbody.append(row([
    supplier.name,
    supplier.type,
    supplier.destinationLabel ? `${supplier.destinationLabel}${supplier.destinationLast4 ? ' · •••• ' + supplier.destinationLast4 : ''}` : 'Not set',
    new Date(supplier.createdAt).toLocaleDateString('en-AU'),
  ])));
  $('[data-supplier-empty]').hidden = model.suppliers.length > 0;
}

function renderRequests() {
  const tbody = $('[data-request-rows]');
  tbody.replaceChildren();
  model.paymentRequests.forEach((request) => tbody.append(row([
    request.customerName,
    request.reference || '—',
    money(request.amountCents),
    new Date(request.createdAt).toLocaleDateString('en-AU'),
    statusBadge(request.status),
  ])));
  $('[data-request-empty]').hidden = model.paymentRequests.length > 0;
}

function renderSettings() {
  const form = $('[data-profile-form]');
  form.businessName.value = model.profile.businessName || '';
  form.abn.value = model.profile.abn || '';
  form.industry.value = model.profile.industry || '';
  form.rewardsTier.value = model.profile.rewardsTier || 'core';

  const team = $('[data-team-list]');
  team.replaceChildren();
  model.team.forEach((member) => {
    const div = document.createElement('div');
    div.className = 'op-activity-item';
    const strong = document.createElement('strong');
    strong.textContent = member.email;
    const span = document.createElement('span');
    span.textContent = member.role + ' · role model saved ' + new Date(member.createdAt).toLocaleDateString('en-AU');
    div.append(strong, span);
    team.append(div);
  });
  $('[data-team-empty]').hidden = model.team.length > 0;
}

function render() {
  if (!model) return;
  const title = model.profile.businessName || 'BLVCK OAK PAY';
  setText('[data-business-title]', title);
  setText('[data-business-subtitle]', model.profile.businessName ? 'Business payments control centre' : 'Complete your business profile in Team & integrations.');
  renderOptions();
  renderOverview();
  renderBills();
  renderPayments();
  renderSuppliers();
  renderRequests();
  renderSettings();
}

function showView(name) {
  $$('[data-view]').forEach((section) => section.classList.toggle('is-active', section.dataset.view === name));
  $$('[data-view-target]').forEach((button) => button.classList.toggle('is-active', button.dataset.viewTarget === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function submit(form, action, buildPayload, successMessage) {
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const payload = buildPayload(new FormData(form));
    await api(action, payload);
    render();
    form.reset();
    renderOptions();
    const paymentDate = $('[data-payment-form] input[name="scheduledDate"]');
    if (paymentDate) paymentDate.value = new Date().toISOString().slice(0, 10);
    alertUser(successMessage);
  } catch (error) {
    alertUser(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function parseCsvLine(line) {
  const output = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      output.push(cell.trim()); cell = '';
    } else cell += char;
  }
  output.push(cell.trim());
  return output;
}

function parseBillsCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV must contain a header row and at least one bill.');
  const headers = parseCsvLine(lines[0]).map((item) => item.toLowerCase().replace(/\s+/g, ''));
  const required = ['supplier', 'amount', 'duedate'];
  if (!required.every((name) => headers.includes(name))) throw new Error('CSV needs supplier, amount and dueDate columns.');
  return lines.slice(1, 51).map((line) => {
    const values = parseCsvLine(line);
    const entry = Object.fromEntries(headers.map((name, index) => [name, values[index] || '']));
    return {
      supplierName: entry.supplier,
      amountCents: dollarsToCents(entry.amount),
      dueDate: entry.duedate,
      reference: entry.reference || '',
      category: entry.category || 'Supplier',
    };
  });
}

$$('[data-view-target]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.viewTarget)));
$$('[data-go]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.go)));

$('[data-supplier-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'add_supplier', (data) => ({
    supplier: {
      name: data.get('name'),
      type: data.get('type'),
      destinationLabel: data.get('destinationLabel'),
      destinationLast4: data.get('destinationLast4'),
    },
  }), 'Supplier added to your BLVCK OAK PAY registry.');
});

$('[data-bill-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'add_bill', (data) => ({
    bill: {
      supplierId: data.get('supplierId'),
      supplierName: data.get('supplierName'),
      amountCents: dollarsToCents(data.get('amount')),
      dueDate: data.get('dueDate'),
      reference: data.get('reference'),
      category: data.get('category'),
    },
  }), 'Bill added to the payable queue.');
});

$('[data-payment-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'queue_payment', (data) => ({
    payment: {
      supplierId: data.get('supplierId'),
      billId: data.get('billId'),
      amountCents: dollarsToCents(data.get('amount')),
      fundingMethod: data.get('fundingMethod'),
      scheduledDate: data.get('scheduledDate'),
      reference: data.get('reference'),
    },
  }), 'Payment instruction queued. No funds have moved.');
});

$('[data-request-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'create_payment_request', (data) => ({
    request: {
      customerName: data.get('customerName'),
      customerEmail: data.get('customerEmail'),
      amountCents: dollarsToCents(data.get('amount')),
      reference: data.get('reference'),
      description: data.get('description'),
    },
  }), 'Customer payment request saved as a draft.');
});

$('[data-profile-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'save_profile', (data) => ({
    profile: {
      businessName: data.get('businessName'),
      abn: data.get('abn'),
      industry: data.get('industry'),
      rewardsTier: data.get('rewardsTier'),
    },
  }), 'Business profile updated.');
});

$('[data-team-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  submit(event.currentTarget, 'add_team_member', (data) => ({
    member: { email: data.get('email'), role: data.get('role') },
  }), 'Team role saved. Authentication access is not granted by this record alone.');
});

$('[data-bill-csv]').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    const bills = parseBillsCsv(await file.text());
    await api('import_bills', { bills });
    render();
    alertUser(`${bills.length} bill${bills.length === 1 ? '' : 's'} imported.`);
  } catch (error) {
    alertUser(error.message, true);
  } finally {
    event.currentTarget.value = '';
  }
});

document.addEventListener('change', (event) => {
  const billSelect = event.target.closest('select[name="billId"]');
  if (!billSelect || !billSelect.value || !model) return;
  const bill = model.bills.find((item) => item.id === billSelect.value);
  if (!bill) return;
  const form = billSelect.closest('form');
  form.supplierId.value = bill.supplierId || '';
  form.amount.value = (bill.amountCents / 100).toFixed(2);
  form.reference.value = bill.reference || '';
});

(async () => {
  try {
    const result = await api();
    csrf = result.csrf;
    model = result.state;
    const today = new Date().toISOString().slice(0, 10);
    $('[data-payment-form] input[name="scheduledDate"]').value = today;
    render();
  } catch (error) {
    alertUser(error.message, true);
    setText('[data-business-subtitle]', 'Unable to load the finance workspace.');
  }
})();