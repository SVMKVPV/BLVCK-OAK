const frame = document.querySelector('[data-table-preview]');
const table = Number(new URLSearchParams(location.search).get('table'));
if (frame && Number.isInteger(table) && table >= 1 && table <= 99) {
  const url = new URL(frame.src);
  url.searchParams.set('table', String(table));
  frame.src = url.href;
}
