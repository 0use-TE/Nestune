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
