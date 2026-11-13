const status = document.querySelector('.copy-status');
let reset;
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      status.textContent = button.getAttribute('aria-label').replace('复制', '') + '已复制';
      clearTimeout(reset);
      reset = setTimeout(() => { status.textContent = ''; }, 2400);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = '已选中，长按或按 Ctrl+C 复制';
    }
  });
}
const preview = document.querySelector('.preview-dialog');
const previewImage = document.querySelector('#preview-image');
const previewCaption = document.querySelector('#preview-caption');
for (const button of document.querySelectorAll('[data-preview]')) {
  button.addEventListener('click', () => {
    previewImage.src = button.dataset.preview;
    previewImage.alt = button.querySelector('img').alt;
    previewCaption.textContent = button.dataset.caption;
    preview.showModal();
  });
}
document.querySelector('[data-close-preview]').addEventListener('click', () => preview.close());
preview.addEventListener('click', event => { if (event.target === preview) preview.close(); });
